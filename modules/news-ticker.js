/**
 * Production-grade DOM news ticker module.
 *
 * Scope:
 * - Owns the DOM ticker preview rooted at #news-ticker (or a supplied root).
 * - Owns ticker settings, validation, animation metrics, accessibility state,
 *   and lifecycle cleanup.
 * - Does not own media, canvas rendering, recording, export, or application-wide state.
 *
 * Public factory:
 *   createNewsTickerModule(options = {})
 */

const MODULE_NAME = "news-ticker";

const SELECTORS = Object.freeze({
  root: "#news-ticker",
});

const CLASS_NAMES = Object.freeze({
  root: "news-ticker",
  label: "news-ticker__label",
  labelDot: "news-ticker__label-dot",
  viewport: "news-ticker__viewport",
  track: "news-ticker__track",
  group: "news-ticker__group",
  item: "news-ticker__item",
  status: "news-ticker__status",
  empty: "news-ticker__empty",
});

const DATA_ATTRIBUTES = Object.freeze({
  position: "data-position",
  direction: "data-direction",
  enabled: "data-enabled",
});

const SETTING_KEYS = Object.freeze([
  "enabled",
  "headline",
  "position",
  "direction",
  "speed",
  "fontSize",
  "textColor",
  "backgroundColor",
  "bold",
]);

const POSITION_VALUES = Object.freeze(["top", "middle", "bottom"]);
const DIRECTION_VALUES = Object.freeze(["rtl", "ltr"]);

const DEFAULTS = Object.freeze({
  enabled: true,
  headline: "",
  position: "bottom",
  direction: "rtl",
  speed: 8,
  fontSize: 36,
  textColor: "#FFFFFF",
  backgroundColor: "#111111",
  bold: true,
});

const LIMITS = Object.freeze({
  headlineMaxLength: 500,
  speedMin: 1,
  speedMax: 20,
  fontSizeMin: 16,
  fontSizeMax: 96,
});

const CSS_VARS = Object.freeze({
  duration: "--ticker-duration",
  distance: "--ticker-distance",
  background: "--ticker-bg",
  text: "--ticker-text",
  fontSize: "--ticker-font-size",
  fontWeight: "--ticker-font-weight",
});

const ANIMATION = Object.freeze({
  minDurationSeconds: 3,
  maxDurationSeconds: 120,
  pixelsPerSpeedUnit: 18,
  minTravelDistancePx: 1,
  resizeDebounceMs: 80,
});

const SOURCE_VALUES = Object.freeze({
  init: "init",
  user: "user",
  api: "api",
  clear: "clear",
  refresh: "refresh",
});

const NOOP = () => {};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneSettings(settings) {
  return { ...settings };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === "false" || value === "0" || value === 0) {
    return false;
  }

  return fallback;
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, LIMITS.headlineMaxLength);
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function normalizeSpeed(value, fallback = DEFAULTS.speed) {
  const numeric = toFiniteNumber(value, fallback);
  return clamp(Math.round(numeric), LIMITS.speedMin, LIMITS.speedMax);
}

function normalizeFontSize(value, fallback = DEFAULTS.fontSize) {
  const numeric = toFiniteNumber(value, fallback);
  return clamp(
    Math.round(numeric),
    LIMITS.fontSizeMin,
    LIMITS.fontSizeMax,
  );
}

