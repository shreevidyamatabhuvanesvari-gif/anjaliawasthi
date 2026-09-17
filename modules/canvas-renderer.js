/**
 * Swar Srijan Studio
 * modules/canvas-renderer.js
 *
 * Canvas preview renderer.
 *
 * Responsibilities:
 * - Draw selected image/video media on Canvas.
 * - Draw news ticker as an independent overlay.
 * - Keep ticker rendering independent from media availability.
 * - Support fit modes.
 * - Support play, pause and reset lifecycle.
 * - Support static rendering and animated rendering.
 * - Handle device-pixel-ratio correctly.
 * - Expose a small stable renderer API.
 *
 * Expected dependencies:
 * - canvas: HTMLCanvasElement
 * - mediaModule: existing media module
 * - tickerModule: existing news ticker module
 *
 * No external dependencies.
 */

const DEFAULTS = Object.freeze({
  fitMode: "contain",

  backgroundColor: "#111111",

  ticker: {
    enabled: false,
    text: "",
    position: "bottom",
    direction: "left",
    speed: 80,
    fontSize: 28,
    textColor: "#ffffff",
    backgroundColor: "#000000",
    bold: false,
  },

  maxDevicePixelRatio: 2,

  defaultTickerHeightRatio: 0.14,
  minimumTickerHeight: 34,
  maximumTickerHeight: 180,

  tickerHorizontalPadding: 24,
  tickerTextGap: 80,

  tickerAnimationFrameLimit: 120,
});

const VALID_FIT_MODES = new Set([
  "contain",
  "cover",
  "stretch",
]);

const VALID_TICKER_POSITIONS = new Set([
  "top",
  "bottom",
]);

const VALID_TICKER_DIRECTIONS = new Set([
  "left",
  "right",
]);

const EMPTY_MEDIA_MODEL = Object.freeze({
  hasMedia: false,
  kind: null,
  element: null,
  mediaElement: null,
  file: null,
  fitMode: DEFAULTS.fitMode,
});

const EMPTY_TICKER_MODEL = Object.freeze({
  enabled: false,
  text: "",
  position: DEFAULTS.ticker.position,
  direction: DEFAULTS.ticker.direction,
  speed: DEFAULTS.ticker.speed,
  fontSize: DEFAULTS.ticker.fontSize,
  textColor: DEFAULTS.ticker.textColor,
  backgroundColor: DEFAULTS.ticker.backgroundColor,
  bold: DEFAULTS.ticker.bold,
});

/**
 * Create the Canvas renderer module.
 *
 * @param {Object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {Object|null} options.mediaModule
 * @param {Object|null} options.tickerModule
 * @param {Function} [options.onReady]
 * @param {Function} [options.onChange]
 * @param {Function} [options.onError]
 * @returns {Object}
 */
