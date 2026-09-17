/**
 * Swar Srijan Studio
 * script.js
 *
 * Main application controller.
 *
 * Responsibilities:
 * - Bootstraps the application.
 * - Integrates the existing media module.
 * - Integrates the existing news ticker module.
 * - Integrates the canvas renderer module.
 * - Maintains centralized application state.
 * - Detects browser capabilities.
 * - Manages app-level status, loading, error and success UI.
 * - Handles form submission without backend/API calls.
 * - Registers the service worker when supported.
 *
 * No external dependencies.
 */

import { createMediaModule } from "./modules/media.js";
import { createNewsTickerModule } from "./modules/news-ticker.js";
import { createCanvasRendererModule } from "./modules/canvas-renderer.js";

const APP = Object.freeze({
  NAME: "Swar Srijan Studio",
  SERVICE_WORKER_URL: "./service-worker.js",
});

const SELECTORS = Object.freeze({
  form: "#studio-form",

  browserStatus: "#app-browser-status",

  appStatus: "#app-status",
  appError: "#app-error",
  appSuccess: "#app-success",
  appLoading: "#app-loading",

  mediaFileInput: "#media-file-input",
  mediaFitMode: "#media-fit-mode",
  mediaRemoveButton: "#media-remove-button",

  tickerRoot: "#news-ticker",

  previewCanvas: "#preview-canvas",
  previewPlayButton: "#preview-play-button",
  previewResetButton: "#preview-reset-button",
  previewStatus: "#preview-status",

  appVersion: "#app-version",

  canvasCapability: '[data-capability="canvas"]',
  speechCapability: '[data-capability="speech"]',
  mediaRecorderCapability: '[data-capability="media-recorder"]',
  mp4Capability: '[data-capability="mp4"]',
  pwaCapability: '[data-capability="pwa"]',
});

const STATUS_MESSAGES = Object.freeze({
  booting: "Swar Srijan Studio प्रारंभ हो रहा है…",
  ready: "स्टूडियो तैयार है। फोटो या वीडियो चुनकर शुरुआत करें।",
  mediaReady: "मीडिया तैयार है।",
  mediaCleared: "मीडिया हटा दिया गया है।",

  previewUnavailable:
    "Preview renderer अभी उपलब्ध नहीं है। मीडिया का native preview उपलब्ध होने पर वहीं से playback किया जा सकता है।",
  previewNoMedia:
    "Preview चलाने के लिए पहले फोटो या वीडियो चुनें।",
  previewReady: "Preview तैयार है।",
  previewPlaying: "Preview चल रहा है।",
  previewReset: "Preview रीसेट कर दिया गया है।",
  previewError: "Canvas preview में समस्या आई।",

  rendererUnavailable:
    "Canvas preview इस ब्राउज़र या वर्तमान पेज पर उपलब्ध नहीं है।",

  formPrevented:
    "यह ऐप browser में locally काम करता है। अभी server submission आवश्यक नहीं है।",

  serviceWorkerUnsupported:
    "इस ब्राउज़र में PWA service worker उपलब्ध नहीं है। ऐप फिर भी सामान्य रूप से काम करेगा।",
  serviceWorkerReady:
    "PWA offline support के लिए service worker सक्रिय है।",
  serviceWorkerFailed:
    "Service worker register नहीं हो सका। मुख्य app फिर भी सामान्य रूप से काम करेगी।",
});

const CAPABILITY_LABELS = Object.freeze({
  available: "उपलब्ध",
  unavailable: "उपलब्ध नहीं",
  limited: "सीमित",
});

/**
 * Centralized mutable application state.
 */
const appState = {
  initialized: false,
  initializing: false,

  status: "idle",
  currentError: null,
  currentSuccess: null,

  media: {
    initialized: false,
    status: "idle",
    hasMedia: false,
    kind: null,
    fileName: "",
    fitMode: "",
  },

  preview: {
    status: "ready",
  },

  capabilities: {
    canvas: false,
    speech: false,
    mediaRecorder: false,
    webm: false,
    mp4: false,
    fileApi: false,
    serviceWorker: false,
  },

  modules: {
    media: "not-initialized",
    quote: "not-available",
    tts: "not-available",
    ticker: "not-initialized",
    canvasRenderer: "not-initialized",
    recorder: "not-available",
  },

  serviceWorker: {
    status: "not-checked",
  },
};

let elements = null;
let mediaModule = null;
let tickerModule = null;
let canvasRendererModule = null;
let cleanupCallbacks = [];

/**
 * Application initialization.
 *
 * Safe to call more than once.
 */
