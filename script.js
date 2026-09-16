/**
 * Swar Srijan Studio
 * script.js
 *
 * Main application controller.
 *
 * Responsibilities:
 * - Bootstraps the application.
 * - Integrates the existing media module.
 * - Maintains centralized application state.
 * - Detects browser capabilities.
 * - Manages app-level status, loading, error and success UI.
 * - Handles form submission without backend/API calls.
 * - Registers the service worker when supported.
 * - Keeps integration points ready for future modules without importing
 *   modules that do not exist yet.
 *
 * No external dependencies.
 */

import { createMediaModule } from "./modules/media.js";

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
    "Canvas Renderer अभी उपलब्ध नहीं है। Preview rendering अगले module के जुड़ने पर सक्रिय होगा।",
  formPrevented:
    "यह ऐप browser में locally काम करता है। अभी server submission आवश्यक नहीं है।",
  serviceWorkerUnsupported:
    "इस ब्राउज़र में PWA service worker उपलब्ध नहीं है। ऐप फिर भी सामान्य रूप से काम करेगा।",
  serviceWorkerReady: "PWA offline support के लिए service worker सक्रिय है।",
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
 *
 * DOM remains the source of visual truth; this state stores application
 * coordination data that should not be unnecessarily duplicated into HTML.
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
    ticker: "not-available",
    canvasRenderer: "not-available",
    recorder: "not-available",
  },

  serviceWorker: {
    status: "not-checked",
  },
};

let elements = null;
let mediaModule = null;
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

    initializePreviewControls();

    await initializeServiceWorker();

    renderInitialApplicationState();

    appState.initialized = true;
    appState.status = "ready";

    setStatus(STATUS_MESSAGES.ready);
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
 * Missing optional nodes are allowed and must never crash the application.
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
 *
 * Listeners are registered exactly once because initApp() is guarded.
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
}

/**
 * Initialize the only currently available functional module.
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

    const result = mediaModule.init();

    if (!result?.ok) {
      appState.modules.media = "error";

      const message =
        result?.error?.message ||
        "मीडिया मॉड्यूल प्रारंभ नहीं हो सका।";

      showError(message);
      logError("Media module initialization failed.", result?.error);

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
 * Preview controls deliberately remain disabled because canvas-renderer.js
 * does not exist yet. No fake preview behavior is implemented.
 */
function initializePreviewControls() {
  setPreviewControlsEnabled(false);

  setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
}

/**
 * Handles media-module changes.
 */
function handleMediaChange(event) {
  syncMediaState();

  const reason = event?.reason || "";

  if (reason === "ready") {
    setStatus(STATUS_MESSAGES.mediaReady);
    clearError();
    return;
  }

  if (reason === "cleared") {
    setStatus(STATUS_MESSAGES.mediaCleared);
    return;
  }

  if (reason === "validation-error") {
    setStatus("मीडिया फ़ाइल की जाँच पूरी नहीं हो सकी।");
    return;
  }

  if (reason === "preview-error") {
    setStatus("मीडिया प्रीव्यू में समस्या आई।");
  }
}

/**
 * Handles media-module errors without allowing them to escape into
 * application-level event handling.
 */
function handleMediaError(event) {
  const message =
    event?.error?.message ||
    "मीडिया फ़ाइल को संसाधित नहीं किया जा सका।";

  showError(message);
}

/**
 * Handles fit-mode changes from media.js.
 */
function handleMediaFitModeChange(event) {
  const fitMode = normalizeString(event?.fitMode);

  if (!fitMode) {
    return;
  }

  appState.media.fitMode = fitMode;
}

/**
 * Keep appState.media synchronized with media.js.
 */
