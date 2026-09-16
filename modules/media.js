/**
 * Swar Srijan Studio
 * modules/media.js
 *
 * Browser-only media selection, validation, preview, fit-mode handling,
 * object-URL lifecycle management, and cleanup.
 *
 * Public factory:
 *   createMediaModule(options)
 *
 * No external dependencies.
 */

const SELECTORS = Object.freeze({
  fileInput: "#media-file-input",
  uploadHelp: "#media-upload-help",
  fileName: "#media-file-name",
  fileInfo: "#media-file-info",
  previewContainer: "#media-preview",
  imagePreview: "#media-image-preview",
  videoPreview: "#media-video-preview",
  emptyState: "#media-empty-state",
  fitMode: "#media-fit-mode",
  removeButton: "#media-remove-button",
});

const DEFAULT_OPTIONS = Object.freeze({
  acceptedKinds: Object.freeze(["image", "video"]),
  maxFileSizeBytes: null,
  initialFitMode: null,
  onChange: null,
  onError: null,
  onFitModeChange: null,
});

const SUPPORTED_EXTENSIONS = Object.freeze({
  image: new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "bmp",
    "avif",
  ]),
  video: new Set([
    "mp4",
    "webm",
    "ogg",
    "ogv",
    "mov",
    "m4v",
  ]),
});

const SUPPORTED_MIME_TYPES = Object.freeze({
  image: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/avif",
  ]),
  video: new Set([
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
    "video/x-m4v",
  ]),
});

const DEFAULT_MESSAGES = Object.freeze({
  ready: "फोटो या वीडियो चुनें।",
  noFile: "कोई मीडिया फ़ाइल चयनित नहीं है।",
  invalidType: "यह फ़ाइल समर्थित फोटो या वीडियो फ़ॉर्मेट में नहीं है।",
  emptyFile: "चयनित फ़ाइल खाली है। कृपया दूसरी फ़ाइल चुनें।",
  tooLarge: "चयनित फ़ाइल निर्धारित आकार सीमा से बड़ी है।",
  previewError: "इस फ़ाइल का प्रीव्यू तैयार नहीं किया जा सका।",
  browserError: "इस ब्राउज़र में मीडिया प्रीव्यू के लिए आवश्यक सुविधा उपलब्ध नहीं है।",
  moduleError: "मीडिया मॉड्यूल प्रारंभ नहीं हो सका।",
});

/**
 * Creates an isolated media-module instance.
 *
 * @param {object} options
 * @param {Document} [options.root=document]
 * @param {string} [options.fileInput]
 * @param {string} [options.uploadHelp]
 * @param {string} [options.fileName]
 * @param {string} [options.fileInfo]
 * @param {string} [options.previewContainer]
 * @param {string} [options.imagePreview]
 * @param {string} [options.videoPreview]
 * @param {string} [options.emptyState]
 * @param {string} [options.fitMode]
 * @param {string} [options.removeButton]
 * @param {string[]} [options.acceptedKinds]
 * @param {number|null} [options.maxFileSizeBytes]
 * @param {string|null} [options.initialFitMode]
 * @param {(event: object) => void} [options.onChange]
 * @param {(event: object) => void} [options.onError]
 * @param {(event: object) => void} [options.onFitModeChange]
 *
 * @returns {{
 *   init: () => object,
 *   getState: () => object,
 *   getMediaElement: () => HTMLImageElement|HTMLVideoElement|null,
 *   getMediaSource: () => object|null,
 *   getFile: () => File|null,
 *   getObjectUrl: () => string|null,
 *   getFitMode: () => string,
 *   setFitMode: (value: string) => string,
 *   clear: (options?: {emit?: boolean}) => object,
 *   destroy: () => void
 * }}
 */