async function initApp() {
  if (appState.initialized || appState.initializing) {
    return;
  }

  appState.initializing = true;

  try {
    elements = cacheElements();

    setLoading(true, STATUS_MESSAGES.booting);
    clearNotifications();
    setStatus(STATUS_MESSAGES.booting);

    appState.capabilities = detectCapabilities();

    renderCapabilityStatus(appState.capabilities);
    renderBrowserStatus(appState.capabilities);

    bindAppEvents();

    initializeMediaModule();
    initializeTickerModule();
    initializeCanvasRendererModule();

    initializePreviewControls();

    await initializeServiceWorker();

    renderInitialApplicationState();

    appState.initialized = true;

    /**
     * Do not overwrite an existing user-visible initialization error
     * with the generic "ready" message.
     */
    if (!appState.currentError) {
      appState.status = "ready";
      setStatus(STATUS_MESSAGES.ready);
    } else {
      appState.status = "degraded";
    }
  } catch (error) {
    appState.status = "error";

    const message = getUserFacingErrorMessage(
      error,
      "ऐप प्रारंभ करते समय एक अप्रत्याशित समस्या हुई।"
    );

    showError(message);

    logError("Application initialization failed.", error);
  } finally {
    appState.initializing = false;
    setLoading(false);
  }
}

/**
 * Resolve all known DOM nodes once.
 *
 * Missing optional nodes are allowed.
 */
function cacheElements() {
  return {
    form: document.querySelector(SELECTORS.form),

    browserStatus: document.querySelector(SELECTORS.browserStatus),

    appStatus: document.querySelector(SELECTORS.appStatus),
    appError: document.querySelector(SELECTORS.appError),
    appSuccess: document.querySelector(SELECTORS.appSuccess),
    appLoading: document.querySelector(SELECTORS.appLoading),

    mediaFileInput: document.querySelector(SELECTORS.mediaFileInput),
    mediaFitMode: document.querySelector(SELECTORS.mediaFitMode),
    mediaRemoveButton: document.querySelector(
      SELECTORS.mediaRemoveButton
    ),

    tickerRoot: document.querySelector(SELECTORS.tickerRoot),

    previewCanvas: document.querySelector(SELECTORS.previewCanvas),
    previewPlayButton: document.querySelector(
      SELECTORS.previewPlayButton
    ),
    previewResetButton: document.querySelector(
      SELECTORS.previewResetButton
    ),
    previewStatus: document.querySelector(SELECTORS.previewStatus),

    appVersion: document.querySelector(SELECTORS.appVersion),

    canvasCapability: document.querySelector(
      SELECTORS.canvasCapability
    ),
    speechCapability: document.querySelector(
      SELECTORS.speechCapability
    ),
    mediaRecorderCapability: document.querySelector(
      SELECTORS.mediaRecorderCapability
    ),
    mp4Capability: document.querySelector(SELECTORS.mp4Capability),
    pwaCapability: document.querySelector(SELECTORS.pwaCapability),
  };
}

/**
 * Attach application-level event listeners.
 */
function bindAppEvents() {
  if (!elements) {
    return;
  }

  if (elements.form instanceof HTMLFormElement) {
    const handler = handleFormSubmit;

    elements.form.addEventListener("submit", handler);

    cleanupCallbacks.push(() => {
      elements?.form?.removeEventListener("submit", handler);
    });
  }

  if (elements.previewPlayButton instanceof HTMLButtonElement) {
    const handler = handlePreviewPlayRequest;

    elements.previewPlayButton.addEventListener("click", handler);

    cleanupCallbacks.push(() => {
      elements?.previewPlayButton?.removeEventListener(
        "click",
        handler
      );
    });
  }

  if (elements.previewResetButton instanceof HTMLButtonElement) {
    const handler = handlePreviewResetRequest;

    elements.previewResetButton.addEventListener("click", handler);

    cleanupCallbacks.push(() => {
      elements?.previewResetButton?.removeEventListener(
        "click",
        handler
      );
    });
  }

  /**
   * Keep app-level preview actions synchronized with media removal.
   *
   * media.js remains the owner of the actual removal operation.
   */
  if (elements.mediaRemoveButton instanceof HTMLButtonElement) {
    const handler = handleMediaRemoveButtonClick;

    elements.mediaRemoveButton.addEventListener("click", handler);

    cleanupCallbacks.push(() => {
      elements?.mediaRemoveButton?.removeEventListener(
        "click",
        handler
      );
    });
  }
}

/**
 * Media module initialization.
 */