function syncMediaState() {
  if (!mediaModule) {
    return;
  }

  try {
    const mediaState = mediaModule.getState();

    appState.media = {
      initialized: true,
      status: mediaState.status || "idle",
      hasMedia: Boolean(mediaState.hasMedia),
      kind: mediaState.kind || null,
      fileName: mediaState.fileName || "",
      fitMode: mediaState.fitMode || "",
    };

    /*
     * Preview renderer is intentionally not activated here.
     * That responsibility belongs to canvas-renderer.js.
     */
  } catch (error) {
    logError("Could not synchronize media state.", error);
  }
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
 * Future canvas-renderer integration point.
 *
 * Kept as a separate handler so the preview workflow can be upgraded
 * without changing the rest of the controller.
 */
function handlePreviewPlayRequest() {
  setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
  setStatus(STATUS_MESSAGES.previewUnavailable);
}

/**
 * Future canvas-renderer reset integration point.
 */
function handlePreviewResetRequest() {
  setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
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

    return Boolean(
      canvas.getContext &&
        canvas.getContext("2d")
    );
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
 * Render browser capability information into existing HTML only.
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
 * Update the browser-status chip using capability data.
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
 * Register the existing service-worker.js when supported.
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

      /*
       * Registration success is intentionally a low-priority status.
       * It does not overwrite a more important media/error message.
       */
      setSuccess(STATUS_MESSAGES.serviceWorkerReady);
    }
  } catch (error) {
    appState.serviceWorker.status = "error";

    /*
     * PWA failure must not stop the editor itself.
     */
    logError("Service worker registration failed.", error);
  }
}

/**
 * Initial UI synchronization after all currently available modules
 * have been initialized.
 */
function renderInitialApplicationState() {
  syncMediaState();

  setPreviewControlsEnabled(false);
  setPreviewStatus(STATUS_MESSAGES.previewUnavailable);

  if (elements?.mediaRemoveButton instanceof HTMLButtonElement) {
    /*
     * media.js owns the actual enabled/disabled lifecycle of this button.
     * Do not override it here.
     */
  }
}

/**
 * Disable or enable preview controls in one place.
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
 *
 * Uses textContent only.
 */
function showError(message) {
  const normalized =
    normalizeString(message) ||
    "कुछ अप्रत्याशित समस्या हुई।";

  appState.currentError = normalized;
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
 */
function showSuccess(message) {
  const normalized = normalizeString(message);

  if (!normalized) {
    clearSuccess();
    return;
  }

  appState.currentSuccess = normalized;
  appState.currentError = null;

  if (elements?.appSuccess instanceof HTMLElement) {
    elements.appSuccess.textContent = normalized;
    elements.appSuccess.hidden = false;
  }

  if (elements?.appError instanceof HTMLElement) {
    elements.appError.textContent = "";
    elements.appError.hidden = true;
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
    elements.previewStatus.textContent =
      normalized || "";
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
 *
 * This is intentionally console-only and never exposes technical errors
 * directly into the visible UI.
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
 * Best-effort cleanup hook.
 *
 * The app currently does not expose a public destroy API because the
 * page-level controller is intended to live for the lifetime of the page.
 * This internal function exists to keep resource cleanup explicit and
 * make future hot-reload/test integration safer.
 */
function cleanupApp() {
  for (const cleanup of cleanupCallbacks.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      logError("Application cleanup callback failed.", error);
    }
  }

  if (mediaModule) {
    try {
      mediaModule.destroy();
    } catch (error) {
      logError("Media module cleanup failed.", error);
    }
  }

  mediaModule = null;

  appState.initialized = false;
  appState.initializing = false;
}

/*
 * Do not intercept beforeunload/unload unnecessarily.
 *
 * The browser itself will release page-scoped resources. Explicit cleanup
 * remains available internally without adding lifecycle listeners that can
 * interfere with navigation or bfcache.
 */

/**
 * Bootstrap.
 *
 * ES modules execute after the document has been parsed when the module
 * script is placed in the document head with normal browser module behavior,
 * but this function also defensively handles an unexpectedly early execution.
 */
function bootstrap() {
  if (document.readyState === "loading") {
    const handler = () => {
      document.removeEventListener("DOMContentLoaded", handler);
      void initApp();
    };

    document.addEventListener("DOMContentLoaded", handler, {
      once: true,
    });

    return;
  }

  void initApp();
}

bootstrap();
