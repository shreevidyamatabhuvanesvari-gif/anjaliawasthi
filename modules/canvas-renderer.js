/**
 * Swar Srijan Studio - 9:16 canvas preview renderer.
 *
 * Browser-only, dependency-free renderer for media + news-ticker compositing.
 * Recording/export is intentionally outside this module.
 */

const CONFIG = Object.freeze({
  WIDTH: 1080,
  HEIGHT: 1920,

  MIN_FONT_SIZE: 16,
  MAX_FONT_SIZE: 96,

  MIN_SPEED: 1,
  MAX_SPEED: 20,
  SPEED_PX_PER_SECOND: 12,

  MIN_BAR_HEIGHT: 64,
  MAX_BAR_HEIGHT: 240,

  MIN_PADDING: 12,
  MAX_PADDING: 36,
  PADDING_RATIO: 0.35,

  MIN_GAP: 48,
  GAP_RATIO: 1.5,

  MAX_DELTA_SECONDS: 0.25,
  VIDEO_READY_STATE: 2,

  EMPTY_BG: "#161616",
  EMPTY_TEXT: "#B8B8B8",

  TICKER_TEXT: "#FFFFFF",
  TICKER_BG: "#111111",

  FONT_FAMILY:
    '"Noto Sans Devanagari", "Nirmala UI", Mangal, sans-serif',
});

const FIT_MODES = new Set(["cover", "contain"]);
const POSITIONS = new Set(["top", "middle", "bottom"]);
const DIRECTIONS = new Set(["rtl", "ltr"]);

const EMPTY_TICKER = Object.freeze({
  visible: false,
  text: "",
  position: "bottom",
  direction: "rtl",
  speed: 8,
  fontSize: 36,
  textColor: CONFIG.TICKER_TEXT,
  backgroundColor: CONFIG.TICKER_BG,
  bold: true,
});