function initializeMediaModule() {
  appState.modules.media = "initializing";

  try {
    mediaModule = createMediaModule({
      root: document,

      onChange: handleMediaChange,
      onError: handleMediaError,
      onFitModeChange: handleMediaFitModeChange,
    });

    if (
      !mediaModule ||
      typeof mediaModule.init !== "function"
    ) {
      appState.modules.media = "error";

      const error = new Error(
        "Media module factory did not return a valid module."
      );

      showError("मीडिया मॉड्यूल उपलब्ध नहीं है।");

      logError(
        "Media module factory returned an invalid module.",
        error
      );

      mediaModule = null;
      return;
    }

    const result = mediaModule.init();

    if (!result?.ok) {
      appState.modules.media = "error";

      const message =
        result?.error?.message ||
        "मीडिया मॉड्यूल प्रारंभ नहीं हो सका।";

      showError(message);

      logError(
        "Media module initialization failed.",
        result?.error
      );

      return;
    }

    appState.modules.media = "ready";
    appState.media.initialized = true;

    syncMediaState();
  } catch (error) {
    appState.modules.media = "error";

    showError(
      getUserFacingErrorMessage(
        error,
        "मीडिया सुविधा प्रारंभ नहीं हो सकी।"
      )
    );

    logError("Media module threw during initialization.", error);
  }
}

/**
 * News ticker module initialization.
 *
 * The ticker owns its own DOM rendering, settings and animation.
 * script.js only connects it to the application lifecycle.
 *
 * The same ticker module instance is passed directly to
 * canvas-renderer.js so the renderer can consume the ticker's
 * current render model.
 *
 * Missing ticker DOM is treated as a graceful unavailable state
 * and does not prevent the rest of the application from starting.
 */
function initializeTickerModule() {
  appState.modules.ticker = "initializing";

  const tickerRoot = elements?.tickerRoot;

  if (!(tickerRoot instanceof HTMLElement)) {
    appState.modules.ticker = "not-available";

    logError(
      "News ticker root element was not found.",
      new Error(`Missing element: ${SELECTORS.tickerRoot}`)
    );

    return;
  }

  try {
    tickerModule = createNewsTickerModule({
      root: tickerRoot,

      onChange: () => {
        if (appState.modules.ticker !== "error") {
          appState.modules.ticker = "ready";
        }

        /**
         * Ticker changes must trigger the existing renderer to
         * produce a fresh canvas frame. The renderer remains the
         * owner of the actual drawing/animation loop.
         */
        requestCanvasRender();
      },

      onError: (error) => {
        appState.modules.ticker = "error";

        const message =
          getUserFacingErrorMessage(
            error,
            "न्यूज़ टिकर में समस्या आई।"
          );

        showError(message);

        logError("News ticker module error.", error);

        requestCanvasRender();
      },

      onReady: () => {
        appState.modules.ticker = "ready";
        requestCanvasRender();
      },

      onVisibilityChange: () => {
        if (appState.modules.ticker !== "error") {
          appState.modules.ticker = "ready";
        }

        requestCanvasRender();
      },
    });

    if (
      !tickerModule ||
      typeof tickerModule.init !== "function"
    ) {
      appState.modules.ticker = "error";

      const error = new Error(
        "News ticker module factory did not return a valid module."
      );

      showError("न्यूज़ टिकर मॉड्यूल उपलब्ध नहीं है।");

      logError(
        "News ticker module factory returned an invalid module.",
        error
      );

      tickerModule = null;
      return;
    }

    const result = tickerModule.init();

    if (result && result.ok === false) {
      appState.modules.ticker = "error";

      const message =
        result?.error?.message ||
        "न्यूज़ टिकर मॉड्यूल प्रारंभ नहीं हो सका।";

      showError(message);

      logError(
        "News ticker module initialization failed.",
        result?.error
      );

      return;
    }

    appState.modules.ticker = "ready";
    requestCanvasRender();
  } catch (error) {
    appState.modules.ticker = "error";

    showError(
      getUserFacingErrorMessage(
        error,
        "न्यूज़ टिकर सुविधा प्रारंभ नहीं हो सकी।"
      )
    );

    logError(
      "News ticker module threw during initialization.",
      error
    );
  }
}

/**
 * Canvas renderer module initialization.
 *
 * canvas-renderer.js owns:
 * - Canvas drawing
 * - Canvas animation
 * - Canvas frame scheduling
 *
 * script.js only coordinates lifecycle and user actions.
 */