export function createMediaModule(options = {}) {
  const config = normalizeOptions(options);

  let elements = createEmptyElementMap();
  let initialized = false;
  let destroyed = false;
  let objectUrl = null;

  let state = createInitialState(config);

  const eventHandlers = {
    fileInputChange: null,
    fitModeChange: null,
    removeClick: null,
    imageLoad: null,
    imageError: null,
    videoLoadedMetadata: null,
    videoError: null,
  };

  /**
   * Initialize the module.
   *
   * Safe to call more than once. Duplicate listeners are never attached.
   */
  function init() {
    if (destroyed) {
      return createResult(false, "destroyed", {
        message: "Media module has already been destroyed.",
      });
    }

    if (initialized) {
      return createResult(true, "already-initialized");
    }

    if (!isBrowserEnvironment()) {
      const error = createError(
        "browser_unavailable",
        DEFAULT_MESSAGES.browserError
      );
      state = {
        ...state,
        status: "error",
        error,
      };
      emitError(error);
      return createResult(false, "browser-unavailable", { error });
    }

    elements = resolveElements(config.root, config.selectors);

    const missingRequiredElements = findMissingRequiredElements(elements);

    if (missingRequiredElements.length > 0) {
      const error = createError(
        "missing_dom_elements",
        `${DEFAULT_MESSAGES.moduleError} Missing: ${missingRequiredElements.join(
          ", "
        )}.`,
        { missing: missingRequiredElements }
      );

      state = {
        ...state,
        status: "error",
        error,
      };

      emitError(error);

      return createResult(false, "missing-dom-elements", { error });
    }

    bindEvents();
    configurePreviewElements();
    configureFileInput();
    applyInitialFitMode();
    resetUi();

    initialized = true;

    return createResult(true, "initialized", {
      state: getState(),
    });
  }

  /**
   * Returns a defensive copy of the current serializable module state.
   */
  function getState() {
    return {
      status: state.status,
      hasMedia: state.hasMedia,
      kind: state.kind,
      fileName: state.fileName,
      fileType: state.fileType,
      fileSizeBytes: state.fileSizeBytes,
      fileSizeLabel: state.fileSizeLabel,
      objectUrl: state.objectUrl,
      fitMode: state.fitMode,
      error: state.error ? { ...state.error } : null,
    };
  }

  /**
   * Returns the currently visible media DOM element.
   */
  function getMediaElement() {
    if (!state.hasMedia) {
      return null;
    }

    return state.kind === "image"
      ? elements.imagePreview
      : elements.videoPreview;
  }

  /**
   * Returns the current media source information.
   *
   * The File object is included for application-internal consumption.
   * getState() should be used when only serializable state is required.
   */
  function getMediaSource() {
    if (!state.hasMedia || !state.file || !objectUrl) {
      return null;
    }

    return {
      file: state.file,
      url: objectUrl,
      kind: state.kind,
      element: getMediaElement(),
    };
  }

  function getFile() {
    return state.file;
  }

  function getObjectUrl() {
    return objectUrl;
  }

  function getFitMode() {
    return state.fitMode;
  }

  /**
   * Set the selected fit mode.
   *
   * The actual <select> options remain owned by index.html.
   * This method only accepts an existing option value.
   */
  function setFitMode(value) {
    if (!initialized || destroyed) {
      return state.fitMode;
    }

    const normalizedValue = normalizeString(value);

    if (!normalizedValue) {
      return state.fitMode;
    }

    const select = elements.fitMode;

    if (
      select instanceof HTMLSelectElement &&
      !hasOptionValue(select, normalizedValue)
    ) {
      return state.fitMode;
    }

    state = {
      ...state,
      fitMode: normalizedValue,
    };

    applyFitModeToPreview(normalizedValue);

    if (select instanceof HTMLSelectElement) {
      select.value = normalizedValue;
    }

    emitFitModeChange();

    return state.fitMode;
  }

  /**
   * Clear the selected media and all associated UI state.
   */
  function clear({ emit = true } = {}) {
    if (destroyed) {
      return getState();
    }

    revokeObjectUrl();

    resetFileInput();
    resetPreviewElements();
    resetUi();

    state = createInitialState(config);

    if (emit) {
      emitChange("cleared");
    }

    return getState();
  }

  /**
   * Remove all event listeners and release resources.
   * The instance must not be re-used after destroy().
   */
  function destroy() {
    if (destroyed) {
      return;
    }

    unbindEvents();
    revokeObjectUrl();

    resetPreviewElements();

    elements = createEmptyElementMap();
    initialized = false;
    destroyed = true;

    state = {
      ...createInitialState(config),
      status: "destroyed",
    };
  }

  function handleFileInputChange(event) {
    if (destroyed) {
      return;
    }

    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.[0] ?? null;

    if (!file) {
      clear();
      return;
    }

    handleSelectedFile(file);
  }

  function handleSelectedFile(file) {
    clear({ emit: false });

    const validation = validateFile(file);

    if (!validation.valid) {
      const error = validation.error;

      state = {
        ...createInitialState(config),
        status: "error",
        error,
      };

      updateUiForError(error);
      resetFileInput();

      emitError(error);
      emitChange("validation-error");

      return;
    }

    const nextObjectUrl = URL.createObjectURL(file);

    objectUrl = nextObjectUrl;

    const nextState = {
      ...createInitialState(config),
      status: "loading",
      hasMedia: true,
      kind: validation.kind,
      file,
      fileName: sanitizeDisplayName(file.name),
      fileType: normalizeString(file.type).toLowerCase(),
      fileSizeBytes: file.size,
      fileSizeLabel: formatFileSize(file.size),
      objectUrl: nextObjectUrl,
      fitMode: state.fitMode || resolveInitialFitMode(),
      error: null,
    };

    state = nextState;

    updateUiForMediaLoading();

    if (validation.kind === "image") {
      loadImagePreview(file, nextObjectUrl);
    } else {
      loadVideoPreview(file, nextObjectUrl);
    }
  }

  function loadImagePreview(file, url) {
    const image = elements.imagePreview;

    if (!(image instanceof HTMLImageElement)) {
      handlePreviewFailure(
        createError("missing_image_preview", DEFAULT_MESSAGES.previewError)
      );
      return;
    }

    const cleanupListeners = () => {
      image.removeEventListener("load", eventHandlers.imageLoad);
      image.removeEventListener("error", eventHandlers.imageError);
    };

    eventHandlers.imageLoad = () => {
      cleanupListeners();

      if (destroyed || objectUrl !== url) {
        return;
      }

      state = {
        ...state,
        status: "ready",
        error: null,
      };

      updateUiForReadyMedia();
      emitChange("ready");
    };

    eventHandlers.imageError = () => {
      cleanupListeners();

      if (destroyed || objectUrl !== url) {
        return;
      }

      handlePreviewFailure(
        createError("image_preview_error", DEFAULT_MESSAGES.previewError)
      );
    };

    image.addEventListener("load", eventHandlers.imageLoad, { once: true });
    image.addEventListener("error", eventHandlers.imageError, { once: true });

    image.src = url;

    if (image.complete && image.naturalWidth > 0) {
      eventHandlers.imageLoad();
    }

    void file;
  }

  function loadVideoPreview(file, url) {
    const video = elements.videoPreview;

    if (!(video instanceof HTMLVideoElement)) {
      handlePreviewFailure(
        createError("missing_video_preview", DEFAULT_MESSAGES.previewError)
      );
      return;
    }

    const cleanupListeners = () => {
      video.removeEventListener(
        "loadedmetadata",
        eventHandlers.videoLoadedMetadata
      );
      video.removeEventListener("error", eventHandlers.videoError);
    };

    eventHandlers.videoLoadedMetadata = () => {
      cleanupListeners();

      if (destroyed || objectUrl !== url) {
        return;
      }

      state = {
        ...state,
        status: "ready",
        error: null,
      };

      updateUiForReadyMedia();
      emitChange("ready");
    };

    eventHandlers.videoError = () => {
      cleanupListeners();

      if (destroyed || objectUrl !== url) {
        return;
      }

      handlePreviewFailure(
        createError("video_preview_error", DEFAULT_MESSAGES.previewError)
      );
    };

    video.addEventListener(
      "loadedmetadata",
      eventHandlers.videoLoadedMetadata,
      { once: true }
    );
    video.addEventListener("error", eventHandlers.videoError, {
      once: true,
    });

    video.src = url;
    video.load();

    void file;
  }

  function handlePreviewFailure(error) {
    revokeObjectUrl();

    const failedState = createInitialState(config);

    state = {
      ...failedState,
      status: "error",
      error,
    };

    resetFileInput();
    resetPreviewElements();
    updateUiForError(error);

    emitError(error);
    emitChange("preview-error");
  }

  function validateFile(file) {
    if (!(file instanceof File)) {
      return {
        valid: false,
        error: createError("invalid_file", DEFAULT_MESSAGES.invalidType),
      };
    }

    if (file.size <= 0) {
      return {
        valid: false,
        error: createError("empty_file", DEFAULT_MESSAGES.emptyFile),
      };
    }

    if (
      Number.isFinite(config.maxFileSizeBytes) &&
      file.size > config.maxFileSizeBytes
    ) {
      return {
        valid: false,
        error: createError("file_too_large", DEFAULT_MESSAGES.tooLarge, {
          maxFileSizeBytes: config.maxFileSizeBytes,
          actualFileSizeBytes: file.size,
        }),
      };
    }

    const kind = detectMediaKind(file);

    if (!kind || !config.acceptedKinds.includes(kind)) {
      return {
        valid: false,
        error: createError("unsupported_type", DEFAULT_MESSAGES.invalidType, {
          fileType: file.type || null,
          extension: getFileExtension(file.name),
        }),
      };
    }

    return {
      valid: true,
      kind,
    };
  }

  function detectMediaKind(file) {
    const mimeType = normalizeString(file.type).toLowerCase();
    const extension = getFileExtension(file.name);

    for (const kind of ["image", "video"]) {
      if (!config.acceptedKinds.includes(kind)) {
        continue;
      }

      const mimeSupported = SUPPORTED_MIME_TYPES[kind].has(mimeType);
      const extensionSupported =
        extension.length > 0 &&
        SUPPORTED_EXTENSIONS[kind].has(extension);

      if (mimeSupported || extensionSupported) {
        return kind;
      }
    }

    return null;
  }

  function bindEvents() {
    if (
      elements.fileInput instanceof HTMLInputElement &&
      !eventHandlers.fileInputChange
    ) {
      eventHandlers.fileInputChange = handleFileInputChange;
      elements.fileInput.addEventListener(
        "change",
        eventHandlers.fileInputChange
      );
    }

    if (
      elements.fitMode instanceof HTMLSelectElement &&
      !eventHandlers.fitModeChange
    ) {
      eventHandlers.fitModeChange = (event) => {
        const select = event.currentTarget;

        if (!(select instanceof HTMLSelectElement)) {
          return;
        }

        const previousMode = state.fitMode;
        const nextMode = normalizeString(select.value);

        if (!nextMode || nextMode === previousMode) {
          return;
        }

        state = {
          ...state,
          fitMode: nextMode,
        };

        applyFitModeToPreview(nextMode);
        emitFitModeChange();
        emitChange("fit-mode");
      };

      elements.fitMode.addEventListener(
        "change",
        eventHandlers.fitModeChange
      );
    }

    if (
      elements.removeButton instanceof HTMLButtonElement &&
      !eventHandlers.removeClick
    ) {
      eventHandlers.removeClick = () => {
        clear();
      };

      elements.removeButton.addEventListener(
        "click",
        eventHandlers.removeClick
      );
    }
  }

  function unbindEvents() {
    if (
      elements.fileInput instanceof HTMLInputElement &&
      eventHandlers.fileInputChange
    ) {
      elements.fileInput.removeEventListener(
        "change",
        eventHandlers.fileInputChange
      );
    }

    if (
      elements.fitMode instanceof HTMLSelectElement &&
      eventHandlers.fitModeChange
    ) {
      elements.fitMode.removeEventListener(
        "change",
        eventHandlers.fitModeChange
      );
    }

    if (
      elements.removeButton instanceof HTMLButtonElement &&
      eventHandlers.removeClick
    ) {
      elements.removeButton.removeEventListener(
        "click",
        eventHandlers.removeClick
      );
    }

    eventHandlers.fileInputChange = null;
    eventHandlers.fitModeChange = null;
    eventHandlers.removeClick = null;
    eventHandlers.imageLoad = null;
    eventHandlers.imageError = null;
    eventHandlers.videoLoadedMetadata = null;
    eventHandlers.videoError = null;
  }

  function configurePreviewElements() {
    const image = elements.imagePreview;
    const video = elements.videoPreview;

    if (image instanceof HTMLImageElement) {
      image.decoding = "async";
      image.alt = "";
      image.hidden = true;
      image.removeAttribute("src");
      image.style.objectFit = state.fitMode;
    }

    if (video instanceof HTMLVideoElement) {
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.muted = true;
      video.hidden = true;
      video.removeAttribute("src");
      video.style.objectFit = state.fitMode;
    }
  }

  function configureFileInput() {
    const input = elements.fileInput;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    /*
     * Do not overwrite an application-specific accept attribute unless it
     * is absent. This keeps index.html authoritative.
     */
    if (!input.hasAttribute("accept")) {
      input.setAttribute(
        "accept",
        [
          ...Array.from(SUPPORTED_MIME_TYPES.image),
          ...Array.from(SUPPORTED_MIME_TYPES.video),
          ...Array.from(SUPPORTED_EXTENSIONS.image, (ext) => `.${ext}`),
          ...Array.from(SUPPORTED_EXTENSIONS.video, (ext) => `.${ext}`),
        ].join(",")
      );
    }

    input.multiple = false;
  }

  function applyInitialFitMode() {
    const fitMode = resolveInitialFitMode();

    state = {
      ...state,
      fitMode,
    };

    if (elements.fitMode instanceof HTMLSelectElement) {
      if (hasOptionValue(elements.fitMode, fitMode)) {
        elements.fitMode.value = fitMode;
      } else if (elements.fitMode.options.length > 0) {
        state = {
          ...state,
          fitMode: elements.fitMode.options[0].value,
        };
      }
    }

    applyFitModeToPreview(state.fitMode);
  }

  function resolveInitialFitMode() {
    const configured = normalizeString(config.initialFitMode);

    if (
      configured &&
      elements.fitMode instanceof HTMLSelectElement &&
      hasOptionValue(elements.fitMode, configured)
    ) {
      return configured;
    }

    if (configured && !(elements.fitMode instanceof HTMLSelectElement)) {
      return configured;
    }

    if (elements.fitMode instanceof HTMLSelectElement) {
      const currentValue = normalizeString(elements.fitMode.value);

      if (currentValue) {
        return currentValue;
      }

      const firstOption = elements.fitMode.options[0]?.value;

      if (firstOption) {
        return firstOption;
      }
    }

    return "cover";
  }

  function applyFitModeToPreview(fitMode) {
    const normalized = normalizeString(fitMode) || "cover";

    if (elements.imagePreview instanceof HTMLImageElement) {
      elements.imagePreview.style.objectFit = normalized;
    }

    if (elements.videoPreview instanceof HTMLVideoElement) {
      elements.videoPreview.style.objectFit = normalized;
    }
  }

  function resetUi() {
    const input = elements.fileInput;
    const name = elements.fileName;
    const info = elements.fileInfo;
    const emptyState = elements.emptyState;
    const removeButton = elements.removeButton;
    const uploadHelp = elements.uploadHelp;

    if (input instanceof HTMLInputElement) {
      input.setAttribute("aria-invalid", "false");
    }

    if (name instanceof HTMLElement) {
      name.textContent = DEFAULT_MESSAGES.noFile;
    }

    if (info instanceof HTMLElement) {
      info.textContent = "";
      info.hidden = true;
    }

    if (uploadHelp instanceof HTMLElement) {
      uploadHelp.textContent = DEFAULT_MESSAGES.ready;
    }

    if (emptyState instanceof HTMLElement) {
      emptyState.hidden = false;
    }

    if (removeButton instanceof HTMLButtonElement) {
      removeButton.disabled = true;
    }

    setPreviewContainerVisibility(false);
    applyFitModeToPreview(state.fitMode);
  }

  function updateUiForMediaLoading() {
    const input = elements.fileInput;
    const name = elements.fileName;
    const info = elements.fileInfo;
    const emptyState = elements.emptyState;
    const removeButton = elements.removeButton;
    const uploadHelp = elements.uploadHelp;

    if (input instanceof HTMLInputElement) {
      input.setAttribute("aria-invalid", "false");
    }

    if (name instanceof HTMLElement) {
      name.textContent = state.fileName;
    }

    if (info instanceof HTMLElement) {
      info.textContent = buildFileInfoText();
      info.hidden = false;
    }

    if (uploadHelp instanceof HTMLElement) {
      uploadHelp.textContent = "मीडिया प्रीव्यू तैयार किया जा रहा है…";
    }

    if (emptyState instanceof HTMLElement) {
      emptyState.hidden = true;
    }

    if (removeButton instanceof HTMLButtonElement) {
      removeButton.disabled = false;
    }

    setPreviewContainerVisibility(true);
    setVisiblePreview(state.kind);

    applyFitModeToPreview(state.fitMode);
  }

  function updateUiForReadyMedia() {
    const uploadHelp = elements.uploadHelp;

    if (uploadHelp instanceof HTMLElement) {
      uploadHelp.textContent = "मीडिया तैयार है। आप इसे बदल या हटा सकते हैं।";
    }

    setPreviewContainerVisibility(true);
    setVisiblePreview(state.kind);
    applyFitModeToPreview(state.fitMode);
  }

  function updateUiForError(error) {
    const input = elements.fileInput;
    const name = elements.fileName;
    const info = elements.fileInfo;
    const emptyState = elements.emptyState;
    const removeButton = elements.removeButton;
    const uploadHelp = elements.uploadHelp;

    if (input instanceof HTMLInputElement) {
      input.setAttribute("aria-invalid", "true");
    }

    if (name instanceof HTMLElement) {
      name.textContent = "फ़ाइल चयनित नहीं है।";
    }

    if (info instanceof HTMLElement) {
      info.textContent = error.message;
      info.hidden = false;
    }

    if (uploadHelp instanceof HTMLElement) {
      uploadHelp.textContent = "कृपया समर्थित फोटो या वीडियो फ़ाइल चुनें।";
    }

    if (emptyState instanceof HTMLElement) {
      emptyState.hidden = false;
    }

    if (removeButton instanceof HTMLButtonElement) {
      removeButton.disabled = true;
    }

    setPreviewContainerVisibility(false);
  }

  function buildFileInfoText() {
    const typeLabel = state.fileType || state.kind || "unknown";
    return `${typeLabel} • ${state.fileSizeLabel}`;
  }

  function setVisiblePreview(kind) {
    const image = elements.imagePreview;
    const video = elements.videoPreview;

    if (image instanceof HTMLImageElement) {
      image.hidden = kind !== "image";
    }

    if (video instanceof HTMLVideoElement) {
      video.hidden = kind !== "video";
    }
  }

  function setPreviewContainerVisibility(hasMedia) {
    const container = elements.previewContainer;

    if (!(container instanceof HTMLElement)) {
      return;
    }

    /*
     * The surrounding #media-preview is a container in index.html.
     * Do not destroy or replace its child nodes; simply control visibility.
     */
    container.hidden = !hasMedia;
  }

  function resetPreviewElements() {
    const image = elements.imagePreview;
    const video = elements.videoPreview;

    if (image instanceof HTMLImageElement) {
      image.removeAttribute("src");
      image.hidden = true;
    }

    if (video instanceof HTMLVideoElement) {
      try {
        video.pause();
      } catch {
        // Safe no-op: pause may fail in unusual browser media states.
      }

      video.removeAttribute("src");
      video.load();
      video.hidden = true;
    }

    setPreviewContainerVisibility(false);
  }

  function resetFileInput() {
    const input = elements.fileInput;

    if (input instanceof HTMLInputElement) {
      /*
       * Setting value to an empty string is the standard way to reset a
       * file input and allows the same file to be selected again.
       */
      input.value = "";
      input.setAttribute("aria-invalid", "false");
    }
  }

  function revokeObjectUrl() {
    if (!objectUrl) {
      return;
    }

    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function emitChange(reason) {
    if (typeof config.onChange !== "function") {
      return;
    }

    safelyInvokeCallback(config.onChange, {
      type: "media-change",
      reason,
      state: getState(),
      source: getMediaSource(),
      module: api,
    });
  }

  function emitError(error) {
    if (typeof config.onError !== "function") {
      return;
    }

    safelyInvokeCallback(config.onError, {
      type: "media-error",
      error: { ...error },
      state: getState(),
      module: api,
    });
  }

  function emitFitModeChange() {
    if (typeof config.onFitModeChange !== "function") {
      return;
    }

    safelyInvokeCallback(config.onFitModeChange, {
      type: "media-fit-mode-change",
      fitMode: state.fitMode,
      state: getState(),
      module: api,
    });
  }

  const api = Object.freeze({
    init,
    getState,
    getMediaElement,
    getMediaSource,
    getFile,
    getObjectUrl,
    getFitMode,
    setFitMode,
    clear,
    destroy,
  });

  return api;
}

/**
 * Normalizes configuration without mutating the caller's object.
 */
function normalizeOptions(options) {
  const root =
    options?.root &&
    typeof options.root.querySelector === "function"
      ? options.root
      : document;

  const selectors = {
    fileInput: normalizeSelector(
      options?.fileInput,
      SELECTORS.fileInput
    ),
    uploadHelp: normalizeSelector(
      options?.uploadHelp,
      SELECTORS.uploadHelp
    ),
    fileName: normalizeSelector(options?.fileName, SELECTORS.fileName),
    fileInfo: normalizeSelector(options?.fileInfo, SELECTORS.fileInfo),
    previewContainer: normalizeSelector(
      options?.previewContainer,
      SELECTORS.previewContainer
    ),
    imagePreview: normalizeSelector(
      options?.imagePreview,
      SELECTORS.imagePreview
    ),
    videoPreview: normalizeSelector(
      options?.videoPreview,
      SELECTORS.videoPreview
    ),
    emptyState: normalizeSelector(
      options?.emptyState,
      SELECTORS.emptyState
    ),
    fitMode: normalizeSelector(
      options?.fitMode,
      SELECTORS.fitMode
    ),
    removeButton: normalizeSelector(
      options?.removeButton,
      SELECTORS.removeButton
    ),
  };

  const requestedKinds = Array.isArray(options?.acceptedKinds)
    ? options.acceptedKinds
        .map((kind) => normalizeString(kind).toLowerCase())
        .filter((kind) => kind === "image" || kind === "video")
    : DEFAULT_OPTIONS.acceptedKinds;

  const acceptedKinds = [
    ...new Set(
      requestedKinds.length > 0
        ? requestedKinds
        : DEFAULT_OPTIONS.acceptedKinds
    ),
  ];

  const maxFileSizeBytes =
    Number.isFinite(options?.maxFileSizeBytes) &&
    options.maxFileSizeBytes > 0
      ? options.maxFileSizeBytes
      : DEFAULT_OPTIONS.maxFileSizeBytes;

  return {
    root,
    selectors,
    acceptedKinds,
    maxFileSizeBytes,
    initialFitMode:
      normalizeString(options?.initialFitMode) ||
      DEFAULT_OPTIONS.initialFitMode,
    onChange:
      typeof options?.onChange === "function"
        ? options.onChange
        : DEFAULT_OPTIONS.onChange,
    onError:
      typeof options?.onError === "function"
        ? options.onError
        : DEFAULT_OPTIONS.onError,
    onFitModeChange:
      typeof options?.onFitModeChange === "function"
        ? options.onFitModeChange
        : DEFAULT_OPTIONS.onFitModeChange,
  };
}

function resolveElements(root, selectors) {
  return {
    fileInput: root.querySelector(selectors.fileInput),
    uploadHelp: root.querySelector(selectors.uploadHelp),
    fileName: root.querySelector(selectors.fileName),
    fileInfo: root.querySelector(selectors.fileInfo),
    previewContainer: root.querySelector(selectors.previewContainer),
    imagePreview: root.querySelector(selectors.imagePreview),
    videoPreview: root.querySelector(selectors.videoPreview),
    emptyState: root.querySelector(selectors.emptyState),
    fitMode: root.querySelector(selectors.fitMode),
    removeButton: root.querySelector(selectors.removeButton),
  };
}

function createEmptyElementMap() {
  return {
    fileInput: null,
    uploadHelp: null,
    fileName: null,
    fileInfo: null,
    previewContainer: null,
    imagePreview: null,
    videoPreview: null,
    emptyState: null,
    fitMode: null,
    removeButton: null,
  };
}

function findMissingRequiredElements(elements) {
  const required = [];

  if (!(elements.fileInput instanceof HTMLInputElement)) {
    required.push(SELECTORS.fileInput);
  }

  if (!(elements.fileName instanceof HTMLElement)) {
    required.push(SELECTORS.fileName);
  }

  if (!(elements.fileInfo instanceof HTMLElement)) {
    required.push(SELECTORS.fileInfo);
  }

  if (!(elements.previewContainer instanceof HTMLElement)) {
    required.push(SELECTORS.previewContainer);
  }

  if (!(elements.imagePreview instanceof HTMLImageElement)) {
    required.push(SELECTORS.imagePreview);
  }

  if (!(elements.videoPreview instanceof HTMLVideoElement)) {
    required.push(SELECTORS.videoPreview);
  }

  if (!(elements.emptyState instanceof HTMLElement)) {
    required.push(SELECTORS.emptyState);
  }

  if (!(elements.fitMode instanceof HTMLSelectElement)) {
    required.push(SELECTORS.fitMode);
  }

  if (!(elements.removeButton instanceof HTMLButtonElement)) {
    required.push(SELECTORS.removeButton);
  }

  return required;
}

function createInitialState(config) {
  return {
    status: "idle",
    hasMedia: false,
    kind: null,
    file: null,
    fileName: "",
    fileType: "",
    fileSizeBytes: 0,
    fileSizeLabel: "",
    objectUrl: null,
    fitMode: normalizeString(config.initialFitMode) || "cover",
    error: null,
  };
}

function createError(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function createResult(ok, status, details = {}) {
  return {
    ok,
    status,
    ...details,
  };
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getFileExtension(fileName) {
  const normalized = normalizeString(fileName).toLowerCase();
  const lastDot = normalized.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === normalized.length - 1) {
    return "";
  }

  return normalized.slice(lastDot + 1);
}

function sanitizeDisplayName(fileName) {
  /*
   * Keep the actual file name intact as text.
   * This helper only removes control characters that are not useful in UI.
   * It does not create or inject HTML.
   */
  return normalizeString(fileName)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSelector(value, fallback) {
  const normalized = normalizeString(value);
  return normalized || fallback;
}

function hasOptionValue(select, value) {
  if (!(select instanceof HTMLSelectElement)) {
    return false;
  }

  return Array.from(select.options).some(
    (option) => option.value === value
  );
}

function safelyInvokeCallback(callback, payload) {
  try {
    callback(payload);
  } catch (error) {
    /*
     * Consumer callback failures must not break the media module itself.
     * Logging is intentionally limited to development diagnostics.
     */
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("Swar Srijan Studio media callback error:", error);
    }
  }
}

function isBrowserEnvironment() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof File !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function"
  );
}

/*
 * Optional named constants for consumers that want a stable reference
 * without duplicating the supported values in application code.
 */
export const MEDIA_KINDS = Object.freeze({
  IMAGE: "image",
  VIDEO: "video",
});

export const MEDIA_FIT_MODES = Object.freeze({
  COVER: "cover",
  CONTAIN: "contain",
});