export function createCanvasRendererModule(options = {}) {
  let canvas = options.canvas ?? null;
  let ctx = null;

  let mediaModule = options.mediaModule ?? null;
  let tickerModule = options.tickerModule ?? null;

  const callbacks = {
    onReady:
      typeof options.onReady === "function"
        ? options.onReady
        : null,

    onChange:
      typeof options.onChange === "function"
        ? options.onChange
        : null,

    onError:
      typeof options.onError === "function"
        ? options.onError
        : null,
  };

  const state = {
    initialized: false,
    destroyed: false,
    playing: false,

    animationFrameId: null,
    lastTimestamp: null,

    tickerOffset: 0,
    tickerTextWidth: 0,

    mediaReady: false,
    currentFitMode: "contain",

    lastError: null,
    needsContinuousAnimation: false,
  };

  const cache = {
    tickerMetricKey: "",
    tickerConfigKey: "",
    tickerFont: "",
    tickerText: "",
    tickerGap: 0,
    tickerCycle: 0,
    tickerWidth: 0,

    boundMediaElement: null,
    mediaCleanup: [],
    moduleCleanup: [],

    motionQuery: null,
    colorProbeContext: null,

    lastSignature: "",
  };

  function now() {
    try {
      if (
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
      ) {
        return performance.now();
      }
    } catch {
      // Fall through to Date.now().
    }

    return Date.now();
  }

  function safeCallback(fn, ...args) {
    if (typeof fn !== "function") {
      return;
    }

    try {
      fn(...args);
    } catch (error) {
      reportError(
        "Renderer callback failed.",
        error,
        false
      );
    }
  }

  function reportError(
    message,
    cause = null,
    notify = true
  ) {
    const error =
      cause instanceof Error
        ? cause
        : new Error(message);

    state.lastError =
      error.message || message;

    if (notify) {
      safeCallback(
        callbacks.onError,
        error
      );
    }

    return {
      ok: false,
      error,
    };
  }

  function getState() {
    return Object.freeze({
      initialized: state.initialized,
      destroyed: state.destroyed,
      playing: state.playing,

      animationFrameId: state.animationFrameId,
      lastTimestamp: state.lastTimestamp,

      tickerOffset: state.tickerOffset,
      tickerTextWidth: state.tickerTextWidth,

      mediaReady: state.mediaReady,
      currentFitMode: state.currentFitMode,

      lastError: state.lastError,
      needsContinuousAnimation:
        state.needsContinuousAnimation,
    });
  }

  function clamp(
    value,
    fallback,
    min,
    max
  ) {
    const number = Number(value);

    return Number.isFinite(number)
      ? Math.min(
          max,
          Math.max(min, number)
        )
      : fallback;
  }

  function text(value) {
    return typeof value === "string"
      ? value.trim()
      : "";
  }

  function modulo(value, divisor) {
    if (
      !Number.isFinite(value) ||
      divisor <= 0
    ) {
      return 0;
    }

    return (
      ((value % divisor) + divisor) %
      divisor
    );
  }

  function invalidateCache() {
    cache.tickerMetricKey = "";
    cache.tickerConfigKey = "";
    cache.tickerFont = "";
    cache.tickerText = "";
    cache.tickerGap = 0;
    cache.tickerCycle = 0;
    cache.tickerWidth = 0;
    cache.lastSignature = "";

    state.tickerTextWidth = 0;
  }

  function validateCanvas() {
    if (
      typeof HTMLCanvasElement === "undefined" ||
      !(canvas instanceof HTMLCanvasElement)
    ) {
      return reportError(
        "Preview canvas element is missing or invalid.",
        new Error(
          "Expected an HTMLCanvasElement."
        )
      );
    }

    if (
      canvas.width !== CONFIG.WIDTH ||
      canvas.height !== CONFIG.HEIGHT
    ) {
      canvas.width = CONFIG.WIDTH;
      canvas.height = CONFIG.HEIGHT;
    }

    try {
      ctx = canvas.getContext("2d", {
        alpha: false,
      });
    } catch (error) {
      ctx = null;

      return reportError(
        "Canvas 2D context initialization failed.",
        error
      );
    }

    if (!ctx) {
      return reportError(
        "Canvas 2D rendering is unavailable in this browser.",
        new Error(
          "2D canvas context unavailable."
        )
      );
    }

    ctx.imageSmoothingEnabled = true;

    return {
      ok: true,
    };
  }

  function safeFitMode(value) {
    return FIT_MODES.has(value)
      ? value
      : "contain";
  }

  function safeColor(value, fallback) {
    const candidate = text(value);

    if (!candidate) {
      return fallback;
    }

    try {
      if (
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("color", candidate)
      ) {
        return candidate;
      }
    } catch {
      // Continue with canvas color validation.
    }

    try {
      if (!cache.colorProbeContext) {
        const probe =
          document.createElement("canvas");

        probe.width = 1;
        probe.height = 1;

        cache.colorProbeContext =
          probe.getContext("2d");
      }

      if (!cache.colorProbeContext) {
        return fallback;
      }

      const sentinel = "rgb(1, 2, 3)";

      cache.colorProbeContext.fillStyle =
        sentinel;

      cache.colorProbeContext.fillStyle =
        candidate;

      return cache.colorProbeContext.fillStyle ===
        sentinel
        ? fallback
        : candidate;
    } catch {
      return fallback;
    }
  }

  function reducedMotion() {
    try {
      if (
        !cache.motionQuery &&
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function"
      ) {
        cache.motionQuery =
          window.matchMedia(
            "(prefers-reduced-motion: reduce)"
          );
      }

      return Boolean(
        cache.motionQuery?.matches
      );
    } catch {
      return false;
    }
  }

  /**
   * Reads the exact render model exposed by news-ticker.js.
   *
   * Current news-ticker API:
   * enabled, text, position, direction, speed,
   * fontSize, textColor, backgroundColor, bold
   */
  function tickerModel() {
    if (
      !tickerModule ||
      typeof tickerModule.getRenderModel !==
        "function"
    ) {
      return EMPTY_TICKER;
    }

    try {
      const model =
        tickerModule.getRenderModel();

      if (
        !model ||
        typeof model !== "object"
      ) {
        return EMPTY_TICKER;
      }

      const headline = text(model.text);

      /*
       * Compatibility:
       * - New/current API uses model.enabled.
       * - Older renderer contracts may use model.visible.
       */
      const enabled =
        typeof model.enabled === "boolean"
          ? model.enabled
          : Boolean(model.visible);

      return Object.freeze({
        visible:
          enabled && headline.length > 0,

        text: headline,

        position: POSITIONS.has(
          model.position
        )
          ? model.position
          : "bottom",

        direction: DIRECTIONS.has(
          model.direction
        )
          ? model.direction
          : "rtl",

        speed: clamp(
          model.speed,
          8,
          CONFIG.MIN_SPEED,
          CONFIG.MAX_SPEED
        ),

        fontSize: clamp(
          model.fontSize,
          36,
          CONFIG.MIN_FONT_SIZE,
          CONFIG.MAX_FONT_SIZE
        ),

        textColor: safeColor(
          model.textColor,
          CONFIG.TICKER_TEXT
        ),

        backgroundColor: safeColor(
          model.backgroundColor,
          CONFIG.TICKER_BG
        ),

        bold: Boolean(model.bold),
      });
    } catch (error) {
      reportError(
        "News ticker render model could not be read.",
        error
      );

      return EMPTY_TICKER;
    }
  }

  function mediaInfo() {
    if (
      !mediaModule ||
      typeof mediaModule.getState !==
        "function"
    ) {
      return {
        state: null,
        element: null,
      };
    }

    let mediaState;

    try {
      mediaState =
        mediaModule.getState();
    } catch (error) {
      reportError(
        "Media state could not be read.",
        error
      );

      return {
        state: null,
        element: null,
      };
    }

    if (
      !mediaState?.hasMedia ||
      typeof mediaModule.getMediaElement !==
        "function"
    ) {
      return {
        state: mediaState,
        element: null,
      };
    }

    try {
      return {
        state: mediaState,
        element:
          mediaModule.getMediaElement(),
      };
    } catch (error) {
      reportError(
        "Media preview element could not be read.",
        error
      );

      return {
        state: mediaState,
        element: null,
      };
    }
  }

  function mediaDimensions(element, kind) {
    if (
      kind === "image" &&
      typeof HTMLImageElement !==
        "undefined" &&
      element instanceof HTMLImageElement
    ) {
      return element.naturalWidth > 0 &&
        element.naturalHeight > 0
        ? {
            width: element.naturalWidth,
            height: element.naturalHeight,
          }
        : null;
    }

    if (
      kind === "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement
    ) {
      return element.videoWidth > 0 &&
        element.videoHeight > 0
        ? {
            width: element.videoWidth,
            height: element.videoHeight,
          }
        : null;
    }

    return null;
  }

  function mediaReady(element, kind) {
    if (
      kind === "image" &&
      typeof HTMLImageElement !==
        "undefined" &&
      element instanceof HTMLImageElement
    ) {
      return (
        element.complete &&
        element.naturalWidth > 0 &&
        element.naturalHeight > 0
      );
    }

    if (
      kind === "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement
    ) {
      return (
        element.readyState >=
          CONFIG.VIDEO_READY_STATE &&
        element.videoWidth > 0 &&
        element.videoHeight > 0
      );
    }

    return false;
  }

  function fitRect(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    fitMode
  ) {
    const sw = Math.max(
      1,
      Number(sourceWidth) || 1
    );

    const sh = Math.max(
      1,
      Number(sourceHeight) || 1
    );

    const tw = Math.max(
      1,
      Number(targetWidth) || 1
    );

    const th = Math.max(
      1,
      Number(targetHeight) || 1
    );

    const scale =
      fitMode === "cover"
        ? Math.max(
            tw / sw,
            th / sh
          )
        : Math.min(
            tw / sw,
            th / sh
          );

    const width = sw * scale;
    const height = sh * scale;

    return {
      x: (tw - width) / 2,
      y: (th - height) / 2,
      width,
      height,
      scale,
    };
  }

  function bindMediaElement(element) {
    if (
      cache.boundMediaElement === element
    ) {
      return;
    }

    for (
      const cleanup of cache.mediaCleanup.splice(
        0
      )
    ) {
      try {
        cleanup();
      } catch {
        // Best effort.
      }
    }

    cache.boundMediaElement = null;

    const validImage =
      typeof HTMLImageElement !==
        "undefined" &&
      element instanceof HTMLImageElement;

    const validVideo =
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement;

    if (!validImage && !validVideo) {
      return;
    }

    const handler = () => {
      requestRender();
    };

    const events = [
      "load",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "durationchange",
      "seeked",
      "play",
      "playing",
      "pause",
      "ended",
      "error",
    ];

    for (const eventName of events) {
      element.addEventListener(
        eventName,
        handler
      );

      cache.mediaCleanup.push(() =>
        element.removeEventListener(
          eventName,
          handler
        )
      );
    }

    cache.boundMediaElement = element;
  }

  function bindModuleListeners() {
    if (
      cache.motionQuery &&
      typeof cache.motionQuery.addEventListener ===
        "function"
    ) {
      const motionHandler = () => {
        state.tickerOffset = 0;

        invalidateCache();
        requestRender();

        safeCallback(
          callbacks.onChange,
          {
            type: "reduced-motion-change",
            state: getState(),
          }
        );
      };

      cache.motionQuery.addEventListener(
        "change",
        motionHandler
      );

      cache.moduleCleanup.push(() =>
        cache.motionQuery?.removeEventListener?.(
          "change",
          motionHandler
        )
      );
    }

    if (
      typeof document !== "undefined" &&
      typeof document.addEventListener ===
        "function"
    ) {
      const visibilityHandler = () => {
        if (document.hidden) {
          cancelLoop();

          state.lastTimestamp = null;
          state.needsContinuousAnimation =
            false;

          return;
        }

        if (
          !state.initialized ||
          state.destroyed
        ) {
          return;
        }

        requestRender();

        if (
          state.playing &&
          state.needsContinuousAnimation
        ) {
          state.lastTimestamp = null;
          scheduleLoop();
        }
      };

      document.addEventListener(
        "visibilitychange",
        visibilityHandler
      );

      cache.moduleCleanup.push(() =>
        document.removeEventListener(
          "visibilitychange",
          visibilityHandler
        )
      );
    }
  }

  function drawEmpty() {
    ctx.fillStyle = CONFIG.EMPTY_BG;

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle = CONFIG.EMPTY_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 42px ${CONFIG.FONT_FAMILY}`;

    ctx.fillText(
      "मीडिया चुनें",
      canvas.width / 2,
      canvas.height / 2
    );
  }

  function drawMedia(
    mediaState,
    element
  ) {
    ctx.fillStyle = CONFIG.EMPTY_BG;

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    state.mediaReady = false;

    if (
      !mediaState?.hasMedia ||
      !element
    ) {
      return false;
    }

    const kind = text(
      mediaState.kind
    );

    const dimensions =
      mediaDimensions(
        element,
        kind
      );

    if (
      !dimensions ||
      !mediaReady(element, kind)
    ) {
      return false;
    }

    const rect = fitRect(
      dimensions.width,
      dimensions.height,
      canvas.width,
      canvas.height,
      state.currentFitMode
    );

    try {
      ctx.drawImage(
        element,
        rect.x,
        rect.y,
        rect.width,
        rect.height
      );

      state.mediaReady = true;

      return true;
    } catch (error) {
      reportError(
        "Media frame could not be rendered to canvas.",
        error
      );

      return false;
    }
  }

  function tickerFont(model) {
    return `${model.bold ? 700 : 400} ${model.fontSize}px ${CONFIG.FONT_FAMILY}`;
  }

  function tickerMetrics(model) {
    const font = tickerFont(model);

    const padding = Math.min(
      CONFIG.MAX_PADDING,
      Math.max(
        CONFIG.MIN_PADDING,
        model.fontSize *
          CONFIG.PADDING_RATIO
      )
    );

    const barHeight = Math.min(
      CONFIG.MAX_BAR_HEIGHT,
      Math.max(
        CONFIG.MIN_BAR_HEIGHT,
        Math.ceil(
          model.fontSize * 1.8
        )
      )
    );

    const gap = Math.max(
      CONFIG.MIN_GAP,
      model.fontSize * CONFIG.GAP_RATIO
    );

    const key = `${model.text}|${font}`;

    if (
      key !== cache.tickerMetricKey
    ) {
      ctx.font = font;

      cache.tickerMetricKey = key;
      cache.tickerFont = font;
      cache.tickerText = model.text;
      cache.tickerGap = gap;

      cache.tickerWidth = Math.max(
        1,
        ctx.measureText(model.text).width
      );

      cache.tickerCycle =
        cache.tickerWidth + gap;

      state.tickerTextWidth =
        cache.tickerWidth;

      state.tickerOffset = 0;
    } else if (
      cache.tickerGap !== gap
    ) {
      cache.tickerGap = gap;

      cache.tickerCycle =
        cache.tickerWidth + gap;
    }

    return {
      font,
      padding,
      barHeight,
      gap,
      width: cache.tickerWidth,
      cycle: Math.max(
        1,
        cache.tickerCycle
      ),
    };
  }

  function tickerY(
    position,
    barHeight
  ) {
    if (position === "top") {
      return 0;
    }

    if (position === "middle") {
      return Math.round(
        (canvas.height - barHeight) / 2
      );
    }

    return canvas.height - barHeight;
  }

  function drawTicker(
    model,
    deltaSeconds
  ) {
    if (
      !model.visible ||
      !model.text
    ) {
      return;
    }

    const metrics =
      tickerMetrics(model);

    const y = tickerY(
      model.position,
      metrics.barHeight
    );

    if (
      !reducedMotion() &&
      state.playing
    ) {
      const pxPerSecond =
        model.speed *
        CONFIG.SPEED_PX_PER_SECOND;

      state.tickerOffset +=
        pxPerSecond * deltaSeconds;
    }

    const centerY =
      y + metrics.barHeight / 2;

    ctx.save();

    ctx.beginPath();
    ctx.rect(
      0,
      y,
      canvas.width,
      metrics.barHeight
    );
    ctx.clip();

    ctx.fillStyle =
      model.backgroundColor;

    ctx.fillRect(
      0,
      y,
      canvas.width,
      metrics.barHeight
    );

    ctx.font = metrics.font;
    ctx.fillStyle = model.textColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const cycleOffset = modulo(
      state.tickerOffset,
      metrics.cycle
    );

    if (model.direction === "rtl") {
      /*
       * RTL: right to left.
       * As tickerOffset increases, x decreases.
       */
      let x =
        canvas.width - cycleOffset;

      while (x > -metrics.width) {
        ctx.fillText(
          model.text,
          x,
          centerY
        );

        x -= metrics.cycle;
      }

      x =
        canvas.width -
        cycleOffset -
        metrics.cycle;

      while (x + metrics.width > 0) {
        ctx.fillText(
          model.text,
          x,
          centerY
        );

        x -= metrics.cycle;
      }
    } else {
      /*
       * LTR: left to right.
       * As tickerOffset increases, x increases.
       */
      let x =
        -metrics.width + cycleOffset;

      while (x < canvas.width) {
        ctx.fillText(
          model.text,
          x,
          centerY
        );

        x += metrics.cycle;
      }

      x =
        -metrics.width +
        cycleOffset -
        metrics.cycle;

      while (x < canvas.width) {
        ctx.fillText(
          model.text,
          x,
          centerY
        );

        x += metrics.cycle;
      }
    }

    ctx.restore();
  }

  function signature(
    mediaState,
    element,
    ticker,
    drawn
  ) {
    return [
      Boolean(mediaState?.hasMedia),
      text(mediaState?.status),
      text(mediaState?.kind),
      text(mediaState?.fitMode),
      element ? element.tagName : "",
      Boolean(drawn),

      ticker.visible,
      ticker.text,
      ticker.position,
      ticker.direction,
      ticker.speed,
      ticker.fontSize,
      ticker.textColor,
      ticker.backgroundColor,
      ticker.bold,
    ].join("\u001f");
  }

  function emitChangeIfNeeded(
    mediaState,
    element,
    ticker,
    drawn
  ) {
    const next = signature(
      mediaState,
      element,
      ticker,
      drawn
    );

    if (
      next === cache.lastSignature
    ) {
      return;
    }

    cache.lastSignature = next;

    safeCallback(
      callbacks.onChange,
      {
        type: "render-change",
        state: getState(),
      }
    );
  }

  function renderFrame(timestamp) {
    if (
      !state.initialized ||
      state.destroyed ||
      !ctx
    ) {
      return;
    }

    if (
      typeof document !== "undefined" &&
      document.hidden
    ) {
      renderStaticFrame();

      state.lastTimestamp = null;
      state.needsContinuousAnimation =
        false;

      return;
    }

    const current =
      Number.isFinite(timestamp)
        ? timestamp
        : now();

    const previous =
      state.lastTimestamp;

    const delta = Math.min(
      CONFIG.MAX_DELTA_SECONDS,
      Math.max(
        0,
        previous === null
          ? 0
          : (current - previous) / 1000
      )
    );

    state.lastTimestamp = current;

    const {
      state: mediaState,
      element,
    } = mediaInfo();

    bindMediaElement(element);

    if (mediaState?.fitMode) {
      state.currentFitMode =
        safeFitMode(
          mediaState.fitMode
        );
    } else if (
      typeof mediaModule?.getFitMode ===
      "function"
    ) {
      try {
        state.currentFitMode =
          safeFitMode(
            mediaModule.getFitMode()
          );
      } catch {
        // Keep the last valid fit mode.
      }
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const drawn = drawMedia(
      mediaState,
      element
    );

    if (
      !drawn &&
      !mediaState?.hasMedia
    ) {
      drawEmpty();
    }

    const ticker = tickerModel();

    const tickerKey = [
      ticker.visible,
      ticker.text,
      ticker.position,
      ticker.direction,
      ticker.speed,
      ticker.fontSize,
      ticker.textColor,
      ticker.backgroundColor,
      ticker.bold,
    ].join("\u001f");

    if (
      tickerKey !==
      cache.tickerConfigKey
    ) {
      cache.tickerConfigKey =
        tickerKey;

      state.tickerOffset = 0;
    }

    const tickerAnimating =
      ticker.visible &&
      !reducedMotion() &&
      state.playing;

    const videoAnimating =
      drawn &&
      text(mediaState?.kind) ===
        "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement &&
      !element.paused &&
      !element.ended;

    drawTicker(
      ticker,
      delta
    );

    state.needsContinuousAnimation =
      Boolean(
        tickerAnimating ||
          videoAnimating
      );

    emitChangeIfNeeded(
      mediaState,
      element,
      ticker,
      drawn
    );
  }

  function renderStaticFrame() {
    if (
      !state.initialized ||
      state.destroyed ||
      !ctx
    ) {
      return;
    }

    const {
      state: mediaState,
      element,
    } = mediaInfo();

    bindMediaElement(element);

    if (mediaState?.fitMode) {
      state.currentFitMode =
        safeFitMode(
          mediaState.fitMode
        );
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const drawn = drawMedia(
      mediaState,
      element
    );

    if (
      !drawn &&
      !mediaState?.hasMedia
    ) {
      drawEmpty();
    }

    drawTicker(
      tickerModel(),
      0
    );

    state.needsContinuousAnimation =
      false;
  }

  function scheduleLoop() {
    if (
      state.animationFrameId !== null ||
      !state.playing ||
      state.destroyed ||
      !state.needsContinuousAnimation ||
      (
        typeof document !== "undefined" &&
        document.hidden
      )
    ) {
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !==
        "function"
    ) {
      state.playing = false;

      reportError(
        "requestAnimationFrame is unavailable in this browser.",
        new Error(
          "requestAnimationFrame is not supported."
        )
      );

      return;
    }

    state.animationFrameId =
      window.requestAnimationFrame(
        (timestamp) => {
          state.animationFrameId = null;

          try {
            if (
              !state.playing ||
              state.destroyed
            ) {
              return;
            }

            renderFrame(timestamp);
            scheduleLoop();
          } catch (error) {
            state.playing = false;
            state.needsContinuousAnimation =
              false;

            reportError(
              "Preview animation stopped after a rendering error.",
              error
            );
          }
        }
      );
  }

  function cancelLoop() {
    if (
      state.animationFrameId === null
    ) {
      return;
    }

    try {
      if (
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame ===
          "function"
      ) {
        window.cancelAnimationFrame(
          state.animationFrameId
        );
      }
    } catch {
      // Best effort.
    }

    state.animationFrameId = null;
  }

  function init() {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer cannot be reinitialized after destroy()."
        ),
        false
      );
    }

    if (state.initialized) {
      return {
        ok: true,
      };
    }

    if (
      typeof document === "undefined"
    ) {
      return reportError(
        "Canvas renderer requires a browser document.",
        new Error(
          "document unavailable."
        )
      );
    }

    const canvasResult =
      validateCanvas();

    if (!canvasResult.ok) {
      return canvasResult;
    }

    try {
      if (
        typeof window !== "undefined" &&
        typeof window.matchMedia ===
          "function"
      ) {
        cache.motionQuery =
          window.matchMedia(
            "(prefers-reduced-motion: reduce)"
          );
      }

      state.currentFitMode =
        safeFitMode(
          typeof mediaModule?.getFitMode ===
            "function"
            ? mediaModule.getFitMode()
            : "contain"
        );

      state.initialized = true;
      state.destroyed = false;
      state.playing = false;

      state.animationFrameId = null;
      state.lastTimestamp = null;

      state.tickerOffset = 0;
      state.tickerTextWidth = 0;

      state.mediaReady = false;
      state.lastError = null;
      state.needsContinuousAnimation =
        false;

      invalidateCache();
      bindModuleListeners();
      requestRender();

      safeCallback(
        callbacks.onReady,
        getState()
      );

      safeCallback(
        callbacks.onChange,
        {
          type: "ready",
          state: getState(),
        }
      );

      return {
        ok: true,
      };
    } catch (error) {
      state.initialized = false;

      cancelLoop();
      cleanupListeners();

      return reportError(
        "Canvas renderer initialization failed.",
        error
      );
    }
  }

  function play() {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer is destroyed."
        ),
        false
      );
    }

    if (!state.initialized) {
      return reportError(
        "Canvas renderer is not initialized.",
        new Error(
          "Call init() first."
        ),
        false
      );
    }

    if (state.playing) {
      return {
        ok: true,
      };
    }

    state.playing = true;
    state.lastTimestamp = null;
    state.lastError = null;

    const {
      state: mediaState,
      element,
    } = mediaInfo();

    const isVideo =
      text(mediaState?.kind) ===
        "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement;

    if (
      isVideo &&
      element.paused
    ) {
      try {
        const promise = element.play();

        promise?.catch?.(() => {
          // Browser autoplay policy may reject playback.
        });
      } catch {
        // Canvas ticker animation can still continue.
      }
    }

    renderFrame(now());
    scheduleLoop();

    safeCallback(
      callbacks.onChange,
      {
        type: "play",
        state: getState(),
      }
    );

    return {
      ok: true,
    };
  }

  function pause() {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer is destroyed."
        ),
        false
      );
    }

    if (!state.initialized) {
      return reportError(
        "Canvas renderer is not initialized.",
        new Error(
          "Call init() first."
        ),
        false
      );
    }

    const wasPlaying =
      state.playing;

    state.playing = false;
    state.needsContinuousAnimation =
      false;
    state.lastTimestamp = null;

    cancelLoop();

    const {
      state: mediaState,
      element,
    } = mediaInfo();

    const isVideo =
      text(mediaState?.kind) ===
        "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement;

    if (
      isVideo &&
      !element.paused
    ) {
      try {
        element.pause();
      } catch {
        // Static rendering remains available.
      }
    }

    if (wasPlaying) {
      renderFrame(now());

      safeCallback(
        callbacks.onChange,
        {
          type: "pause",
          state: getState(),
        }
      );
    }

    return {
      ok: true,
    };
  }

  function reset() {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer is destroyed."
        ),
        false
      );
    }

    if (!state.initialized) {
      return reportError(
        "Canvas renderer is not initialized.",
        new Error(
          "Call init() first."
        ),
        false
      );
    }

    state.playing = false;
    state.needsContinuousAnimation =
      false;
    state.lastTimestamp = null;
    state.tickerOffset = 0;
    state.lastError = null;

    cancelLoop();

    const {
      state: mediaState,
      element,
    } = mediaInfo();

    const isVideo =
      text(mediaState?.kind) ===
        "video" &&
      typeof HTMLVideoElement !==
        "undefined" &&
      element instanceof HTMLVideoElement;

    if (isVideo) {
      try {
        element.pause();
      } catch {
        // Best effort.
      }

      try {
        if (element.readyState > 0) {
          element.currentTime = 0;
        }
      } catch {
        // Some sources may not be seekable.
      }
    }

    invalidateCache();
    renderFrame(now());

    safeCallback(
      callbacks.onChange,
      {
        type: "reset",
        state: getState(),
      }
    );

    return {
      ok: true,
    };
  }

  function requestRender() {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer is destroyed."
        ),
        false
      );
    }

    if (
      !state.initialized ||
      !ctx
    ) {
      return reportError(
        "Canvas renderer is not initialized.",
        new Error(
          "Call init() first."
        ),
        false
      );
    }

    try {
      renderFrame(now());

      if (state.playing) {
        scheduleLoop();
      }

      return {
        ok: true,
      };
    } catch (error) {
      return reportError(
        "Preview render failed.",
        error
      );
    }
  }

  function setFitMode(fitMode) {
    if (state.destroyed) {
      return reportError(
        "Canvas renderer has been destroyed.",
        new Error(
          "Renderer is destroyed."
        ),
        false
      );
    }

    if (!state.initialized) {
      return reportError(
        "Canvas renderer is not initialized.",
        new Error(
          "Call init() first."
        ),
        false
      );
    }

    const next = safeFitMode(fitMode);

    if (
      next === state.currentFitMode
    ) {
      return {
        ok: true,
        fitMode: next,
      };
    }

    state.currentFitMode = next;

    invalidateCache();
    requestRender();

    safeCallback(
      callbacks.onChange,
      {
        type: "fit-mode-change",
        fitMode: next,
        state: getState(),
      }
    );

    return {
      ok: true,
      fitMode: next,
    };
  }

  function cleanupListeners() {
    for (
      const cleanup of cache.mediaCleanup.splice(
        0
      )
    ) {
      try {
        cleanup();
      } catch {
        // Best effort.
      }
    }

    cache.boundMediaElement = null;

    for (
      const cleanup of cache.moduleCleanup.splice(
        0
      )
    ) {
      try {
        cleanup();
      } catch {
        // Best effort.
      }
    }

    cache.motionQuery = null;
  }

  function destroy() {
    if (state.destroyed) {
      return {
        ok: true,
      };
    }

    state.playing = false;
    state.needsContinuousAnimation =
      false;
    state.lastTimestamp = null;

    cancelLoop();
    cleanupListeners();

    ctx = null;
    cache.colorProbeContext = null;

    invalidateCache();

    state.initialized = false;
    state.destroyed = true;
    state.mediaReady = false;
    state.tickerOffset = 0;
    state.tickerTextWidth = 0;

    safeCallback(
      callbacks.onChange,
      {
        type: "destroy",
        state: getState(),
      }
    );

    return {
      ok: true,
    };
  }

  return Object.freeze({
    init,
    play,
    pause,
    reset,
    requestRender,
    setFitMode,
    getState,
    destroy,
  });
}