function initializeCanvasRendererModule() {
  appState.modules.canvasRenderer = "initializing";

  const canvas = elements?.previewCanvas;

  if (!(canvas instanceof HTMLCanvasElement)) {
    appState.modules.canvasRenderer = "not-available";

    logError(
      "Canvas preview element was not found or is invalid.",
      new Error(`Missing or invalid element: ${SELECTORS.previewCanvas}`)
    );

    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  /**
   * Canvas capability probing can itself throw in unusual browser
   * environments. Keep initialization graceful instead of allowing
   * a getContext() exception to break the entire app.
   */
  let context = null;

  try {
    if (typeof canvas.getContext === "function") {
      context = canvas.getContext("2d");
    }
  } catch (error) {
    logError(
      "Canvas 2D context acquisition failed.",
      error
    );
    context = null;
  }

  if (!context) {
    appState.modules.canvasRenderer = "not-available";

    logError(
      "Canvas 2D context is not available.",
      new Error("The preview canvas does not expose a usable 2D context.")
    );

    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  if (typeof createCanvasRendererModule !== "function") {
    appState.modules.canvasRenderer = "not-available";

    const error = new Error(
      "Canvas renderer factory is not available."
    );

    logError(
      "Canvas renderer factory import is unavailable.",
      error
    );

    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  try {
    /**
     * IMPORTANT:
     * The updated canvas-renderer.js receives the existing ticker
     * module directly. No compatibility wrapper or alternate
     * ticker-renderer API is introduced here.
     */
    canvasRendererModule = createCanvasRendererModule({
      canvas,
      mediaModule,
      tickerModule,

      onReady: () => {
        appState.modules.canvasRenderer = "ready";

        updatePreviewControlsFromMediaState({
          preservePreviewStatus: false,
        });

        if (appState.media.hasMedia) {
          appState.preview.status = "ready";
          setPreviewStatus(STATUS_MESSAGES.previewReady);
        } else {
          appState.preview.status = "no-media";
          setPreviewStatus(STATUS_MESSAGES.previewNoMedia);
        }
      },

      onChange: (event) => {
        /**
         * The renderer owns canvas rendering and animation.
         * Do not call requestCanvasRender() here because doing so
         * could create a recursive render/change cycle.
         *
         * Also do NOT blindly reset the preview message to
         * "Preview तैयार है." here. The explicit Play/Reset actions
         * intentionally own their transient UI feedback.
         */
        if (
          event?.type === "ready" &&
          appState.modules.canvasRenderer !== "error"
        ) {
          appState.modules.canvasRenderer = "ready";
        }

        updatePreviewControlsFromMediaState({
          preservePreviewStatus: true,
        });
      },

      onError: (error) => {
        appState.modules.canvasRenderer = "error";
        appState.preview.status = "error";

        const message = getUserFacingErrorMessage(
          error,
          STATUS_MESSAGES.previewError
        );

        setPreviewStatus(message);
        showError(message);

        logError("Canvas renderer error.", error);

        /**
         * Native media functionality remains independent and should
         * continue working even if canvas rendering fails.
         */
        updatePreviewControlsFromMediaState({
          preservePreviewStatus: false,
        });
      },
    });

    if (
      !canvasRendererModule ||
      typeof canvasRendererModule.init !== "function"
    ) {
      appState.modules.canvasRenderer = "error";
      appState.preview.status = "error";

      const error = new Error(
        "Canvas renderer factory did not return a valid module."
      );

      setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);

      logError(
        "Canvas renderer factory returned an invalid module.",
        error
      );

      canvasRendererModule = null;
      return;
    }

    const result = canvasRendererModule.init();

    if (!result?.ok) {
      appState.modules.canvasRenderer = "error";
      appState.preview.status = "error";

      const message =
        result?.error?.message ||
        STATUS_MESSAGES.previewError;

      setPreviewStatus(message);
      showError(message);

      logError(
        "Canvas renderer initialization failed.",
        result?.error
      );

      return;
    }

    appState.modules.canvasRenderer = "ready";

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });

    requestCanvasRender();
  } catch (error) {
    appState.modules.canvasRenderer = "error";
    appState.preview.status = "error";

    const message = getUserFacingErrorMessage(
      error,
      STATUS_MESSAGES.previewError
    );

    setPreviewStatus(message);
    showError(message);

    logError(
      "Canvas renderer threw during initialization.",
      error
    );

    /**
     * Do not throw again. The rest of the application, including
     * native media preview and ticker settings, must remain usable.
     */
  }
}

/**
 * Safely request a canvas render.
 *
 * This helper does not create an animation loop. The renderer module
 * remains the sole owner of requestAnimationFrame and canvas drawing.
 */
function requestCanvasRender() {
  if (
    appState.modules.canvasRenderer !== "ready" ||
    !canvasRendererModule ||
    typeof canvasRendererModule.requestRender !== "function"
  ) {
    return;
  }

  try {
    const result = canvasRendererModule.requestRender();

    if (result?.ok === false) {
      logError(
        "Canvas renderer requestRender returned a failure.",
        result?.error
      );
    }
  } catch (error) {
    logError(
      "Canvas renderer requestRender failed.",
      error
    );
  }
}

/**
 * Preview controls.
 *
 * Controls are enabled only when both the renderer and media are ready.
 * Native HTML video controls inside media.js remain independent.
 */