export function createCanvasRendererModule(options = {}) {
  const {
    canvas,
    mediaModule = null,
    tickerModule: initialTickerModule = null,
    onReady = null,
    onChange = null,
    onError = null,
  } = options;

  let tickerModule = initialTickerModule;

  const state = {
    initialized: false,
    destroyed: false,

    playing: false,
    rendering: false,
    renderQueued: false,

    animationFrameId: null,
    lastFrameTime: 0,

    width: 0,
    height: 0,
    pixelRatio: 1,

    fitMode: DEFAULTS.fitMode,

    tickerOffset: 0,
    tickerLastText: "",
    tickerLastDirection: "",
    tickerLastWidth: 0,

    mediaListeners: [],
    resizeObserver: null,
    windowResizeHandler: null,
  };

  let context = null;

  /**
   * Initialize the renderer.
   */
  function init() {
    if (state.destroyed) {
      return failure("Canvas renderer has already been destroyed.");
    }

    if (state.initialized) {
      requestRender();

      return success({
        alreadyInitialized: true,
      });
    }

    if (!(canvas instanceof HTMLCanvasElement)) {
      const error = new Error(
        "Canvas renderer requires a valid HTMLCanvasElement."
      );

      notifyError(error);

      return failure(error.message, error);
    }

    try {
      context = canvas.getContext("2d", {
        alpha: true,
        desynchronized: true,
      });

      /**
       * Some browsers may not accept the context options.
       * Retry with the basic 2D context.
       */
      if (!context) {
        context = canvas.getContext("2d");
      }
    } catch (error) {
      context = null;

      notifyError(error);

      return failure(
        "Canvas 2D context प्राप्त नहीं हो सका।",
        error
      );
    }

    if (!context) {
      const error = new Error(
        "Canvas 2D context is not available."
      );

      notifyError(error);

      return failure(
        "Canvas 2D context उपलब्ध नहीं है।",
        error
      );
    }

    state.fitMode = resolveInitialFitMode();

    bindMediaEvents();
    bindResizeHandling();

    resizeCanvas();

    state.initialized = true;

    /**
     * Important:
     * Render immediately, even if no media is selected.
     * The ticker is an independent overlay and must not depend
     * on media availability.
     */
    renderStaticFrame();

    notifyReady();

    return success();
  }

  /**
   * Start animated rendering.
   *
   * This is used for:
   * - video playback
   * - ticker scrolling
   * - other future animated canvas content
   */
  function play() {
    if (state.destroyed) {
      return failure("Canvas renderer has already been destroyed.");
    }

    if (!state.initialized) {
      const result = init();

      if (!result.ok) {
        return result;
      }
    }

    state.playing = true;
    state.lastFrameTime = 0;

    scheduleAnimationFrame();

    notifyChange({
      type: "play",
    });

    return success();
  }

  /**
   * Pause animated rendering.
   */
  function pause() {
    if (state.destroyed) {
      return failure("Canvas renderer has already been destroyed.");
    }

    state.playing = false;
    cancelScheduledAnimationFrame();

    /**
     * Draw one final static frame after pausing.
     */
    renderStaticFrame();

    notifyChange({
      type: "pause",
    });

    return success();
  }

  /**
   * Reset animation state and draw a fresh frame.
   */
  function reset() {
    if (state.destroyed) {
      return failure("Canvas renderer has already been destroyed.");
    }

    state.playing = false;
    state.lastFrameTime = 0;
    state.tickerOffset = 0;
    state.tickerLastText = "";
    state.tickerLastDirection = "";
    state.tickerLastWidth = 0;

    cancelScheduledAnimationFrame();

    renderStaticFrame();

    notifyChange({
      type: "reset",
    });

    return success();
  }

  /**
   * Request one Canvas render.
   *
   * This does not automatically start a permanent animation loop.
   * It schedules one frame and lets the renderer decide whether
   * another frame is needed.
   */
  function requestRender() {
    if (state.destroyed) {
      return failure("Canvas renderer has already been destroyed.");
    }

    if (!state.initialized) {
      return success({
        queuedBeforeInit: true,
      });
    }

    if (state.renderQueued) {
      return success({
        alreadyQueued: true,
      });
    }

    state.renderQueued = true;

    scheduleAnimationFrame({
      oneShot: !state.playing,
    });

    return success();
  }

  /**
   * Change fit mode.
   */
  function setFitMode(nextFitMode) {
    const normalized = normalizeFitMode(nextFitMode);

    if (!normalized) {
      return failure(
        `Invalid fit mode: ${String(nextFitMode)}`
      );
    }

    state.fitMode = normalized;

    /**
     * Keep media module's fit mode synchronized when supported.
     */
    if (
      mediaModule &&
      typeof mediaModule.setFitMode === "function"
    ) {
      try {
        mediaModule.setFitMode(normalized);
      } catch (error) {
        notifyError(error);
      }
    }

    requestRender();

    notifyChange({
      type: "fit-mode-change",
      fitMode: normalized,
    });

    return success({
      fitMode: normalized,
    });
  }

  /**
   * Replace or attach the ticker module after renderer creation.
   *
   * This also protects against future initialization-order issues.
   */
  function setTickerModule(nextTickerModule) {
    if (
      nextTickerModule !== null &&
      typeof nextTickerModule !== "object"
    ) {
      return failure(
        "Ticker module must be an object or null."
      );
    }

    tickerModule = nextTickerModule;

    state.tickerOffset = 0;
    state.tickerLastText = "";
    state.tickerLastDirection = "";
    state.tickerLastWidth = 0;

    requestRender();

    notifyChange({
      type: "ticker-module-change",
    });

    return success();
  }

  /**
   * Return current renderer state.
   */
  function getState() {
    return {
      initialized: state.initialized,
      destroyed: state.destroyed,
      playing: state.playing,
      rendering: state.rendering,
      width: state.width,
      height: state.height,
      pixelRatio: state.pixelRatio,
      fitMode: state.fitMode,
      tickerOffset: state.tickerOffset,
    };
  }

  /**
   * Destroy the renderer and release listeners/resources.
   */
  function destroy() {
    if (state.destroyed) {
      return success({
        alreadyDestroyed: true,
      });
    }

    state.playing = false;
    cancelScheduledAnimationFrame();

    unbindMediaEvents();
    unbindResizeHandling();

    if (context && canvas) {
      try {
        context.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );
      } catch (error) {
        notifyError(error);
      }
    }

    context = null;
    state.initialized = false;
    state.destroyed = true;

    return success();
  }

  /**
   * Render a static frame immediately.
   */
  function renderStaticFrame() {
    if (state.destroyed || !context) {
      return false;
    }

    const now = performance.now();

    try {
      renderFrame(now, 0);
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  }

  /**
   * Render one frame.
   */
  function renderFrame(timestamp, deltaSeconds) {
    if (state.destroyed || !context) {
      return;
    }

    state.rendering = true;

    try {
      resizeCanvasIfNeeded();

      clearCanvas();

      /**
       * First draw the media layer.
       *
       * Media may be absent. This must not stop ticker rendering.
       */
      const media = readMediaModel();

      if (media.hasMedia) {
        drawMedia(media);
      } else {
        drawEmptyPreview();
      }

      /**
       * Critical fix:
       *
       * The ticker is always drawn after the media layer,
       * independently of whether media exists.
       */
      const ticker = readTickerModel();

      drawTicker(ticker, deltaSeconds);
    } finally {
      state.rendering = false;
    }

    notifyChange({
      type: "render",
      timestamp,
    });
  }

  /**
   * Read current media model from media.js.
   */
  function readMediaModel() {
    if (!mediaModule) {
      return EMPTY_MEDIA_MODEL;
    }

    let source = null;

    /**
     * Prefer getRenderModel() if available.
     */
    if (
      typeof mediaModule.getRenderModel === "function"
    ) {
      try {
        source = mediaModule.getRenderModel();
      } catch (error) {
        notifyError(error);
      }
    }

    /**
     * Fallback to getState().
     */
    if (!source && typeof mediaModule.getState === "function") {
      try {
        source = mediaModule.getState();
      } catch (error) {
        notifyError(error);
      }
    }

    if (!source || typeof source !== "object") {
      return EMPTY_MEDIA_MODEL;
    }

    const element =
      source.element ||
      source.mediaElement ||
      source.videoElement ||
      source.imageElement ||
      source.node ||
      null;

    const hasMedia =
      Boolean(source.hasMedia) ||
      Boolean(source.ready) ||
      Boolean(source.loaded) ||
      Boolean(element);

    const kind =
      normalizeMediaKind(
        source.kind ||
        source.type ||
        source.mediaType
      );

    const fitMode =
      normalizeFitMode(
        source.fitMode ||
        source.objectFit ||
        state.fitMode
      ) || state.fitMode;

    return {
      ...EMPTY_MEDIA_MODEL,
      ...source,
      hasMedia,
      kind,
      element,
      mediaElement: element,
      fitMode,
    };
  }

  /**
   * Read current ticker render model.
   */
  function readTickerModel() {
    if (
      !tickerModule ||
      typeof tickerModule.getRenderModel !== "function"
    ) {
      return EMPTY_TICKER_MODEL;
    }

    try {
      const source = tickerModule.getRenderModel();

      if (!source || typeof source !== "object") {
        return EMPTY_TICKER_MODEL;
      }

      const text =
        typeof source.text === "string"
          ? source.text.trim()
          : "";

      const enabled =
        Boolean(source.enabled) &&
        text.length > 0;

      const position =
        VALID_TICKER_POSITIONS.has(source.position)
          ? source.position
          : DEFAULTS.ticker.position;

      const direction =
        VALID_TICKER_DIRECTIONS.has(source.direction)
          ? source.direction
          : DEFAULTS.ticker.direction;

      const speed = clampNumber(
        source.speed,
        0,
        2000,
        DEFAULTS.ticker.speed
      );

      const fontSize = clampNumber(
        source.fontSize,
        8,
        200,
        DEFAULTS.ticker.fontSize
      );

      return {
        enabled,
        text,
        position,
        direction,
        speed,
        fontSize,
        textColor:
          normalizeCssColor(
            source.textColor,
            DEFAULTS.ticker.textColor
          ),
        backgroundColor:
          normalizeCssColor(
            source.backgroundColor,
            DEFAULTS.ticker.backgroundColor
          ),
        bold: Boolean(source.bold),
      };
    } catch (error) {
      notifyError(error);
      return EMPTY_TICKER_MODEL;
    }
  }

  /**
   * Draw media on Canvas.
   */
  function drawMedia(media) {
    const element =
      media.element ||
      media.mediaElement ||
      null;

    if (!element) {
      drawEmptyPreview();
      return;
    }

    if (!isDrawableMediaElement(element, media.kind)) {
      drawEmptyPreview();
      return;
    }

    const sourceWidth =
      Number(element.videoWidth) ||
      Number(element.naturalWidth) ||
      Number(element.width) ||
      0;

    const sourceHeight =
      Number(element.videoHeight) ||
      Number(element.naturalHeight) ||
      Number(element.height) ||
      0;

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      /**
       * The element may not have loaded yet.
       * Leave the background visible and try again on the next frame.
       */
      return;
    }

    const destination = calculateFitRect(
      sourceWidth,
      sourceHeight,
      state.width,
      state.height,
      media.fitMode || state.fitMode
    );

    try {
      context.drawImage(
        element,
        destination.x,
        destination.y,
        destination.width,
        destination.height
      );
    } catch (error) {
      /**
       * drawImage can fail while a video is transitioning
       * between loading/ready states. Do not break the ticker.
       */
      notifyError(error);
    }
  }

  /**
   * Draw empty preview background.
   */
  function drawEmptyPreview() {
    if (!context) {
      return;
    }

    context.save();

    context.fillStyle = DEFAULTS.backgroundColor;
    context.fillRect(
      0,
      0,
      state.width,
      state.height
    );

    context.restore();
  }

  /**
   * Draw ticker overlay.
   *
   * The ticker is drawn independently of media.
   */
  function drawTicker(model, deltaSeconds = 0) {
    if (
      !context ||
      !model ||
      !model.enabled ||
      !model.text
    ) {
      return;
    }

    const canvasWidth = state.width;
    const canvasHeight = state.height;

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      return;
    }

    const tickerHeight = calculateTickerHeight(
      model.fontSize,
      canvasHeight
    );

    const tickerY =
      model.position === "top"
        ? 0
        : canvasHeight - tickerHeight;

    const tickerX = 0;

    /**
     * Update ticker metrics and reset offset when text,
     * direction or measured width changes.
     */
    const metrics = measureTickerText(
      model,
      tickerHeight
    );

    const contentWidth = metrics.width;
    const gap = DEFAULTS.tickerTextGap;
    const cycleWidth = contentWidth + gap;

    if (
      state.tickerLastText !== model.text ||
      state.tickerLastDirection !== model.direction ||
      Math.abs(state.tickerLastWidth - contentWidth) > 0.5
    ) {
      state.tickerOffset =
        model.direction === "left"
          ? canvasWidth
          : -contentWidth;

      state.tickerLastText = model.text;
      state.tickerLastDirection = model.direction;
      state.tickerLastWidth = contentWidth;
    }

    /**
     * Animate only when a positive delta is available.
     * Static renders pass deltaSeconds = 0.
     */
    if (
      deltaSeconds > 0 &&
      Number.isFinite(model.speed) &&
      model.speed > 0
    ) {
      const movement =
        model.speed * deltaSeconds;

      if (model.direction === "left") {
        state.tickerOffset -= movement;

        if (state.tickerOffset < -cycleWidth) {
          state.tickerOffset += cycleWidth;
        }
      } else {
        state.tickerOffset += movement;

        if (state.tickerOffset > canvasWidth + gap) {
          state.tickerOffset -= cycleWidth;
        }
      }
    }

    context.save();

    /**
     * Ticker background strip.
     */
    context.fillStyle = model.backgroundColor;
    context.fillRect(
      tickerX,
      tickerY,
      canvasWidth,
      tickerHeight
    );

    /**
     * Clip text to ticker strip.
     */
    context.beginPath();
    context.rect(
      tickerX,
      tickerY,
      canvasWidth,
      tickerHeight
    );
    context.clip();

    context.font = buildTickerFont(model);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = model.textColor;

    const textY =
      tickerY + tickerHeight / 2;

    /**
     * Draw repeated text so the ticker loops continuously
     * without leaving a blank gap.
     */
    if (model.direction === "left") {
      let x = state.tickerOffset;

      while (x < canvasWidth) {
        context.fillText(
          model.text,
          x,
          textY
        );

        x += cycleWidth;
      }

      /**
       * Also draw one preceding copy if needed.
       */
      if (state.tickerOffset > 0) {
        context.fillText(
          model.text,
          state.tickerOffset - cycleWidth,
          textY
        );
      }
    } else {
      let x = state.tickerOffset;

      while (x < canvasWidth + contentWidth) {
        context.fillText(
          model.text,
          x,
          textY
        );

        x += cycleWidth;
      }

      if (state.tickerOffset > -contentWidth) {
        context.fillText(
          model.text,
          state.tickerOffset - cycleWidth,
          textY
        );
      }
    }

    context.restore();
  }

  /**
   * Calculate ticker height.
   */
  function calculateTickerHeight(fontSize, canvasHeight) {
    const preferredHeight =
      Math.round(
        Math.max(
          fontSize * 1.7,
          canvasHeight * DEFAULTS.defaultTickerHeightRatio
        )
      );

    return clampNumber(
      preferredHeight,
      DEFAULTS.minimumTickerHeight,
      Math.min(
        DEFAULTS.maximumTickerHeight,
        Math.max(
          DEFAULTS.minimumTickerHeight,
          canvasHeight
        )
      ),
      DEFAULTS.minimumTickerHeight
    );
  }

  /**
   * Measure ticker text.
   */
  function measureTickerText(model, tickerHeight) {
    context.save();

    context.font = buildTickerFont(model);

    const metrics = context.measureText(model.text);

    context.restore();

    return {
      width: Math.max(
        1,
        metrics.width
      ),
      height: tickerHeight,
    };
  }

  /**
   * Build ticker font string.
   */
  function buildTickerFont(model) {
    const weight = model.bold ? "700" : "400";
    const size = `${Math.round(model.fontSize)}px`;

    return `${weight} ${size} sans-serif`;
  }

  /**
   * Calculate media destination rectangle.
   */
  function calculateFitRect(
    sourceWidth,
    sourceHeight,
    destinationWidth,
    destinationHeight,
    fitMode
  ) {
    if (
      fitMode === "stretch"
    ) {
      return {
        x: 0,
        y: 0,
        width: destinationWidth,
        height: destinationHeight,
      };
    }

    const sourceRatio =
      sourceWidth / sourceHeight;

    const destinationRatio =
      destinationWidth / destinationHeight;

    let width;
    let height;

    if (fitMode === "cover") {
      if (sourceRatio > destinationRatio) {
        height = destinationHeight;
        width = height * sourceRatio;
      } else {
        width = destinationWidth;
        height = width / sourceRatio;
      }
    } else {
      /**
       * Default: contain.
       */
      if (sourceRatio > destinationRatio) {
        width = destinationWidth;
        height = width / sourceRatio;
      } else {
        height = destinationHeight;
        width = height * sourceRatio;
      }
    }

    return {
      x: (destinationWidth - width) / 2,
      y: (destinationHeight - height) / 2,
      width,
      height,
    };
  }

  /**
   * Resize Canvas backing store and CSS size.
   */
  function resizeCanvas() {
    if (
      state.destroyed ||
      !(canvas instanceof HTMLCanvasElement)
    ) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    const cssWidth =
      Math.max(
        1,
        Math.round(
          rect.width ||
          canvas.clientWidth ||
          canvas.width ||
          1
        )
      );

    const cssHeight =
      Math.max(
        1,
        Math.round(
          rect.height ||
          canvas.clientHeight ||
          canvas.height ||
          1
        )
      );

    const devicePixelRatio =
      typeof window !== "undefined" &&
      Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;

    const pixelRatio = clampNumber(
      devicePixelRatio,
      1,
      DEFAULTS.maxDevicePixelRatio,
      1
    );

    const backingWidth =
      Math.max(
        1,
        Math.round(cssWidth * pixelRatio)
      );

    const backingHeight =
      Math.max(
        1,
        Math.round(cssHeight * pixelRatio)
      );

    const changed =
      canvas.width !== backingWidth ||
      canvas.height !== backingHeight ||
      state.width !== cssWidth ||
      state.height !== cssHeight ||
      state.pixelRatio !== pixelRatio;

    if (!changed) {
      return;
    }

    canvas.width = backingWidth;
    canvas.height = backingHeight;

    /**
     * Keep CSS dimensions stable while using a high-resolution
     * backing store.
     */
    if (!canvas.style.width) {
      canvas.style.width = "100%";
    }

    if (!canvas.style.height) {
      canvas.style.height = "100%";
    }

    state.width = cssWidth;
    state.height = cssHeight;
    state.pixelRatio = pixelRatio;

    /**
     * Draw using CSS-pixel coordinates.
     */
    context.setTransform(
      pixelRatio,
      0,
      0,
      pixelRatio,
      0,
      0
    );

    state.tickerOffset = 0;
    state.tickerLastText = "";
    state.tickerLastDirection = "";
    state.tickerLastWidth = 0;
  }

  /**
   * Resize only if dimensions changed.
   */
  function resizeCanvasIfNeeded() {
    resizeCanvas();
  }

  /**
   * Clear Canvas.
   */
  function clearCanvas() {
    if (!context) {
      return;
    }

    context.save();

    context.setTransform(
      state.pixelRatio,
      0,
      0,
      state.pixelRatio,
      0,
      0
    );

    context.clearRect(
      0,
      0,
      state.width,
      state.height
    );

    context.fillStyle = DEFAULTS.backgroundColor;
    context.fillRect(
      0,
      0,
      state.width,
      state.height
    );

    context.restore();
  }

  /**
   * Schedule animation frame.
   */
  function scheduleAnimationFrame({
    oneShot = false,
  } = {}) {
    if (
      state.destroyed ||
      state.animationFrameId !== null
    ) {
      return;
    }

    if (
      typeof requestAnimationFrame !== "function"
    ) {
      /**
       * Basic fallback for unusual environments.
       */
      state.renderQueued = false;

      const now = performance.now();
      const delta =
        state.lastFrameTime > 0
          ? Math.min(
              0.25,
              (now - state.lastFrameTime) / 1000
            )
          : 0;

      state.lastFrameTime = now;

      renderFrame(now, delta);

      if (
        state.playing &&
        !oneShot
      ) {
        scheduleAnimationFrame({
          oneShot: false,
        });
      }

      return;
    }

    state.animationFrameId =
      requestAnimationFrame((timestamp) => {
        state.animationFrameId = null;
        state.renderQueued = false;

        const delta =
          state.lastFrameTime > 0
            ? Math.min(
                0.25,
                (timestamp - state.lastFrameTime) / 1000
              )
            : 0;

        state.lastFrameTime = timestamp;

        try {
          renderFrame(timestamp, delta);
        } catch (error) {
          notifyError(error);
        }

        /**
         * Continue only when play mode is active.
         */
        if (state.playing && !state.destroyed) {
          scheduleAnimationFrame({
            oneShot: false,
          });
        }
      });
  }

  /**
   * Cancel pending animation frame.
   */
  function cancelScheduledAnimationFrame() {
    if (
      state.animationFrameId !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(
        state.animationFrameId
      );
    }

    state.animationFrameId = null;
    state.renderQueued = false;
  }

  /**
   * Bind media events.
   */
  function bindMediaEvents() {
    if (!mediaModule) {
      return;
    }

    /**
     * Some media modules expose an event subscription API.
     */
    if (
      typeof mediaModule.on === "function"
    ) {
      const events = [
        "change",
        "media-change",
        "loaded",
        "play",
        "pause",
        "timeupdate",
        "fit-mode-change",
      ];

      for (const eventName of events) {
        try {
          const unsubscribe = mediaModule.on(
            eventName,
            () => {
              requestRender();
            }
          );

          if (typeof unsubscribe === "function") {
            state.mediaListeners.push(unsubscribe);
          }
        } catch (error) {
          /**
           * Unsupported event names are harmless.
           */
          logDebug(
            `Media event subscription skipped: ${eventName}`,
            error
          );
        }
      }
    }

    /**
     * If media module exposes a DOM element, attach common
     * media events directly as a fallback.
     */
    const mediaElement =
      getMediaElementFromModule();

    if (
      mediaElement instanceof HTMLMediaElement
    ) {
      const events = [
        "loadedmetadata",
        "loadeddata",
        "canplay",
        "play",
        "pause",
        "timeupdate",
        "seeked",
        "durationchange",
        "resize",
      ];

      for (const eventName of events) {
        const handler = () => {
          requestRender();
        };

        mediaElement.addEventListener(
          eventName,
          handler
        );

        state.mediaListeners.push(() => {
          mediaElement.removeEventListener(
            eventName,
            handler
          );
        });
      }
    }
  }

  /**
   * Unbind media events.
   */
  function unbindMediaEvents() {
    for (const cleanup of state.mediaListeners.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        logDebug(
          "Media event cleanup failed.",
          error
        );
      }
    }
  }

  /**
   * Bind ResizeObserver/window resize.
   */
  function bindResizeHandling() {
    if (
      typeof ResizeObserver === "function" &&
      canvas instanceof HTMLElement
    ) {
      state.resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
        requestRender();
      });

      state.resizeObserver.observe(canvas);
    } else if (
      typeof window !== "undefined"
    ) {
      state.windowResizeHandler = () => {
        resizeCanvas();
        requestRender();
      };

      window.addEventListener(
        "resize",
        state.windowResizeHandler,
        {
          passive: true,
        }
      );
    }
  }

  /**
   * Unbind resize handling.
   */
  function unbindResizeHandling() {
    if (state.resizeObserver) {
      try {
        state.resizeObserver.disconnect();
      } catch (error) {
        logDebug(
          "ResizeObserver cleanup failed.",
          error
        );
      }

      state.resizeObserver = null;
    }

    if (
      state.windowResizeHandler &&
      typeof window !== "undefined"
    ) {
      window.removeEventListener(
        "resize",
        state.windowResizeHandler
      );

      state.windowResizeHandler = null;
    }
  }

  /**
   * Resolve initial fit mode from media module.
   */
  function resolveInitialFitMode() {
    if (
      mediaModule &&
      typeof mediaModule.getState === "function"
    ) {
      try {
        const mediaState = mediaModule.getState();

        const fitMode = normalizeFitMode(
          mediaState?.fitMode
        );

        if (fitMode) {
          return fitMode;
        }
      } catch (error) {
        logDebug(
          "Could not read initial media fit mode.",
          error
        );
      }
    }

    return DEFAULTS.fitMode;
  }

  /**
   * Find media element exposed by media module.
   */
  function getMediaElementFromModule() {
    if (!mediaModule) {
      return null;
    }

    if (
      typeof mediaModule.getRenderModel === "function"
    ) {
      try {
        const model = mediaModule.getRenderModel();

        return (
          model?.element ||
          model?.mediaElement ||
          model?.videoElement ||
          model?.imageElement ||
          null
        );
      } catch (error) {
        logDebug(
          "Could not read media render model element.",
          error
        );
      }
    }

    if (
      typeof mediaModule.getState === "function"
    ) {
      try {
        const mediaState = mediaModule.getState();

        return (
          mediaState?.element ||
          mediaState?.mediaElement ||
          mediaState?.videoElement ||
          mediaState?.imageElement ||
          null
        );
      } catch (error) {
        logDebug(
          "Could not read media state element.",
          error
        );
      }
    }

    return null;
  }

  /**
   * Validate drawable media element.
   */
  function isDrawableMediaElement(element, kind) {
    if (
      element instanceof HTMLImageElement
    ) {
      return (
        element.complete &&
        element.naturalWidth > 0 &&
        element.naturalHeight > 0
      );
    }

    if (
      element instanceof HTMLVideoElement
    ) {
      return (
        element.readyState >= 2 &&
        element.videoWidth > 0 &&
        element.videoHeight > 0
      );
    }

    /**
     * Generic fallback for canvas-compatible elements.
     */
    if (
      kind === "image" ||
      kind === "video"
    ) {
      return typeof element === "object";
    }

    return (
      typeof element === "object" &&
      typeof element.width === "number" &&
      typeof element.height === "number"
    );
  }

  /**
   * Notify renderer ready.
   */
  function notifyReady() {
    if (typeof onReady !== "function") {
      return;
    }

    try {
      onReady({
        type: "ready",
        state: getState(),
      });
    } catch (error) {
      logDebug(
        "Renderer onReady callback failed.",
        error
      );
    }
  }

  /**
   * Notify renderer change.
   */
  function notifyChange(event = {}) {
    if (typeof onChange !== "function") {
      return;
    }

    try {
      onChange({
        ...event,
        state: getState(),
      });
    } catch (error) {
      logDebug(
        "Renderer onChange callback failed.",
        error
      );
    }
  }

  /**
   * Notify renderer error.
   */
  function notifyError(error) {
    if (typeof onError !== "function") {
      return;
    }

    try {
      onError(error);
    } catch (callbackError) {
      logDebug(
        "Renderer onError callback failed.",
        callbackError
      );
    }
  }

  return {
    init,
    play,
    pause,
    reset,
    requestRender,
    setFitMode,
    setTickerModule,
    getState,
    destroy,
  };
}