function normalizeColor(value, fallback, documentRef) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const candidate = value.trim();

  try {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      return CSS.supports("color", candidate) ? candidate : fallback;
    }
  } catch {
    // Fall through to DOM-based validation.
  }

  if (documentRef?.createElement) {
    try {
      const probe = documentRef.createElement("span");
      probe.style.color = "";
      probe.style.color = candidate;
      return probe.style.color ? candidate : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeSettings(
  input,
  { previous = DEFAULTS, documentRef } = {},
) {
  const source = isObject(input) ? input : {};
  const base = isObject(previous) ? previous : DEFAULTS;

  const textColorFallback = normalizeColor(
    base.textColor,
    DEFAULTS.textColor,
    documentRef,
  );

  const backgroundColorFallback = normalizeColor(
    base.backgroundColor,
    DEFAULTS.backgroundColor,
    documentRef,
  );

  return {
    enabled: normalizeBoolean(
      source.enabled,
      normalizeBoolean(base.enabled, DEFAULTS.enabled),
    ),

    headline: normalizeText(
      source.headline,
      normalizeText(base.headline, DEFAULTS.headline),
    ),

    position: normalizeEnum(
      source.position,
      POSITION_VALUES,
      normalizeEnum(
        base.position,
        POSITION_VALUES,
        DEFAULTS.position,
      ),
    ),

    direction: normalizeEnum(
      source.direction,
      DIRECTION_VALUES,
      normalizeEnum(
        base.direction,
        DIRECTION_VALUES,
        DEFAULTS.direction,
      ),
    ),

    speed: normalizeSpeed(
      source.speed,
      normalizeSpeed(base.speed, DEFAULTS.speed),
    ),

    fontSize: normalizeFontSize(
      source.fontSize,
      normalizeFontSize(base.fontSize, DEFAULTS.fontSize),
    ),

    textColor: normalizeColor(
      source.textColor,
      textColorFallback,
      documentRef,
    ),

    backgroundColor: normalizeColor(
      source.backgroundColor,
      backgroundColorFallback,
      documentRef,
    ),

    bold: normalizeBoolean(
      source.bold,
      normalizeBoolean(base.bold, DEFAULTS.bold),
    ),
  };
}

function createCustomEvent(documentRef, name, detail) {
  if (typeof CustomEvent === "function") {
    return new CustomEvent(name, { detail });
  }

  if (documentRef?.createEvent) {
    const event = documentRef.createEvent("CustomEvent");
    event.initCustomEvent(name, false, false, detail);
    return event;
  }

  return null;
}

function safeInvoke(callback, payload, onError, errorContext) {
  if (typeof callback !== "function") {
    return;
  }

  try {
    callback(payload);
  } catch (error) {
    try {
      onError?.({
        module: MODULE_NAME,
        code: "CALLBACK_ERROR",
        message: `${errorContext} callback threw an exception.`,
        error,
      });
    } catch {
      // Callback error reporting must never escape the module.
    }
  }
}

function resolveDocument(root, explicitDocument) {
  if (explicitDocument) {
    return explicitDocument;
  }

  if (root?.ownerDocument) {
    return root.ownerDocument;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function resolveRoot(rootOption, documentRef) {
  if (
    rootOption &&
    typeof rootOption === "object" &&
    "nodeType" in rootOption
  ) {
    return rootOption;
  }

  const selector =
    typeof rootOption === "string"
      ? rootOption
      : SELECTORS.root;

  if (!documentRef?.querySelector) {
    return null;
  }

  try {
    return documentRef.querySelector(selector);
  } catch {
    return null;
  }
}

function readTextDirection(element, fallback = "rtl") {
  const direction = element?.getAttribute?.(
    DATA_ATTRIBUTES.direction,
  );

  return DIRECTION_VALUES.includes(direction)
    ? direction
    : fallback;
}

function setAttributeSafe(element, name, value) {
  try {
    if (value === null || value === undefined) {
      element?.removeAttribute?.(name);
      return;
    }

    element?.setAttribute?.(name, String(value));
  } catch {
    // Ignore individual attribute failures in hardened/partial DOM environments.
  }
}

function setStylePropertySafe(style, property, value) {
  try {
    style?.setProperty?.(property, value);
  } catch {
    // Ignore unsupported style operations.
  }
}

function removeStylePropertySafe(style, property) {
  try {
    style?.removeProperty?.(property);
  } catch {
    // Ignore unsupported style operations.
  }
}

function getAnimationDurationSeconds(speed, distancePx) {
  const safeDistance = Math.max(
    ANIMATION.minTravelDistancePx,
    distancePx,
  );

  const pixelsPerSecond = Math.max(
    ANIMATION.pixelsPerSpeedUnit,
    speed * ANIMATION.pixelsPerSpeedUnit,
  );

  const duration = safeDistance / pixelsPerSecond;

  return clamp(
    duration,
    ANIMATION.minDurationSeconds,
    ANIMATION.maxDurationSeconds,
  );
}

function prefersReducedMotion(windowRef) {
  try {
    return Boolean(
      windowRef
        ?.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        )?.matches,
    );
  } catch {
    return false;
  }
}

function hasElementClassList(element) {
  return Boolean(
    element?.classList?.add &&
      element?.classList?.remove,
  );
}

function removeAllChildren(element) {
  if (!element) {
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createElement(documentRef, tagName, className) {
  const element = documentRef?.createElement?.(tagName);

  if (!element) {
    return null;
  }

  if (className) {
    element.className = className;
  }

  return element;
}

function isElement(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.nodeType === 1,
  );
}

export function createNewsTickerModule(options = {}) {
  const factoryOptions = isObject(options) ? options : {};

  let root = factoryOptions.root ?? null;

  const documentRef = resolveDocument(
    root,
    factoryOptions.document,
  );

  const windowRef =
    documentRef?.defaultView ??
    (typeof window !== "undefined" ? window : null);

  let settings = normalizeSettings(
    factoryOptions.settings,
    {
      previous: DEFAULTS,
      documentRef,
    },
  );

  let lifecycle = "created";
  let pausedByApi = false;

  let resizeObserver = null;
  let resizeListener = null;

  let mediaQueryList = null;
  let mediaQueryListener = null;

  let resizeTimer = null;
  let animationRestartTimer = null;

  let animationSequence = 0;
  let currentDistancePx = 0;

  let previousRootInlineStyles = null;
  let moduleRoot = null;
  let elements = null;

  let ownsMarkup = false;
  let lastError = null;
  let readyNotified = false;

  const callbacks = {
    onChange:
      typeof factoryOptions.onChange === "function"
        ? factoryOptions.onChange
        : NOOP,

    onError:
      typeof factoryOptions.onError === "function"
        ? factoryOptions.onError
        : NOOP,

    onReady:
      typeof factoryOptions.onReady === "function"
        ? factoryOptions.onReady
        : NOOP,

    onVisibilityChange:
      typeof factoryOptions.onVisibilityChange === "function"
        ? factoryOptions.onVisibilityChange
        : NOOP,
  };

  const reportError = (
    code,
    message,
    error = null,
    details = undefined,
  ) => {
    const payload = Object.freeze({
      module: MODULE_NAME,
      code,
      message,
      error,
      details,
    });

    lastError = payload;

    safeInvoke(
      callbacks.onError,
      payload,
      NOOP,
      "onError",
    );

    if (
      moduleRoot &&
      isElement(moduleRoot)
    ) {
      setAttributeSafe(
        moduleRoot,
        "data-ticker-error",
        code,
      );
    }

    return payload;
  };

  const clearError = () => {
    lastError = null;

    if (
      moduleRoot &&
      isElement(moduleRoot)
    ) {
      try {
        moduleRoot.removeAttribute(
          "data-ticker-error",
        );
      } catch {
        // Ignore.
      }
    }
  };

  const getSerializableState = () => ({
    initialized: lifecycle === "ready",
    destroyed: lifecycle === "destroyed",

    enabled: settings.enabled,
    headline: settings.headline,
    position: settings.position,
    direction: settings.direction,
    speed: settings.speed,
    fontSize: settings.fontSize,
    textColor: settings.textColor,
    backgroundColor: settings.backgroundColor,
    bold: settings.bold,

    hasContent: settings.headline.length > 0,

    paused:
      pausedByApi ||
      prefersReducedMotion(windowRef),

    lifecycle,

    reducedMotion:
      prefersReducedMotion(windowRef),

    lastError: lastError
      ? {
          code: lastError.code,
          message: lastError.message,
        }
      : null,
  });

  const emitChange = (
    source = SOURCE_VALUES.api,
  ) => {
    const payload = Object.freeze({
      settings: cloneSettings(settings),
      state: getSerializableState(),
      source,
    });

    safeInvoke(
      callbacks.onChange,
      payload,
      reportError.bind(
        null,
        "CALLBACK_ERROR",
        "",
      ),
      "onChange",
    );

    if (moduleRoot?.dispatchEvent) {
      try {
        const event = createCustomEvent(
          documentRef,
          "news-ticker-change",
          payload,
        );

        if (event) {
          moduleRoot.dispatchEvent(event);
        }
      } catch (error) {
        reportError(
          "EVENT_DISPATCH_ERROR",
          "The ticker change event could not be dispatched.",
          error,
        );
      }
    }
  };

  const emitVisibility = () => {
    const visible = Boolean(
      settings.enabled &&
        settings.headline,
    );

    const payload = Object.freeze({
      visible,
      enabled: settings.enabled,
      hasContent: Boolean(
        settings.headline,
      ),
    });

    safeInvoke(
      callbacks.onVisibilityChange,
      payload,
      NOOP,
      "onVisibilityChange",
    );
  };

  const applyRootStyles = () => {
    if (!moduleRoot) {
      return;
    }

    setStylePropertySafe(
      moduleRoot.style,
      CSS_VARS.background,
      settings.backgroundColor,
    );

    setStylePropertySafe(
      moduleRoot.style,
      CSS_VARS.text,
      settings.textColor,
    );

    setStylePropertySafe(
      moduleRoot.style,
      CSS_VARS.fontSize,
      `${settings.fontSize}px`,
    );

    setStylePropertySafe(
      moduleRoot.style,
      CSS_VARS.fontWeight,
      settings.bold
        ? "700"
        : "400",
    );

    setAttributeSafe(
      moduleRoot,
      DATA_ATTRIBUTES.position,
      settings.position,
    );

    setAttributeSafe(
      moduleRoot,
      DATA_ATTRIBUTES.direction,
      settings.direction,
    );

    setAttributeSafe(
      moduleRoot,
      DATA_ATTRIBUTES.enabled,
      settings.enabled
        ? "true"
        : "false",
    );
  };

  const updateAccessibility = () => {
    if (
      !moduleRoot ||
      !elements
    ) {
      return;
    }

    const hasContent =
      settings.headline.length > 0;

    const visuallyActive = Boolean(
      settings.enabled &&
        hasContent,
    );

    setAttributeSafe(
      moduleRoot,
      "aria-hidden",
      visuallyActive
        ? null
        : "true",
    );

    setAttributeSafe(
      elements.viewport,
      "aria-hidden",
      visuallyActive
        ? "false"
        : "true",
    );

    setAttributeSafe(
      elements.secondaryGroup,
      "aria-hidden",
      "true",
    );

    // The outer #news-ticker host already carries aria-live="polite"
    // in index.html. Avoid creating another nested live region.
    setAttributeSafe(
      elements.status,
      "aria-live",
      null,
    );

    setAttributeSafe(
      elements.status,
      "aria-atomic",
      null,
    );

    if (elements.status) {
      elements.status.textContent =
        visuallyActive
          ? settings.headline
          : "";
    }
  };

  const updateVisibleContent = () => {
    if (!elements) {
      return;
    }

    const hasContent =
      settings.headline.length > 0;

    const displayText = hasContent
      ? settings.headline
      : "";

    elements.primaryItem.textContent =
      displayText;

    elements.secondaryItem.textContent =
      displayText;

    if (hasContent) {
      elements.primaryItem.classList.remove(
        CLASS_NAMES.empty,
      );

      elements.secondaryItem.classList.remove(
        CLASS_NAMES.empty,
      );
    } else {
      elements.primaryItem.classList.add(
        CLASS_NAMES.empty,
      );

      elements.secondaryItem.classList.add(
        CLASS_NAMES.empty,
      );
    }

    elements.primaryGroup.setAttribute(
      "aria-label",
      hasContent
        ? displayText
        : "",
    );

    elements.secondaryGroup.setAttribute(
      "aria-label",
      "",
    );

    updateAccessibility();
  };

  const applyAnimationState = (
    restart = false,
  ) => {
    if (!elements?.track) {
      return;
    }

    const reduced =
      prefersReducedMotion(windowRef);

    const active = Boolean(
      settings.enabled &&
        settings.headline &&
        !pausedByApi &&
        !reduced,
    );

    setAttributeSafe(
      elements.track,
      "data-animation",
      active
        ? "running"
        : "paused",
    );

    if (
      hasElementClassList(elements.track)
    ) {
      if (active) {
        elements.track.classList.add(
          "news-ticker__track--animated",
        );
      } else {
        elements.track.classList.remove(
          "news-ticker__track--animated",
        );
      }
    }

    // The stylesheet owns the base keyframe animation.
    // The module controls runtime playback and direction.
    try {
      elements.track.style.animationPlayState =
        active
          ? "running"
          : "paused";

      elements.track.style.animationDirection =
        settings.direction === "rtl"
          ? "normal"
          : "reverse";
    } catch {
      // Ignore unsupported inline animation controls.
    }

    if (restart) {
      animationSequence += 1;

      const sequence =
        animationSequence;

      try {
        elements.track.style.animation =
          "none";

        // Force the browser to observe the reset
        // before restoring stylesheet animation.
        void elements.track.offsetWidth;
      } catch {
        // Ignore non-visual DOM limitations.
      }

      if (active) {
        if (animationRestartTimer) {
          clearTimeout(
            animationRestartTimer,
          );
        }

        animationRestartTimer =
          setTimeout(() => {
            if (
              sequence !== animationSequence ||
              lifecycle !== "ready" ||
              !elements?.track
            ) {
              return;
            }

            try {
              elements.track.style.removeProperty(
                "animation",
              );

              elements.track.style.animationPlayState =
                active
                  ? "running"
                  : "paused";

              elements.track.style.animationDirection =
                settings.direction === "rtl"
                  ? "normal"
                  : "reverse";
            } catch {
              // Ignore.
            }
          }, 0);
      } else {
        try {
          elements.track.style.removeProperty(
            "animation",
          );

          elements.track.style.animationPlayState =
            "paused";

          elements.track.style.animationDirection =
            settings.direction === "rtl"
              ? "normal"
              : "reverse";
        } catch {
          // Ignore.
        }
      }
    }
  };

  const measureAndApplyMetrics = ({
    restartAnimation = true,
  } = {}) => {
    if (
      !elements?.group ||
      !elements?.viewport ||
      !elements?.track
    ) {
      currentDistancePx = 0;
      return 0;
    }

    let groupWidth = 0;

    try {
      groupWidth = Math.max(
        Number(
          elements.group
            .getBoundingClientRect?.()
            .width,
        ) || 0,

        Number(
          elements.group.scrollWidth,
        ) || 0,
      );
    } catch {
      groupWidth =
        Number(
          elements.group.scrollWidth,
        ) || 0;
    }

    let viewportWidth = 0;

    try {
      viewportWidth = Math.max(
        Number(
          elements.viewport
            .getBoundingClientRect?.()
            .width,
        ) || 0,

        Number(
          elements.viewport.clientWidth,
        ) || 0,
      );
    } catch {
      viewportWidth =
        Number(
          elements.viewport.clientWidth,
        ) || 0;
    }

    const contentDistance =
      Math.max(
        groupWidth,
        ANIMATION.minTravelDistancePx,
      );

    const distance =
      Math.max(
        contentDistance,
        viewportWidth,
      );

    currentDistancePx =
      distance;

    const duration =
      getAnimationDurationSeconds(
        settings.speed,
        distance,
      );

    setStylePropertySafe(
      elements.track.style,
      CSS_VARS.distance,
      `${distance}px`,
    );

    setStylePropertySafe(
      elements.track.style,
      CSS_VARS.duration,
      `${duration.toFixed(3)}s`,
    );

    setAttributeSafe(
      elements.track,
      DATA_ATTRIBUTES.direction,
      readTextDirection(
        moduleRoot,
        settings.direction,
      ),
    );

    if (restartAnimation) {
      applyAnimationState(true);
    }

    return distance;
  };

  const teardownObservers = () => {
    if (resizeObserver) {
      try {
        resizeObserver.disconnect();
      } catch {
        // Ignore.
      }

      resizeObserver = null;
    }

    if (
      resizeListener &&
      windowRef?.removeEventListener
    ) {
      windowRef.removeEventListener(
        "resize",
        resizeListener,
      );

      resizeListener = null;
    }

    if (
      mediaQueryList &&
      mediaQueryListener
    ) {
      try {
        if (
          typeof mediaQueryList.removeEventListener ===
          "function"
        ) {
          mediaQueryList.removeEventListener(
            "change",
            mediaQueryListener,
          );
        } else if (
          typeof mediaQueryList.removeListener ===
          "function"
        ) {
          mediaQueryList.removeListener(
            "change",
            mediaQueryListener,
          );
        }
      } catch {
        // Ignore.
      }
    }

    mediaQueryList = null;
    mediaQueryListener = null;

    if (resizeTimer) {
      clearTimeout(
        resizeTimer,
      );

      resizeTimer = null;
    }

    if (animationRestartTimer) {
      clearTimeout(
        animationRestartTimer,
      );

      animationRestartTimer = null;
    }
  };

  const scheduleRefresh = () => {
    if (lifecycle !== "ready") {
      return;
    }

    if (resizeTimer) {
      clearTimeout(
        resizeTimer,
      );
    }

    resizeTimer =
      setTimeout(() => {
        resizeTimer = null;

        if (lifecycle === "ready") {
          measureAndApplyMetrics({
            restartAnimation: true,
          });
        }
      }, ANIMATION.resizeDebounceMs);
  };

  const installObservers = () => {
    teardownObservers();

    if (
      !moduleRoot ||
      !windowRef
    ) {
      return;
    }

    if (
      typeof windowRef.ResizeObserver ===
      "function"
    ) {
      try {
        resizeObserver =
          new windowRef.ResizeObserver(
            scheduleRefresh,
          );

        resizeObserver.observe(
          moduleRoot,
        );

        if (elements?.viewport) {
          resizeObserver.observe(
            elements.viewport,
          );
        }

        if (elements?.group) {
          resizeObserver.observe(
            elements.group,
          );
        }
      } catch (error) {
        resizeObserver = null;

        reportError(
          "RESIZE_OBSERVER_ERROR",
          "ResizeObserver could not be initialized; using the resize-event fallback.",
          error,
        );
      }
    }

    if (
      !resizeObserver &&
      windowRef.addEventListener
    ) {
      resizeListener =
        scheduleRefresh;

      windowRef.addEventListener(
        "resize",
        resizeListener,
        {
          passive: true,
        },
      );
    }

    try {
      mediaQueryList =
        windowRef.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ) ?? null;
    } catch {
      mediaQueryList = null;
    }

    if (mediaQueryList) {
      mediaQueryListener = () => {
        if (lifecycle !== "ready") {
          return;
        }

        updateAccessibility();
        applyAnimationState(true);
        emitChange(
          SOURCE_VALUES.refresh,
        );
      };

      try {
        if (
          typeof mediaQueryList.addEventListener ===
          "function"
        ) {
          mediaQueryList.addEventListener(
            "change",
            mediaQueryListener,
          );
        } else if (
          typeof mediaQueryList.addListener ===
          "function"
        ) {
          mediaQueryList.addListener(
            "change",
            mediaQueryListener,
          );
        }
      } catch (error) {
        reportError(
          "MOTION_PREFERENCE_ERROR",
          "Reduced-motion preference changes could not be observed.",
          error,
        );

        mediaQueryListener = null;
      }
    }
  };

  const buildDom = () => {
    if (
      !documentRef?.createElement ||
      !moduleRoot
    ) {
      reportError(
        "DOM_UNAVAILABLE",
        "A browser DOM is required to initialize the news ticker.",
      );

      return false;
    }

    const rootClassAlreadyPresent =
      moduleRoot.classList?.contains?.(
        CLASS_NAMES.root,
      );

    previousRootInlineStyles = {
      cssText:
        moduleRoot.getAttribute?.(
          "style",
        ) ?? null,

      ariaHidden:
        moduleRoot.getAttribute?.(
          "aria-hidden",
        ) ?? null,

      tickerPosition:
        moduleRoot.getAttribute?.(
          DATA_ATTRIBUTES.position,
        ) ?? null,

      tickerDirection:
        moduleRoot.getAttribute?.(
          DATA_ATTRIBUTES.direction,
        ) ?? null,

      tickerEnabled:
        moduleRoot.getAttribute?.(
          DATA_ATTRIBUTES.enabled,
        ) ?? null,
    };

    // The host is module-owned. Rebuilding only removes
    // ticker markup inside the host element.
    removeAllChildren(
      moduleRoot,
    );

    moduleRoot.classList?.add?.(
      CLASS_NAMES.root,
    );

    ownsMarkup =
      !rootClassAlreadyPresent;

    const label = createElement(
      documentRef,
      "div",
      CLASS_NAMES.label,
    );

    const labelDot = createElement(
      documentRef,
      "span",
      CLASS_NAMES.labelDot,
    );

    const viewport = createElement(
      documentRef,
      "div",
      CLASS_NAMES.viewport,
    );

    const track = createElement(
      documentRef,
      "div",
      CLASS_NAMES.track,
    );

    const primaryGroup = createElement(
      documentRef,
      "div",
      CLASS_NAMES.group,
    );

    const secondaryGroup = createElement(
      documentRef,
      "div",
      CLASS_NAMES.group,
    );

    const primaryItem = createElement(
      documentRef,
      "div",
      CLASS_NAMES.item,
    );

    const secondaryItem = createElement(
      documentRef,
      "div",
      CLASS_NAMES.item,
    );

    const status = createElement(
      documentRef,
      "div",
      CLASS_NAMES.status,
    );

    if (
      !label ||
      !labelDot ||
      !viewport ||
      !track ||
      !primaryGroup ||
      !secondaryGroup ||
      !primaryItem ||
      !secondaryItem ||
      !status
    ) {
      reportError(
        "DOM_CONSTRUCTION_ERROR",
        "The news ticker DOM structure could not be constructed.",
      );

      removeAllChildren(
        moduleRoot,
      );

      return false;
    }

    labelDot.setAttribute(
      "aria-hidden",
      "true",
    );

    label.appendChild(
      labelDot,
    );

    primaryGroup.appendChild(
      primaryItem,
    );

    secondaryGroup.appendChild(
      secondaryItem,
    );

    track.appendChild(
      primaryGroup,
    );

    track.appendChild(
      secondaryGroup,
    );

    viewport.appendChild(
      track,
    );

    status.hidden = true;

    status.setAttribute(
      "role",
      "status",
    );

    status.setAttribute(
      "aria-hidden",
      "true",
    );

    moduleRoot.appendChild(
      label,
    );

    moduleRoot.appendChild(
      viewport,
    );

    moduleRoot.appendChild(
      status,
    );

    elements = Object.freeze({
      label,
      labelDot,
      viewport,
      track,
      primaryGroup,
      secondaryGroup,
      primaryItem,
      secondaryItem,
      status,
    });

    return true;
  };

  const restoreRoot = () => {
    if (!moduleRoot) {
      return;
    }

    removeAllChildren(
      moduleRoot,
    );

    if (previousRootInlineStyles) {
      if (
        previousRootInlineStyles.cssText === null ||
        previousRootInlineStyles.cssText === ""
      ) {
        try {
          moduleRoot.removeAttribute(
            "style",
          );
        } catch {
          // Ignore.
        }
      } else {
        moduleRoot.setAttribute(
          "style",
          previousRootInlineStyles.cssText,
        );
      }

      const restoreAttribute =
        (
          name,
          value,
        ) => {
          if (
            value === null ||
            value === undefined
          ) {
            try {
              moduleRoot.removeAttribute(
                name,
              );
            } catch {
              // Ignore.
            }
          } else {
            setAttributeSafe(
              moduleRoot,
              name,
              value,
            );
          }
        };

      restoreAttribute(
        "aria-hidden",
        previousRootInlineStyles.ariaHidden,
      );

      restoreAttribute(
        DATA_ATTRIBUTES.position,
        previousRootInlineStyles.tickerPosition,
      );

      restoreAttribute(
        DATA_ATTRIBUTES.direction,
        previousRootInlineStyles.tickerDirection,
      );

      restoreAttribute(
        DATA_ATTRIBUTES.enabled,
        previousRootInlineStyles.tickerEnabled,
      );
    }

    Object.values(
      CSS_VARS,
    ).forEach(
      (property) => {
        removeStylePropertySafe(
          moduleRoot.style,
          property,
        );
      },
    );

    try {
      moduleRoot.classList.remove(
        CLASS_NAMES.root,
      );
    } catch {
      // Ignore.
    }

    elements = null;
    moduleRoot = null;
    previousRootInlineStyles = null;
    ownsMarkup = false;
  };

  const assertUsable = (
    methodName,
  ) => {
    if (lifecycle === "destroyed") {
      reportError(
        "MODULE_DESTROYED",
        `${methodName}() cannot be used after destroy().`,
      );

      return false;
    }

    return true;
  };

  const setSettingsInternal = (
    nextSettings,
    source = SOURCE_VALUES.api,
    emit = true,
  ) => {
    if (
      !assertUsable(
        "setSettings",
      )
    ) {
      return cloneSettings(
        settings,
      );
    }

    const incoming =
      isObject(nextSettings)
        ? nextSettings
        : {};

    const normalized =
      normalizeSettings(
        incoming,
        {
          previous: settings,
          documentRef,
        },
      );

    const changedKeys =
      SETTING_KEYS.filter(
        (key) =>
          normalized[key] !==
          settings[key],
      );

    const hadVisibilityChange =
      normalized.enabled !==
        settings.enabled ||
      Boolean(
        normalized.headline,
      ) !==
        Boolean(
          settings.headline,
        );

    if (
      changedKeys.length === 0
    ) {
      return cloneSettings(
        settings,
      );
    }

    clearError();

    settings = normalized;

    if (
      elements &&
      moduleRoot
    ) {
      applyRootStyles();
      updateVisibleContent();

      const metricsChanged =
        changedKeys.some(
          (key) =>
            [
              "headline",
              "direction",
              "speed",
              "fontSize",
              "bold",
            ].includes(key),
        );

      measureAndApplyMetrics({
        restartAnimation:
          metricsChanged ||
          hadVisibilityChange,
      });

      applyAnimationState(
        metricsChanged ||
          hadVisibilityChange,
      );
    }

    if (hadVisibilityChange) {
      emitVisibility();
    }

    if (emit) {
      emitChange(
        source,
      );
    }

    return cloneSettings(
      settings,
    );
  };

  const api = {
    init() {
      if (
        lifecycle === "destroyed"
      ) {
        reportError(
          "MODULE_DESTROYED",
          "init() cannot be called after destroy(). Create a new module instance instead.",
        );

        return false;
      }

      if (
        lifecycle === "ready"
      ) {
        return true;
      }

      root = resolveRoot(
        root,
        documentRef,
      );

      if (!isElement(root)) {
        lifecycle = "error";

        reportError(
          "ROOT_NOT_FOUND",
          `The news ticker host could not be found. Expected ${SELECTORS.root} or a valid element.`,
        );

        return false;
      }

      moduleRoot = root;

      lifecycle = "initializing";
      pausedByApi = false;

      try {
        if (!buildDom()) {
          lifecycle = "error";
          return false;
        }

        applyRootStyles();
        updateVisibleContent();

        measureAndApplyMetrics({
          restartAnimation: false,
        });

        applyAnimationState(true);

        installObservers();

        lifecycle = "ready";
        clearError();

        if (!readyNotified) {
          readyNotified = true;

          safeInvoke(
            callbacks.onReady,
            Object.freeze({
              settings:
                cloneSettings(
                  settings,
                ),
              state:
                getSerializableState(),
            }),
            NOOP,
            "onReady",
          );
        }

        emitVisibility();

        emitChange(
          SOURCE_VALUES.init,
        );

        return true;
      } catch (error) {
        lifecycle = "error";

        teardownObservers();
        restoreRoot();

        reportError(
          "INIT_ERROR",
          "The news ticker could not be initialized.",
          error,
        );

        return false;
      }
    },

    getSettings() {
      return cloneSettings(
        settings,
      );
    },

    getState() {
      return getSerializableState();
    },

    getRenderModel() {
      return {
        enabled:
          settings.enabled,

        text:
          settings.headline,

        position:
          settings.position,

        direction:
          settings.direction,

        speed:
          settings.speed,

        fontSize:
          settings.fontSize,

        textColor:
          settings.textColor,

        backgroundColor:
          settings.backgroundColor,

        bold:
          settings.bold,
      };
    },

    setSettings(
      nextSettings,
      options = {},
    ) {
      const source =
        options?.source ??
        SOURCE_VALUES.api;

      const emit =
        options?.emit !== false;

      return setSettingsInternal(
        nextSettings,
        source,
        emit,
      );
    },

    setSetting(
      key,
      value,
      options = {},
    ) {
      if (
        !SETTING_KEYS.includes(
          key,
        )
      ) {
        reportError(
          "INVALID_SETTING",
          `Unknown ticker setting: ${String(key)}.`,
        );

        return cloneSettings(
          settings,
        );
      }

      return setSettingsInternal(
        {
          [key]: value,
        },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setEnabled(
      enabled,
      options = {},
    ) {
      return setSettingsInternal(
        { enabled },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setHeadline(
      headline,
      options = {},
    ) {
      return setSettingsInternal(
        { headline },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setPosition(
      position,
      options = {},
    ) {
      return setSettingsInternal(
        { position },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setDirection(
      direction,
      options = {},
    ) {
      return setSettingsInternal(
        { direction },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setSpeed(
      speed,
      options = {},
    ) {
      return setSettingsInternal(
        { speed },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setFontSize(
      fontSize,
      options = {},
    ) {
      return setSettingsInternal(
        { fontSize },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setColors(
      colors,
      options = {},
    ) {
      const source =
        isObject(colors)
          ? colors
          : {};

      return setSettingsInternal(
        {
          textColor:
            source.textColor,

          backgroundColor:
            source.backgroundColor,
        },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    setBold(
      bold,
      options = {},
    ) {
      return setSettingsInternal(
        { bold },
        options?.source ??
          SOURCE_VALUES.api,
        options?.emit !== false,
      );
    },

    pause() {
      if (
        !assertUsable(
          "pause",
        )
      ) {
        return false;
      }

      if (
        lifecycle !== "ready"
      ) {
        return false;
      }

      if (pausedByApi) {
        return true;
      }

      pausedByApi = true;

      applyAnimationState(
        false,
      );

      emitChange(
        SOURCE_VALUES.api,
      );

      return true;
    },

    resume() {
      if (
        !assertUsable(
          "resume",
        )
      ) {
        return false;
      }

      if (
        lifecycle !== "ready"
      ) {
        return false;
      }

      if (!pausedByApi) {
        return true;
      }

      pausedByApi = false;

      applyAnimationState(
        true,
      );

      emitChange(
        SOURCE_VALUES.api,
      );

      return true;
    },

    refresh() {
      if (
        !assertUsable(
          "refresh",
        )
      ) {
        return false;
      }

      if (
        lifecycle !== "ready"
      ) {
        return false;
      }

      clearError();

      updateVisibleContent();
      applyRootStyles();

      measureAndApplyMetrics({
        restartAnimation: true,
      });

      applyAnimationState(
        true,
      );

      emitChange(
        SOURCE_VALUES.refresh,
      );

      return true;
    },

    clear(options = {}) {
      const emit =
        options?.emit !== false;

      return setSettingsInternal(
        {
          headline: "",
        },
        SOURCE_VALUES.clear,
        emit,
      );
    },

    destroy() {
      if (
        lifecycle === "destroyed"
      ) {
        return true;
      }

      animationSequence += 1;

      teardownObservers();
      restoreRoot();

      pausedByApi = false;
      lifecycle = "destroyed";

      return true;
    },
  };

  return Object.freeze(api);
}

export {
  DEFAULTS as NEWS_TICKER_DEFAULTS,
};