function initializePreviewControls() {
  updatePreviewControlsFromMediaState({
    preservePreviewStatus: false,
  });
}

/**
 * Handles media-module changes.
 */
function handleMediaChange(event) {
  syncMediaState();

  const reason = normalizeString(event?.reason);

  /**
   * A media change is a fresh preview state. Any transient
   * "playing"/"reset" feedback from the previous media should not
   * survive a new media selection/removal.
   */
  if (reason === "ready") {
    appState.preview.status = "ready";
  } else if (reason === "cleared") {
    appState.preview.status = "no-media";
  } else if (reason === "validation-error") {
    appState.preview.status = "error";
  } else if (reason === "preview-error") {
    appState.preview.status = "error";
  }

  requestCanvasRender();

  if (reason === "ready") {
    setStatus(STATUS_MESSAGES.mediaReady);
    clearError();

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });

    return;
  }

  if (reason === "cleared") {
    setStatus(STATUS_MESSAGES.mediaCleared);

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });

    return;
  }

  if (reason === "validation-error") {
    setStatus("मीडिया फ़ाइल की जाँच पूरी नहीं हो सकी।");

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });

    return;
  }

  if (reason === "preview-error") {
    setStatus("मीडिया प्रीव्यू में समस्या आई।");

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });
  }
}

/**
 * Handles media-module errors.
 */
function handleMediaError(event) {
  const message = getUserFacingErrorMessage(
    event?.error,
    "मीडिया फ़ाइल को संसाधित नहीं किया जा सका।"
  );

  showError(message);

  appState.preview.status = "error";

  requestCanvasRender();
}

/**
 * Handles fit-mode changes from media.js.
 *
 * media.js remains the owner of the fit-mode state.
 */
function handleMediaFitModeChange(event) {
  const fitMode = normalizeString(event?.fitMode);

  if (fitMode) {
    appState.media.fitMode = fitMode;
  }

  requestCanvasRender();
}

/**
 * Media remove button synchronization.
 *
 * media.js remains the owner of the actual file-removal operation.
 */
function handleMediaRemoveButtonClick() {
  window.setTimeout(() => {
    syncMediaState();

    if (!appState.media.hasMedia) {
      appState.preview.status = "no-media";
    } else {
      appState.preview.status = "ready";
    }

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: false,
    });

    requestCanvasRender();
  }, 0);
}

/**
 * Synchronize appState.media with media.js.
 */
function syncMediaState() {
  if (!mediaModule || typeof mediaModule.getState !== "function") {
    return;
  }

  try {
    const mediaState = mediaModule.getState();

    appState.media = {
      initialized: true,
      status: mediaState?.status || "idle",
      hasMedia: Boolean(mediaState?.hasMedia),
      kind: mediaState?.kind || null,
      fileName: mediaState?.fileName || "",
      fitMode: mediaState?.fitMode || "",
    };

    updatePreviewControlsFromMediaState({
      preservePreviewStatus: true,
    });
  } catch (error) {
    logError("Could not synchronize media state.", error);
  }
}

/**
 * Update preview actions based on actual current state.
 *
 * Required condition:
 * renderer ready AND media available
 *
 * Native HTML video controls are not affected.
 *
 * preservePreviewStatus:
 * - true  => keep explicit Play/Reset feedback when still valid.
 * - false => derive the status from the current renderer/media state.
 */