/**
 * Normalize fit mode.
 */
function normalizeFitMode(value) {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";

  return VALID_FIT_MODES.has(normalized)
    ? normalized
    : "";
}

/**
 * Normalize media kind.
 */
function normalizeMediaKind(value) {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";

  if (
    normalized === "image" ||
    normalized === "photo" ||
    normalized === "picture"
  ) {
    return "image";
  }

  if (
    normalized === "video" ||
    normalized === "movie"
  ) {
    return "video";
  }

  return normalized || null;
}

/**
 * Normalize CSS color safely.
 */
function normalizeCssColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();

  if (!normalized) {
    return fallback;
  }

  /**
   * Avoid accepting obviously malformed values.
   * Canvas itself performs the final validation.
   */
  if (normalized.length > 200) {
    return fallback;
  }

  return normalized;
}

/**
 * Clamp numeric value.
 */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(min, number)
  );
}

/**
 * Standard success response.
 */
function success(extra = {}) {
  return {
    ok: true,
    ...extra,
  };
}

/**
 * Standard failure response.
 */
function failure(message, error = null) {
  return {
    ok: false,
    error:
      error instanceof Error
        ? error
        : new Error(message),
    message,
  };
}

/**
 * Debug logging that does not affect app behavior.
 */
function logDebug(message, error) {
  if (
    typeof console === "undefined" ||
    typeof console.debug !== "function"
  ) {
    return;
  }

  console.debug(
    `[Swar Srijan Studio] ${message}`,
    error || ""
  );
}
