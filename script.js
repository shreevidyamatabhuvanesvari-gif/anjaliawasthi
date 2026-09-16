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
 * - Keeps integration points ready for future modules.
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
    "Preview renderer अभी उपलब्ध नहीं है। मीडिया का native preview उपलब्ध होने पर वहीं से playback किया जा सकता है।",
  previewReady: "Preview तैयार है।",
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
 * Preview controls.
 *
 * These controls are only useful when a renderer/action exists.
 * Native video controls inside media.js remain independent from this.
 */
function initializePreviewControls() {
  const hasCanvasRenderer =
    appState.modules.canvasRenderer === "ready";

  setPreviewControlsEnabled(hasCanvasRenderer);

  if (hasCanvasRenderer) {
    setPreviewStatus(STATUS_MESSAGES.previewReady);
    return;
  }

  setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
}

/**
 * Handles media-module changes.
 */
function handleMediaChange(event) {
  syncMediaState();

  const reason = normalizeString(event?.reason);

  if (reason === "ready") {
    setStatus(STATUS_MESSAGES.mediaReady);
    clearError();

    updatePreviewControlsFromMediaState();
    return;
  }

  if (reason === "cleared") {
    setStatus(STATUS_MESSAGES.mediaCleared);
    updatePreviewControlsFromMediaState();
    return;
  }

  if (reason === "validation-error") {
    setStatus("मीडिया फ़ाइल की जाँच पूरी नहीं हो सकी।");
    updatePreviewControlsFromMediaState();
    return;
  }

  if (reason === "preview-error") {
    setStatus("मीडिया प्रीव्यू में समस्या आई।");
    updatePreviewControlsFromMediaState();
  }
}

/**
 * Handles media-module errors.
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
 * Media remove button synchronization.
 *
 * media.js remains the owner of the actual file-removal operation.
 */
function handleMediaRemoveButtonClick() {
  window.setTimeout(() => {
    syncMediaState();
    updatePreviewControlsFromMediaState();
  }, 0);
}

/**
 * Synchronize appState.media with media.js.
 */
function syncMediaState() {
  if (!mediaModule) {
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

    updatePreviewControlsFromMediaState();
  } catch (error) {
    logError("Could not synchronize media state.", error);
  }
}

/**
 * Update preview actions based on actual current state.
 *
 * Since canvas-renderer.js is not yet implemented, these buttons remain
 * disabled unless that module becomes available.
 *
 * Native HTML video controls are not affected.
 */
function updatePreviewControlsFromMediaState() {
  const rendererReady =
    appState.modules.canvasRenderer === "ready";

  const shouldEnable =
    rendererReady && appState.media.hasMedia;

  setPreviewControlsEnabled(shouldEnable);

  if (!shouldEnable && !appState.media.hasMedia) {
    setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
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
 */
function handlePreviewPlayRequest() {
  if (appState.modules.canvasRenderer !== "ready") {
    setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
    setStatus(STATUS_MESSAGES.previewUnavailable);
    return;
  }

  setPreviewStatus(STATUS_MESSAGES.previewReady);
}

/**
 * Future canvas-renderer reset integration point.
 */
function handlePreviewResetRequest() {
  if (appState.modules.canvasRenderer !== "ready") {
    setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
    return;
  }

  setPreviewStatus(STATUS_MESSAGES.previewReady);
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

      showSuccess(STATUS_MESSAGES.serviceWorkerReady);
    }
  } catch (error) {
    appState.serviceWorker.status = "error";

    logError(
      "Service worker registration failed.",
      error
    );
  }
}

/**
 * Initial UI synchronization.
 */
function renderInitialApplicationState() {
  syncMediaState();

  updatePreviewControlsFromMediaState();

  if (!appState.media.hasMedia) {
    setPreviewStatus(STATUS_MESSAGES.previewUnavailable);
  }
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

  if (mediaModule) {
    try {
      mediaModule.destroy();
    } catch (error) {
      logError(
        "Media module cleanup failed.",
        error
      );
    }
  }

  mediaModule = null;

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
