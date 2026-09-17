/**
 * Production-grade DOM news ticker module.
 *
 * Scope:
 * - Owns the DOM ticker preview rooted at #news-ticker or a supplied root.
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
  animation: "data-animation",
  error: "data-ticker-error",
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

const POSITION_VALUES = Object.freeze([
  "top",
  "middle",
  "bottom",
]);

const DIRECTION_VALUES = Object.freeze([
  "rtl",
  "ltr",
]);

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
  restartDelayMs: 0,
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
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function cloneSettings(settings) {
  return { ...settings };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const number =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (
    value === "true" ||
    value === "1" ||
    value === 1
  ) {
    return true;
  }

  if (
    value === "false" ||
    value === "0" ||
    value === 0
  ) {
    return false;
  }

  return fallback;
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value
    .trim()
    .slice(0, LIMITS.headlineMaxLength);
}

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.includes(value)
    ? value
    : fallback;
}

function normalizeSpeed(
  value,
  fallback = DEFAULTS.speed,
) {
  const numeric = toFiniteNumber(
    value,
    fallback,
  );

  return clamp(
    Math.round(numeric),
    LIMITS.speedMin,
    LIMITS.speedMax,
  );
}

function normalizeFontSize(
  value,
  fallback = DEFAULTS.fontSize,
) {
  const numeric = toFiniteNumber(
    value,
    fallback,
  );

  return clamp(
    Math.round(numeric),
    LIMITS.fontSizeMin,
    LIMITS.fontSizeMax,
  );
}

function normalizeColor(
  value,
  fallback,
  documentRef,
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    return fallback;
  }

  const candidate = value.trim();

  try {
    if (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function"
    ) {
      return CSS.supports(
        "color",
        candidate,
      )
        ? candidate
        : fallback;
    }
  } catch {
    // Continue with DOM-based validation.
  }

  if (documentRef?.createElement) {
    try {
      const probe =
        documentRef.createElement("span");

      probe.style.color = "";
      probe.style.color = candidate;

      return probe.style.color
        ? candidate
        : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeSettings(
  input,
  {
    previous = DEFAULTS,
    documentRef,
  } = {},
) {
  const source = isObject(input)
    ? input
    : {};

  const base = isObject(previous)
    ? previous
    : DEFAULTS;

  const textColorFallback =
    normalizeColor(
      base.textColor,
      DEFAULTS.textColor,
      documentRef,
    );

  const backgroundColorFallback =
    normalizeColor(
      base.backgroundColor,
      DEFAULTS.backgroundColor,
      documentRef,
    );

  return {
    enabled: normalizeBoolean(
      source.enabled,
      normalizeBoolean(
        base.enabled,
        DEFAULTS.enabled,
      ),
    ),

    headline: normalizeText(
      source.headline,
      normalizeText(
        base.headline,
        DEFAULTS.headline,
      ),
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
      normalizeSpeed(
        base.speed,
        DEFAULTS.speed,
      ),
    ),

    fontSize: normalizeFontSize(
      source.fontSize,
      normalizeFontSize(
        base.fontSize,
        DEFAULTS.fontSize,
      ),
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
      normalizeBoolean(
        base.bold,
        DEFAULTS.bold,
      ),
    ),
  };
}

function createCustomEvent(
  documentRef,
  name,
  detail,
) {
  if (
    typeof CustomEvent === "function"
  ) {
    return new CustomEvent(name, {
      detail,
    });
  }

  if (documentRef?.createEvent) {
    const event =
      documentRef.createEvent(
        "CustomEvent",
      );

    event.initCustomEvent(
      name,
      false,
      false,
      detail,
    );

    return event;
  }

  return null;
}

function safeInvoke(
  callback,
  payload,
  onError,
  errorContext,
) {
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
        message:
          `${errorContext} callback threw an exception.`,
        error,
      });
    } catch {
      // Callback error reporting must never escape the module.
    }
  }
}

function resolveDocument(
  root,
  explicitDocument,
) {
  if (explicitDocument) {
    return explicitDocument;
  }

  if (root?.ownerDocument) {
    return root.ownerDocument;
  }

  if (
    typeof document !== "undefined"
  ) {
    return document;
  }

  return null;
}

function resolveRoot(
  rootOption,
  documentRef,
) {
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
    return documentRef.querySelector(
      selector,
    );
  } catch {
    return null;
  }
}

function setAttributeSafe(
  element,
  name,
  value,
) {
  try {
    if (
      value === null ||
      value === undefined
    ) {
      element?.removeAttribute?.(name);
      return;
    }

    element?.setAttribute?.(
      name,
      String(value),
    );
  } catch {
    // Ignore individual attribute failures.
  }
}

function setStylePropertySafe(
  style,
  property,
  value,
) {
  try {
    style?.setProperty?.(
      property,
      value,
    );
  } catch {
    // Ignore unsupported style operations.
  }
}

function removeStylePropertySafe(
  style,
  property,
) {
  try {
    style?.removeProperty?.(
      property,
    );
  } catch {
    // Ignore unsupported style operations.
  }
}

function getAnimationDurationSeconds(
  speed,
  distancePx,
) {
  const safeDistance = Math.max(
    ANIMATION.minTravelDistancePx,
    distancePx,
  );

  const pixelsPerSecond = Math.max(
    ANIMATION.pixelsPerSpeedUnit,
    speed * ANIMATION.pixelsPerSpeedUnit,
  );

  const duration =
    safeDistance / pixelsPerSecond;

  return clamp(
    duration,
    ANIMATION.minDurationSeconds,
    ANIMATION.maxDurationSeconds,
  );
}

function prefersReducedMotion(
  windowRef,
) {
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

function isElement(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.nodeType === 1,
  );
}

function createElement(
  documentRef,
  tagName,
  className,
) {
  const element =
    documentRef?.createElement?.(
      tagName,
    );

  if (!element) {
    return null;
  }

  if (className) {
    element.className = className;
  }

  return element;
}

function getElementInlineStyleSnapshot(
  element,
) {
  return {
    cssText:
      element?.getAttribute?.(
        "style",
      ) ?? null,
  };
}

function restoreInlineStyle(
  element,
  snapshot,
) {
  if (!element || !snapshot) {
    return;
  }

  try {
    if (
      snapshot.cssText === null ||
      snapshot.cssText === ""
    ) {
      element.removeAttribute("style");
    } else {
      element.setAttribute(
        "style",
        snapshot.cssText,
      );
    }
  } catch {
    // Ignore restoration failures.
  }
}

function getAttributeSnapshot(
  element,
  names,
) {
  const snapshot = {};

  names.forEach((name) => {
    snapshot[name] =
      element?.getAttribute?.(
        name,
      ) ?? null;
  });

  return snapshot;
}

function restoreAttributes(
  element,
  snapshot,
) {
  if (!element || !snapshot) {
    return;
  }

  Object.entries(snapshot).forEach(
    ([name, value]) => {
      setAttributeSafe(
        element,
        name,
        value,
      );
    },
  );
}

export function createNewsTickerModule(
  options = {},
) {
  const factoryOptions = isObject(options)
    ? options
    : {};

  let root = factoryOptions.root ?? null;

  const documentRef = resolveDocument(
    root,
    factoryOptions.document,
  );

  const windowRef =
    documentRef?.defaultView ??
    (typeof window !== "undefined"
      ? window
      : null);

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

  let moduleRoot = null;
  let elements = null;

  let originalChildNodes = null;
  let originalRootClassName = null;
  let originalRootAttributes = null;
  let originalRootInlineStyle = null;

  let lastError = null;
  let readyNotified = false;

  const callbacks = {
    onChange:
      typeof factoryOptions.onChange ===
      "function"
        ? factoryOptions.onChange
        : NOOP,

    onError:
      typeof factoryOptions.onError ===
      "function"
        ? factoryOptions.onError
        : NOOP,

    onReady:
      typeof factoryOptions.onReady ===
      "function"
        ? factoryOptions.onReady
        : NOOP,

    onVisibilityChange:
      typeof factoryOptions.onVisibilityChange ===
      "function"
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
        DATA_ATTRIBUTES.error,
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
          DATA_ATTRIBUTES.error,
        );
      } catch {
        // Ignore.
      }
    }
  };

  const getSerializableState = () => ({
    initialized:
      lifecycle === "ready",

    destroyed:
      lifecycle === "destroyed",

    enabled: settings.enabled,
    headline: settings.headline,
    position: settings.position,
    direction: settings.direction,
    speed: settings.speed,
    fontSize: settings.fontSize,
    textColor: settings.textColor,
    backgroundColor: settings.backgroundColor,
    bold: settings.bold,

    hasContent:
      settings.headline.length > 0,

    paused:
      pausedByApi ||
      prefersReducedMotion(windowRef),

    lifecycle,

    reducedMotion:
      prefersReducedMotion(windowRef),

    currentDistancePx,

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
      (callbackError) => {
        reportError(
          "CALLBACK_ERROR",
          "The onChange callback threw an exception.",
          callbackError,
        );
      },
      "onChange",
    );

    if (
      moduleRoot?.dispatchEvent
    ) {
      try {
        const event =
          createCustomEvent(
            documentRef,
            "news-ticker-change",
            payload,
          );

        if (event) {
          moduleRoot.dispatchEvent(
            event,
          );
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
      elements.primaryGroup,
      "aria-hidden",
      "false",
    );

    setAttributeSafe(
      elements.secondaryGroup,
      "aria-hidden",
      "true",
    );

    /*
     * The outer #news-ticker host already carries
     * aria-live="polite" in index.html.
     *
     * The hidden status element is not used as a
     * second live region to avoid duplicate announcements.
     */
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
      elements.status.textContent = "";
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

  const setTrackAnimationName = (
    direction,
  ) => {
    if (!elements?.track) {
      return;
    }

    /*
     * The CSS contract uses the existing
     * `news-ticker-marquee` keyframe.
     *
     * For RTL, the normal keyframe direction is used.
     * For LTR, the same keyframe is reversed.
     *
     * The track's measured distance is always the
     * width of one duplicated group, so the loop
     * remains aligned in either direction.
     */
    try {
      elements.track.style.animationDirection =
        direction === "rtl"
          ? "normal"
          : "reverse";
    } catch {
      // Ignore unsupported animation controls.
    }
  };

  const applyAnimationState = ({
    restart = false,
  } = {}) => {
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
      DATA_ATTRIBUTES.animation,
      active
        ? "running"
        : "paused",
    );

    try {
      elements.track.style.animationPlayState =
        active
          ? "running"
          : "paused";

      setTrackAnimationName(
        settings.direction,
      );
    } catch {
      // Ignore unsupported inline animation controls.
    }

    if (!restart) {
      return;
    }

    animationSequence += 1;

    const sequence =
      animationSequence;

    if (animationRestartTimer) {
      clearTimeout(
        animationRestartTimer,
      );

      animationRestartTimer = null;
    }

    /*
     * Restart without permanently overriding
     * stylesheet animation-name/duration rules.
     */
    try {
      elements.track.style.animationPlayState =
        "paused";

      elements.track.style.animation =
        "none";

      void elements.track.offsetWidth;
    } catch {
      // Ignore non-visual DOM limitations.
    }

    animationRestartTimer =
      setTimeout(() => {
        animationRestartTimer = null;

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

          setTrackAnimationName(
            settings.direction,
          );

          elements.track.style.animationPlayState =
            active
              ? "running"
              : "paused";
        } catch {
          // Ignore.
        }
      }, ANIMATION.restartDelayMs);
  };

  const measureGroupWidth = (
    group,
  ) => {
    if (!group) {
      return 0;
    }

    let width = 0;

    try {
      width = Math.max(
        Number(
          group.getBoundingClientRect?.()
            ?.width,
        ) || 0,

        Number(
          group.scrollWidth,
        ) || 0,

        Number(
          group.offsetWidth,
        ) || 0,
      );
    } catch {
      width = Math.max(
        Number(group.scrollWidth) || 0,
        Number(group.offsetWidth) || 0,
      );
    }

    return width;
  };

  const measureAndApplyMetrics = ({
    restartAnimation = true,
  } = {}) => {
    if (
      !elements?.primaryGroup ||
      !elements?.viewport ||
      !elements?.track
    ) {
      currentDistancePx = 0;
      return 0;
    }

    const groupWidth = measureGroupWidth(
      elements.primaryGroup,
    );

    const viewportWidth = Math.max(
      Number(
        elements.viewport
          .getBoundingClientRect?.()
          ?.width,
      ) || 0,

      Number(
        elements.viewport.clientWidth,
      ) || 0,

      Number(
        elements.viewport.offsetWidth,
      ) || 0,
    );

    /*
     * The duplicated group is separated by the
     * CSS gap. The animation distance must include
     * the first group's width and the inter-group
     * gap so the second group takes its exact place.
     */
    let groupGap = 0;

    try {
      const computedStyle =
        windowRef?.getComputedStyle?.(
          elements.track,
        );

      const rawGap =
        computedStyle?.columnGap ||
        computedStyle?.gap ||
        "0";

      const parsedGap =
        Number.parseFloat(rawGap);

      groupGap = Number.isFinite(parsedGap)
        ? Math.max(0, parsedGap)
        : 0;
    } catch {
      groupGap = 0;
    }

    const contentDistance = Math.max(
      ANIMATION.minTravelDistancePx,
      groupWidth + groupGap,
    );

    /*
     * If the group is narrower than the viewport,
     * use at least the viewport width to prevent
     * visible blank space during the loop.
     */
    const distance = Math.max(
      contentDistance,
      viewportWidth,
      ANIMATION.minTravelDistancePx,
    );

    currentDistancePx = distance;

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
      settings.direction,
    );

    if (restartAnimation) {
      applyAnimationState({
        restart: true,
      });
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
      clearTimeout(resizeTimer);
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
      clearTimeout(resizeTimer);
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

        if (elements?.primaryGroup) {
          resizeObserver.observe(
            elements.primaryGroup,
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
      resizeListener = scheduleRefresh;

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

        applyAnimationState({
          restart: true,
        });

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

  const snapshotRoot = () => {
    if (!moduleRoot) {
      return;
    }

    originalChildNodes = Array.from(
      moduleRoot.childNodes ?? [],
    );

    originalRootClassName =
      moduleRoot.getAttribute?.(
        "class",
      ) ?? null;

    originalRootAttributes =
      getAttributeSnapshot(
        moduleRoot,
        [
          "aria-hidden",
          DATA_ATTRIBUTES.position,
          DATA_ATTRIBUTES.direction,
          DATA_ATTRIBUTES.enabled,
          DATA_ATTRIBUTES.error,
        ],
      );

    originalRootInlineStyle =
      getElementInlineStyleSnapshot(
        moduleRoot,
      );
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

    snapshotRoot();

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

      return false;
    }

    /*
     * Only replace the host's children after all
     * required ticker nodes have been constructed.
     */
    while (moduleRoot.firstChild) {
      moduleRoot.removeChild(
        moduleRoot.firstChild,
      );
    }

    labelDot.setAttribute(
      "aria-hidden",
      "true",
    );

    label.appendChild(labelDot);

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

    viewport.appendChild(track);

    status.hidden = true;
    status.setAttribute("role", "status");
    status.setAttribute(
      "aria-hidden",
      "true",
    );

    moduleRoot.appendChild(label);
    moduleRoot.appendChild(viewport);
    moduleRoot.appendChild(status);

    moduleRoot.classList?.add?.(
      CLASS_NAMES.root,
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

    while (moduleRoot.firstChild) {
      moduleRoot.removeChild(
        moduleRoot.firstChild,
      );
    }

    if (
      originalChildNodes &&
      originalChildNodes.length > 0
    ) {
      originalChildNodes.forEach(
        (child) => {
          try {
            moduleRoot.appendChild(child);
          } catch {
            // Ignore individual node restoration failures.
          }
        },
      );
    }

    if (
      originalRootClassName === null ||
      originalRootClassName === undefined
    ) {
      try {
        moduleRoot.removeAttribute(
          "class",
        );
      } catch {
        // Ignore.
      }
    } else {
      setAttributeSafe(
        moduleRoot,
        "class",
        originalRootClassName,
      );
    }

    restoreAttributes(
      moduleRoot,
      originalRootAttributes,
    );

    restoreInlineStyle(
      moduleRoot,
      originalRootInlineStyle,
    );

    Object.values(CSS_VARS).forEach(
      (property) => {
        removeStylePropertySafe(
          moduleRoot.style,
          property,
        );
      },
    );

    elements = null;
    moduleRoot = null;

    originalChildNodes = null;
    originalRootClassName = null;
    originalRootAttributes = null;
    originalRootInlineStyle = null;

    currentDistancePx = 0;
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
      !assertUsable("setSettings")
    ) {
      return cloneSettings(settings);
    }

    const incoming = isObject(
      nextSettings,
    )
      ? nextSettings
      : {};

    const normalized = normalizeSettings(
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
      Boolean(normalized.headline) !==
        Boolean(settings.headline);

    if (changedKeys.length === 0) {
      return cloneSettings(settings);
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
        changedKeys.some((key) =>
          [
            "headline",
            "direction",
            "speed",
            "fontSize",
            "bold",
          ].includes(key),
        );

      const shouldRestart =
        metricsChanged ||
        hadVisibilityChange;

      measureAndApplyMetrics({
        restartAnimation: shouldRestart,
      });

      if (!shouldRestart) {
        applyAnimationState({
          restart: false,
        });
      }
    }

    if (hadVisibilityChange) {
      emitVisibility();
    }

    if (emit) {
      emitChange(source);
    }

    return cloneSettings(settings);
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
          restoreRoot();
          return false;
        }

        applyRootStyles();
        updateVisibleContent();

        measureAndApplyMetrics({
          restartAnimation: false,
        });

        /*
         * Set ready before starting the restart timer.
         * This prevents the initial animation callback
         * from being rejected by lifecycle checks.
         */
        lifecycle = "ready";

        applyAnimationState({
          restart: true,
        });

        installObservers();
        clearError();

        if (!readyNotified) {
          readyNotified = true;

          safeInvoke(
            callbacks.onReady,
            Object.freeze({
              settings: cloneSettings(
                settings,
              ),
              state: getSerializableState(),
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
      return cloneSettings(settings);
    },

    getState() {
      return getSerializableState();
    },

    getRenderModel() {
      return {
        enabled: settings.enabled,
        text: settings.headline,
        position: settings.position,
        direction: settings.direction,
        speed: settings.speed,
        fontSize: settings.fontSize,
        textColor: settings.textColor,
        backgroundColor:
          settings.backgroundColor,
        bold: settings.bold,
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
        !SETTING_KEYS.includes(key)
      ) {
        reportError(
          "INVALID_SETTING",
          `Unknown ticker setting: ${String(key)}.`,
        );

        return cloneSettings(settings);
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
      const source = isObject(colors)
        ? colors
        : {};

      return setSettingsInternal(
        {
          textColor: source.textColor,
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
        !assertUsable("pause")
      ) {
        return false;
      }

      if (lifecycle !== "ready") {
        return false;
      }

      if (pausedByApi) {
        return true;
      }

      pausedByApi = true;

      applyAnimationState({
        restart: false,
      });

      emitChange(
        SOURCE_VALUES.api,
      );

      return true;
    },

    resume() {
      if (
        !assertUsable("resume")
      ) {
        return false;
      }

      if (lifecycle !== "ready") {
        return false;
      }

      if (!pausedByApi) {
        return true;
      }

      pausedByApi = false;

      applyAnimationState({
        restart: false,
      });

      emitChange(
        SOURCE_VALUES.api,
      );

      return true;
    },

    refresh() {
      if (
        !assertUsable("refresh")
      ) {
        return false;
      }

      if (lifecycle !== "ready") {
        return false;
      }

      clearError();

      updateVisibleContent();
      applyRootStyles();

      measureAndApplyMetrics({
        restartAnimation: true,
      });

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