function updatePreviewControlsFromMediaState({
  preservePreviewStatus = false,
} = {}) {
  const rendererReady =
    appState.modules.canvasRenderer === "ready";

  const shouldEnable =
    rendererReady && appState.media.hasMedia;

  setPreviewControlsEnabled(shouldEnable);

  /**
   * No media must have its own explicit message.
   * Do not report "renderer unavailable" when the real condition
   * is simply that the user has not selected media.
   */
  if (!appState.media.hasMedia) {
    appState.preview.status = "no-media";
    setPreviewStatus(STATUS_MESSAGES.previewNoMedia);
    return;
  }

  if (!rendererReady) {
    appState.preview.status = "unavailable";
    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  if (
    appState.modules.canvasRenderer === "error" ||
    appState.modules.canvasRenderer === "not-available"
  ) {
    appState.preview.status = "unavailable";
    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  /**
   * Keep explicit action feedback alive across normal renderer
   * change notifications.
   */
  if (
    preservePreviewStatus &&
    (
      appState.preview.status === "playing" ||
      appState.preview.status === "reset"
    )
  ) {
    if (appState.preview.status === "playing") {
      setPreviewStatus(STATUS_MESSAGES.previewPlaying);
    } else {
      setPreviewStatus(STATUS_MESSAGES.previewReset);
    }

    return;
  }

  appState.preview.status = "ready";
  setPreviewStatus(STATUS_MESSAGES.previewReady);
}

/**
 * Form submission is local-only.
 */
function handleFormSubmit(event) {
  event.preventDefault();

  clearError();
  clearSuccess();

  setStatus(STATUS_MESSAGES.formPrevented);
}

/**
 * Play canvas preview using the actual renderer.
 */
function handlePreviewPlayRequest() {
  const rendererReady =
    appState.modules.canvasRenderer === "ready";

  if (!rendererReady || !canvasRendererModule) {
    appState.preview.status = "unavailable";

    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    setStatus(STATUS_MESSAGES.rendererUnavailable);

    return;
  }

  if (!appState.media.hasMedia) {
    appState.preview.status = "no-media";

    setPreviewStatus(STATUS_MESSAGES.previewNoMedia);
    setStatus(STATUS_MESSAGES.previewNoMedia);

    return;
  }

  if (typeof canvasRendererModule.play !== "function") {
    appState.preview.status = "error";

    const error = new Error(
      "Canvas renderer play method is unavailable."
    );

    setPreviewStatus(STATUS_MESSAGES.previewError);
    showError(STATUS_MESSAGES.previewError);

    logError(
      "Canvas renderer play method is unavailable.",
      error
    );

    return;
  }

  try {
    const result = canvasRendererModule.play();

    if (result?.ok === false) {
      appState.preview.status = "error";

      const message =
        result?.error?.message ||
        STATUS_MESSAGES.previewError;

      setPreviewStatus(message);
      showError(message);

      logError(
        "Canvas renderer play operation failed.",
        result?.error
      );

      return;
    }

    /**
     * Store explicit action state so a renderer onChange callback
     * cannot immediately overwrite it with "Preview तैयार है।"
     */
    appState.preview.status = "playing";

    setPreviewStatus(STATUS_MESSAGES.previewPlaying);
    setStatus(STATUS_MESSAGES.previewPlaying);
  } catch (error) {
    appState.preview.status = "error";

    const message = getUserFacingErrorMessage(
      error,
      STATUS_MESSAGES.previewError
    );

    setPreviewStatus(message);
    showError(message);

    logError(
      "Canvas renderer play operation threw.",
      error
    );
  }
}

/**
 * Reset canvas preview using the actual renderer.
 */
function handlePreviewResetRequest() {
  const rendererReady =
    appState.modules.canvasRenderer === "ready";

  if (!rendererReady || !canvasRendererModule) {
    appState.preview.status = "unavailable";

    setPreviewStatus(STATUS_MESSAGES.rendererUnavailable);
    return;
  }

  if (!appState.media.hasMedia) {
    appState.preview.status = "no-media";

    setPreviewStatus(STATUS_MESSAGES.previewNoMedia);
    setStatus(STATUS_MESSAGES.previewNoMedia);

    return;
  }

  if (typeof canvasRendererModule.reset !== "function") {
    appState.preview.status = "error";

    const error = new Error(
      "Canvas renderer reset method is unavailable."
    );

    setPreviewStatus(STATUS_MESSAGES.previewError);
    showError(STATUS_MESSAGES.previewError);

    logError(
      "Canvas renderer reset method is unavailable.",
      error
    );

    return;
  }

  try {
    const result = canvasRendererModule.reset();

    if (result?.ok === false) {
      appState.preview.status = "error";

      const message =
        result?.error?.message ||
        STATUS_MESSAGES.previewError;

      setPreviewStatus(message);
      showError(message);

      logError(
        "Canvas renderer reset operation failed.",
        result?.error
      );

      return;
    }

    /**
     * Store explicit reset state before the renderer emits any
     * normal change event.
     */
    appState.preview.status = "reset";

    setPreviewStatus(STATUS_MESSAGES.previewReset);
    setStatus(STATUS_MESSAGES.previewReset);
  } catch (error) {
    appState.preview.status = "error";

    const message = getUserFacingErrorMessage(
      error,
      STATUS_MESSAGES.previewError
    );

    setPreviewStatus(message);
    showError(message);

    logError(
      "Canvas renderer reset operation threw.",
      error
    );
  }
}

/**
 * Detect browser capabilities using real browser APIs.
 */
function detectCapabilities() {
  const canvas = detectCanvasSupport();
  const speech = detectSpeechSupport();
  const mediaRecorder = detectMediaRecorderSupport();

  const webm = detectMediaRecorderMimeSupport([
    'video/webm;codecs="vp9,opus"',
    'video/webm;codecs="vp8,opus"',
    "video/webm",
  ]);

  const mp4 = detectMediaRecorderMimeSupport([
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4",
  ]);

  const fileApi =
    typeof File !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function";

  const serviceWorker =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator;

  return {
    canvas,
    speech,
    mediaRecorder,
    webm,
    mp4,
    fileApi,
    serviceWorker,
  };
}

function detectCanvasSupport() {
  if (typeof document === "undefined") {
    return false;
  }

  try {
    const canvas = document.createElement("canvas");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return false;
    }

    if (typeof canvas.getContext !== "function") {
      return false;
    }

    return Boolean(canvas.getContext("2d"));
  } catch (error) {
    logError("Canvas capability detection failed.", error);
    return false;
  }
}

function detectSpeechSupport() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.speechSynthesis?.speak === "function"
  );
}

function detectMediaRecorderSupport() {
  return (
    typeof window !== "undefined" &&
    "MediaRecorder" in window &&
    typeof window.MediaRecorder === "function"
  );
}

function detectMediaRecorderMimeSupport(mimeTypes) {
  if (!detectMediaRecorderSupport()) {
    return false;
  }

  if (
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return false;
  }

  return mimeTypes.some((mimeType) => {
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });
}

/**
 * Render browser capability information.
 */
function renderCapabilityStatus(capabilities) {
  setCapabilityText(
    elements?.canvasCapability,
    capabilities.canvas
  );

  setCapabilityText(
    elements?.speechCapability,
    capabilities.speech
  );

  setCapabilityText(
    elements?.mediaRecorderCapability,
    capabilities.mediaRecorder
  );

  setCapabilityText(
    elements?.mp4Capability,
    capabilities.mp4
  );

  setCapabilityText(
    elements?.pwaCapability,
    capabilities.serviceWorker
  );
}

function setCapabilityText(element, supported) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.textContent = supported
    ? CAPABILITY_LABELS.available
    : CAPABILITY_LABELS.unavailable;
}

/**
 * Update browser status.
 */
function renderBrowserStatus(capabilities) {
  const element = elements?.browserStatus;

  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (!capabilities.fileApi) {
    element.textContent = "ब्राउज़र सुविधा सीमित";
    return;
  }

  if (!capabilities.canvas) {
    element.textContent = "Canvas सीमित";
    return;
  }

  element.textContent = "ब्राउज़र तैयार";
}

/**
 * Register service worker.
 *
 * PWA support is an enhancement, not a critical dependency.
 * A missing/incompatible service worker must not make the main
 * application appear broken.
 */
async function initializeServiceWorker() {
  if (!elements) {
    return;
  }

  if (!appState.capabilities.serviceWorker) {
    appState.serviceWorker.status = "unsupported";
    return;
  }

  if (!window.isSecureContext) {
    appState.serviceWorker.status = "insecure-context";
    return;
  }

  try {
    const registration =
      await navigator.serviceWorker.register(
        APP.SERVICE_WORKER_URL,
        {
          scope: "./",
        }
      );

    if (registration) {
      appState.serviceWorker.status = "registered";

      /**
       * Success is deliberately non-destructive:
       * showSuccess() no longer clears an unrelated app error.
       */
      showSuccess(STATUS_MESSAGES.serviceWorkerReady);
    }
  } catch (error) {
    /**
     * Service worker failure is deliberately not promoted to the
     * main app error channel. The core app can continue normally.
     */
    appState.serviceWorker.status = "error";

    logError(
      "Service worker registration failed. The main application will continue.",
      error
    );
  }
}

/**
 * Initial UI synchronization.
 */
function renderInitialApplicationState() {
  syncMediaState();

  updatePreviewControlsFromMediaState({
    preservePreviewStatus: false,
  });

  requestCanvasRender();

  /**
   * Do not use "renderer unavailable" for the no-media state.
   * updatePreviewControlsFromMediaState() already assigns the
   * correct explicit no-media status.
   */
}

/**
 * Enable/disable preview controls.
 */
function setPreviewControlsEnabled(enabled) {
  if (elements?.previewPlayButton instanceof HTMLButtonElement) {
    elements.previewPlayButton.disabled = !enabled;
  }

  if (elements?.previewResetButton instanceof HTMLButtonElement) {
    elements.previewResetButton.disabled = !enabled;
  }
}

/**
 * Application status helper.
 */
function setStatus(message) {
  const normalized = normalizeString(message);

  appState.status = normalized || "ready";

  if (elements?.appStatus instanceof HTMLElement) {
    elements.appStatus.textContent =
      normalized || STATUS_MESSAGES.ready;
  }
}

/**
 * User-facing error helper.
 */
function showError(message) {
  const normalized =
    normalizeString(message) ||
    "कुछ अप्रत्याशित समस्या हुई।";

  appState.currentError = normalized;

  /**
   * An error takes precedence over any old success state.
   */
  appState.currentSuccess = null;

  if (elements?.appError instanceof HTMLElement) {
    elements.appError.textContent = normalized;
    elements.appError.hidden = false;
  }

  if (elements?.appSuccess instanceof HTMLElement) {
    elements.appSuccess.textContent = "";
    elements.appSuccess.hidden = true;
  }

  if (elements?.appStatus instanceof HTMLElement) {
    elements.appStatus.textContent = normalized;
  }
}

function clearError() {
  appState.currentError = null;

  if (elements?.appError instanceof HTMLElement) {
    elements.appError.textContent = "";
    elements.appError.hidden = true;
  }
}

/**
 * User-facing success helper.
 *
 * Important:
 * A success notification must NOT clear an unrelated application
 * error. This matters when an optional subsystem such as the service
 * worker succeeds while another subsystem has already reported an
 * error.
 */
function showSuccess(message) {
  const normalized = normalizeString(message);

  if (!normalized) {
    clearSuccess();
    return;
  }

  appState.currentSuccess = normalized;

  /**
   * Do not mutate appState.currentError here.
   *
   * If an error already exists, the error remains visible.
   */
  if (elements?.appSuccess instanceof HTMLElement) {
    elements.appSuccess.textContent = normalized;
    elements.appSuccess.hidden = false;
  }
}

function setSuccess(message) {
  showSuccess(message);
}

function clearSuccess() {
  appState.currentSuccess = null;

  if (elements?.appSuccess instanceof HTMLElement) {
    elements.appSuccess.textContent = "";
    elements.appSuccess.hidden = true;
  }
}

function clearNotifications() {
  clearError();
  clearSuccess();
}

function setLoading(isLoading, message = "") {
  if (!(elements?.appLoading instanceof HTMLElement)) {
    return;
  }

  elements.appLoading.hidden = !isLoading;

  if (isLoading && message) {
    elements.appLoading.textContent = message;
  }

  if (!isLoading) {
    elements.appLoading.textContent = "";
  }
}

function setPreviewStatus(message) {
  const normalized = normalizeString(message);

  if (elements?.previewStatus instanceof HTMLElement) {
    elements.previewStatus.textContent = normalized || "";
  }
}

/**
 * Defensive user-facing error conversion.
 */
function getUserFacingErrorMessage(error, fallback) {
  const candidate =
    error &&
    typeof error === "object" &&
    "message" in error
      ? error.message
      : "";

  return normalizeString(candidate) || fallback;
}

/**
 * Development diagnostics only.
 */
function logError(message, error) {
  if (
    typeof console === "undefined" ||
    typeof console.error !== "function"
  ) {
    return;
  }

  if (error instanceof Error) {
    console.error(`[${APP.NAME}] ${message}`, error);
    return;
  }

  console.error(`[${APP.NAME}] ${message}`, error);
}

/**
 * Safe string normalization.
 */
function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

/**
 * Internal cleanup hook.
 *
 * Renderer is destroyed before media and ticker so that any renderer
 * listeners attached to media elements are removed first.
 */
function cleanupApp() {
  for (const cleanup of cleanupCallbacks.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      logError(
        "Application cleanup callback failed.",
        error
      );
    }
  }

  if (canvasRendererModule) {
    try {
      if (typeof canvasRendererModule.destroy === "function") {
        canvasRendererModule.destroy();
      }
    } catch (error) {
      logError(
        "Canvas renderer cleanup failed.",
        error
      );
    }
  }

  if (mediaModule) {
    try {
      if (typeof mediaModule.destroy === "function") {
        mediaModule.destroy();
      }
    } catch (error) {
      logError(
        "Media module cleanup failed.",
        error
      );
    }
  }

  if (tickerModule) {
    try {
      if (typeof tickerModule.destroy === "function") {
        tickerModule.destroy();
      }
    } catch (error) {
      logError(
        "News ticker module cleanup failed.",
        error
      );
    }
  }

  canvasRendererModule = null;
  mediaModule = null;
  tickerModule = null;

  appState.modules.canvasRenderer = "not-initialized";
  appState.modules.media = "not-initialized";
  appState.modules.ticker = "not-initialized";

  appState.media.initialized = false;
  appState.preview.status = "ready";

  appState.initialized = false;
  appState.initializing = false;
}

/**
 * Bootstrap.
 */
function bootstrap() {
  if (typeof document === "undefined") {
    return;
  }

  if (document.readyState === "loading") {
    const handler = () => {
      document.removeEventListener(
        "DOMContentLoaded",
        handler
      );

      void initApp();
    };

    document.addEventListener(
      "DOMContentLoaded",
      handler,
      {
        once: true,
      }
    );

    return;
  }

  void initApp();
}

bootstrap();
