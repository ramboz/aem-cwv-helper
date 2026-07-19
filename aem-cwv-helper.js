// See: https://gist.github.com/paulirish/1579671
let last = 0;
window.requestAnimationFrame ||= (cb) => {
  const now = new Date().getTime();
  const next = Math.max(0, 16 - (now - last));
  const id = window.setTimeout(() => cb(now + next), next);
  last = now + next;
  return id;
};
window.cancelAnimationFrame ||= (id) => clearTimeout(id);

// See: https://developer.chrome.com/blog/using-requestidlecallback#checking_for_requestidlecallback
window.requestIdleCallback ||= (cb) => {
  const start = Date.now();
  return window.setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
    });
  });
}

// See: https://kurtextrem.de/posts/improve-inp#run-after-paint-await-interaction-response
async function afterNextPaint(fn) {
  await new Promise((resolve) => {
    // Fallback for the case where the animation frame never fires.
    window.setTimeout(resolve, 100);
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve);
    });
  });
  return fn();
}

// A set to keep track of all unresolved yield promises
const pendingResolvers = new Set();

// Resolves all unresolved yield promises and clears the set.
function resolvePendingPromises() {
  // eslint-disable-next-line no-restricted-syntax
  for (const resolve of pendingResolvers) {
    resolve();
  }
  pendingResolvers.clear();
}

/**
 * Prioritizes the loading of critical images to reduce the LCP duration.
 * @param {String} selector The CSS selector for the images that needed to be prioritized
 */
export function prioritizeImages(selector) {
  document.querySelectorAll(selector).forEach((img) => {
    img.setAttribute('loading', 'eager');
    img.setAttribute('fetchpriority', 'high');
    img.loading = 'eager';
    img.fetchPriority = 'high';
  });
}

// See: https://kurtextrem.de/posts/improve-inp#exit-event-handlers-yieldunlessurgent
// patched to support `scheduler.yield()`
export function yieldUnlessUrgent() {
  return new Promise((resolve) => {
    pendingResolvers.add(resolve);
    if (document.visibilityState === 'visible') {
      const cleanup = () => {
        document.removeEventListener('visibilitychange', cleanup);
        document.removeEventListener('pagehide', cleanup);
        resolvePendingPromises();
      };
      document.addEventListener('visibilitychange', cleanup);
      document.addEventListener('pagehide', cleanup);
      if (window.scheduler?.yield) {
        scheduler.yield().then(resolve);
      } else {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            pendingResolvers.delete(resolve);
            resolve();
          });
        });
      }
      return;
    }
    // Still here? Resolve immediately.
    resolvePendingPromises();
  })
}

/**
 * Runs a costly function that isn't urgent during browser idle time
 * (via `requestIdleCallback`). Use for deferrable non-UI work: expensive
 * API calls, `Intl` formatting, serialization, analytics bookkeeping.
 * @param {Function} fn the logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function runWhenIdle(fn) {
  return new Promise((resolve) => {
    window.requestIdleCallback(() => {
      resolve(fn());
    });
  });
}

/**
 * Runs a UI update right before the next paint (via `requestAnimationFrame`).
 * Use for DOM writes that should be synchronized with the rendering pipeline:
 * adding nodes, toggling classes, changing animated properties.
 * @param {Function} fn the logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function runBeforePaint(fn) {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve(fn());
    });
  });
}

/**
 * Yields to the main thread, so you can break up long tasks and let
 * pending input events run.
 * @returns a promise that resolves when the task can safely resume
 */
export async function yieldToMain() {
  return yieldUnlessUrgent();
}

/**
 * Runs a non-urgent UI update after the next paint. Use for updates that
 * should not compete with the current frame: toasts, badges, revealing
 * async content.
 * @param {Function} fn The logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function runAfterPaint(fn) {
  return afterNextPaint(() => fn());
}

/**
 * Reads a costly DOM value (offsets, client rects, scroll positions…) after
 * the next paint, to limit layout thrashing. Keep writes out of the callback:
 * read here, then write in a separate step.
 * @param {Function} fn The logic to execute
 * @returns a promise that resolves with the value read
 */
export const readAfterPaint = runAfterPaint;

/**
 * @deprecated Use {@link runWhenIdle} instead.
 */
export const callCostlyApi = runWhenIdle;

/**
 * @deprecated Use {@link runBeforePaint} instead.
 */
export const callCostlyUiApi = runBeforePaint;

/**
 * @deprecated Use {@link yieldToMain} instead.
 */
export const splitLongTask = yieldToMain;

/**
 * @deprecated Use {@link runAfterPaint} instead.
 */
export const performAsyncUiUpdate = runAfterPaint;

/**
 * @deprecated Use {@link readAfterPaint} instead.
 */
export const readCostlyDomValue = readAfterPaint;

/**
 * Iterates over an array of items and applies the given function while making sure to yield to the
 * main thread on a regular basis.
 * @param {Object[]} items The items to iterate on
 * @param {Function} fn The function to call for each item
 * @param {Number} limit The maximum execution time before breaking up the long task, defaults to 48ms
 */
export async function splitLongIteration(items, fn, limit = 48) {
  let deadline = performance.now() + limit;
  // eslint-disable-next-line no-restricted-syntax
  for (const item of items) {
    // Yield when we've crossed the deadline
    if (performance.now() >= deadline) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToMain();
      deadline = performance.now() + limit; // update deadline
    }
    fn(item);
  }
}

/**
 * Removes the DOM element in a way that limits costly layout thrashing.
 * @param {DOMElement} el The DOM element to remove
 * @returns a promise that resolves when the element is removed
 */
export async function removeDomNode(el) {
  el.style.display = 'none';
  return runWhenIdle(() => el.remove());
}

/**
 * Patches the data layer push methods to break up long tasks.
 * Deferred pushes are flushed in FIFO order, and the patch survives a tag
 * manager (e.g. GTM) later replacing `push` with its own implementation.
 * @param {Object} dl The data layer object, typically `window.dataLayer`
 */
export function patchDatalayer(dl) {
  // Bind the receiver: before a tag manager loads, `dl.push` is `Array.prototype.push`
  // and calling it unbound throws.
  let originalDataLayerPush = dl.push.bind(dl);
  // Serialize deferred pushes so events keep their original order.
  let queue = Promise.resolve();
  const deferredPush = (...args) => {
    queue = queue
      .then(() => yieldToMain())
      .then(() => originalDataLayerPush(...args));
  };
  // Tag managers replace `dataLayer.push` when they load; capture the
  // replacement instead of letting it overwrite the patch.
  Object.defineProperty(dl, 'push', {
    configurable: true,
    get: () => deferredPush,
    set: (newPush) => {
      originalDataLayerPush = newPush.bind(dl);
    },
  });
}

// Maps an original listener to its deferred wrappers, keyed by `type:capture`,
// so removeEventListener keeps working on patched listeners.
const patchedListeners = new WeakMap();

// Returns the first stack frame that doesn't belong to this module, or null
// when the caller can't be attributed (in which case we must not patch).
function getListenerSource() {
  const { stack } = new Error();
  if (!stack) {
    return null;
  }
  const selfUrl = import.meta.url;
  let selfPath;
  try {
    selfPath = new URL(selfUrl).pathname;
  } catch (e) {
    selfPath = selfUrl;
  }
  const frames = stack.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') || line.includes('@'));
  return frames.find((line) => !line.includes(selfUrl) && !line.includes(selfPath)) || null;
}

function getCaptureFlag(options) {
  return typeof options === 'boolean' ? options : !!(options && options.capture);
}

/**
 * Patches event listeners added by external libraries to break up long tasks, or any library
 * matching a given pattern. `removeEventListener` is patched alongside, so removing an
 * original listener also removes its deferred wrapper.
 *
 * Caveats — this is a last-resort patch:
 * - deferred listeners run after the default action: a late `preventDefault()` is a no-op
 *   (a console warning is emitted when that happens)
 * - only listeners registered on `window` and `document` are patched, not element listeners
 * - caller attribution relies on `Error.prototype.stack`: when a listener can't be attributed
 *   (e.g. everything is bundled into a single file), it is left untouched
 * @param {String[]} types Array of event types to patch, defaults to ['load', 'DOMContentLoaded', 'click']
 * @param {RegExp} pattern A regex pattern for 1st party libraries we want to patch as well
 */
export function patchEventListeners(types = ['load', 'DOMContentLoaded', 'click'], pattern) {
  const lowercaseTypes = types.map((type) => type.toLowerCase());
  const addHandler = {
    apply: function (target, thisArg, argumentsList) {
      const [eventName, listener, options = false] = argumentsList;
      const src = getListenerSource();
      if (src && typeof listener === 'function'
          && lowercaseTypes.includes(String(eventName).toLowerCase())
          && (!src.includes(window.location.hostname)
             || (pattern && src.match(pattern)))) {
        const wrapper = (event) => {
          const { currentTarget, target: eventTarget } = event;
          yieldToMain().then(() => {
            Object.defineProperty(event, 'currentTarget', {
              writable: false,
              value: currentTarget,
            });
            Object.defineProperty(event, 'target', {
              writable: false,
              value: eventTarget,
            });
            const originalPreventDefault = event.preventDefault.bind(event);
            event.preventDefault = () => {
              // eslint-disable-next-line no-console
              console.warn('[aem-cwv-helper] preventDefault() called from a deferred listener: the default action has already run.');
              originalPreventDefault();
            };
            listener.call(currentTarget, event);
          });
        };
        let wrappersByKey = patchedListeners.get(listener);
        if (!wrappersByKey) {
          wrappersByKey = new Map();
          patchedListeners.set(listener, wrappersByKey);
        }
        wrappersByKey.set(`${eventName}:${getCaptureFlag(options)}`, wrapper);
        argumentsList[1] = wrapper;
      }
      return target.call(thisArg, ...argumentsList);
    },
  };
  const removeHandler = {
    apply: function (target, thisArg, argumentsList) {
      const [eventName, listener, options = false] = argumentsList;
      const wrapper = patchedListeners.get(listener)?.get(`${eventName}:${getCaptureFlag(options)}`);
      if (wrapper) {
        argumentsList[1] = wrapper;
      }
      return target.call(thisArg, ...argumentsList);
    },
  };

  window.addEventListener = new Proxy(window.addEventListener, addHandler);
  document.addEventListener = new Proxy(document.addEventListener, addHandler);
  window.removeEventListener = new Proxy(window.removeEventListener, removeHandler);
  document.removeEventListener = new Proxy(document.removeEventListener, removeHandler);
}

/**
 * Debounces a UI update to prevent layout thrashing in event handlers that are called frequently.
 * @param {Function} fn The function to call
 * @returns {Function} a debounced function returning a promise that resolves once the update ran.
 *          Superseded calls settle with the result of the call that actually executed.
 */
export function debounceUiUpdate(fn) {
  let rafId;
  let supersededResolve;
  return (...args) => {
    cancelAnimationFrame(rafId);
    let resolveCurrent;
    const promise = new Promise((resolve) => {
      resolveCurrent = resolve;
    });
    rafId = requestAnimationFrame(() => {
      supersededResolve = null;
      resolveCurrent(fn(...args));
    });
    // Don't leak pending promises: a superseded call adopts the latest call's result.
    if (supersededResolve) {
      supersededResolve(promise);
    }
    supersededResolve = resolveCurrent;
    return promise;
  };
}

/**
 * Loads a CSS file in a way that doesn't block the main thread.
 * @param {String} href The URL of the CSS file to load
 * @returns a promise that resolves when the CSS file was loaded
 */
export function loadDeferredCSS(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.media = 'print';
  link.href = href;
  return runWhenIdle(() => new Promise((resolve) => {
    // Only switch to `all` once the file is loaded, so the stylesheet
    // never becomes render-blocking.
    link.onload = () => {
      link.media = 'all';
      resolve();
    };
    link.onerror = resolve;
    document.head.appendChild(link);
  }));
}

/**
 * Prefetches resources to improve LCP.
 * @param {String[]} urls The URLs of the resources to prefetch
 * @returns a promise that resolves when the resources were prefetched
 */
export async function prefetchResources(urls) {
  return runWhenIdle(() => Promise.all(urls.map((url) => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  }))));
}

/**
 * Builds a short, human-readable CSS selector for an element (diagnostics only).
 */
function getSelector(el) {
  if (!el || !el.tagName) {
    return null;
  }
  if (el.id) {
    return `#${el.id}`;
  }
  const tag = el.tagName.toLowerCase();
  const classes = typeof el.className === 'string' && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
    : '';
  const parent = el.parentElement?.tagName ? `${el.parentElement.tagName.toLowerCase()} > ` : '';
  return `${parent}${tag}${classes}`;
}

// True once the element has generated at least one layout box, i.e. it has
// been (or is about to be) painted.
function isRendered(el) {
  return el.getClientRects().length > 0;
}

// Warns when a space-reservation helper runs after first contentful paint on an
// element that is already rendered: at that point the reservation itself causes
// the layout shift it is meant to prevent. Elements that are still hidden (e.g.
// sections gated until decoration) don't warn — reserving their space is still safe.
function warnIfReservedTooLate(helper, el) {
  const [fcp] = performance.getEntriesByName?.('first-contentful-paint') || [];
  if (fcp && isRendered(el)) {
    // eslint-disable-next-line no-console
    console.warn(`[aem-cwv-helper] ${helper}() ran ${Math.round(performance.now() - fcp.startTime)}ms after first contentful paint on an already-rendered element (${getSelector(el)}): the reservation itself now causes the shift it is meant to prevent. Reserve the space in CSS instead, or call this before the content is first rendered.`);
    return true;
  }
  return false;
}

/**
 * Reserves vertical space for content that loads asynchronously (banners, ads,
 * third-party widgets), so its arrival doesn't shift the elements below it.
 * Prefer a static CSS min-height when the value is known ahead of time; use
 * this helper when the reservation is only known at runtime. Must run before
 * the container is first painted — a warning is logged otherwise.
 * @param {String} selector The CSS selector for the containers to reserve
 * @param {Number|String} minHeight The height to reserve (px number, or any CSS length)
 */
export function reserveSpace(selector, minHeight) {
  const value = typeof minHeight === 'number' ? `${minHeight}px` : minHeight;
  document.querySelectorAll(selector).forEach((el) => {
    warnIfReservedTooLate('reserveSpace', el);
    el.style.setProperty('min-height', value);
  });
}

/**
 * Gives unsized media (images, videos, iframes) an aspect-ratio so the browser
 * reserves their space before they load. Sizing sources, in order: existing
 * width/height attributes, a data-aspect-ratio attribute (e.g. "16 / 9"), the
 * defaultAspectRatio option, or — for already-loaded images — their natural
 * dimensions. Elements whose ratio can't be determined are returned (and
 * reported) so you can size them explicitly.
 * @param {Element|Document} root The root to scan, defaults to document
 * @param {Object} options
 * @param {String} options.defaultAspectRatio Fallback ratio (e.g. '16 / 9')
 * @returns {Element[]} the media elements that could not be stabilized
 */
export function stabilizeMedia(root = document, { defaultAspectRatio } = {}) {
  const unresolved = [];
  root.querySelectorAll('img, video, iframe').forEach((el) => {
    const computed = window.getComputedStyle(el).aspectRatio;
    if (computed && computed !== 'auto') {
      return; // already sized via CSS
    }
    const width = el.getAttribute('width');
    const height = el.getAttribute('height');
    const isLoadedImage = el.tagName === 'IMG' && el.complete && el.naturalWidth > 0;
    let ratio = null;
    if (width && height) {
      ratio = `${width} / ${height}`;
    } else if (el.dataset.aspectRatio) {
      ratio = el.dataset.aspectRatio;
    } else if (isLoadedImage) {
      ratio = `${el.naturalWidth} / ${el.naturalHeight}`;
    } else if (defaultAspectRatio) {
      ratio = defaultAspectRatio;
    }
    if (ratio) {
      // A loaded image already occupies its final box; applying its own ratio is shift-free.
      if (!isLoadedImage) {
        warnIfReservedTooLate('stabilizeMedia', el);
      }
      el.style.setProperty('aspect-ratio', ratio);
    } else {
      unresolved.push(el);
    }
  });
  if (unresolved.length) {
    // eslint-disable-next-line no-console
    console.warn(`[aem-cwv-helper] stabilizeMedia() could not determine an aspect ratio for ${unresolved.length} element(s); size them via width/height attributes, data-aspect-ratio, or CSS.`, unresolved);
  }
  return unresolved;
}

/**
 * Reveals a hidden element without shifting the layout around it. The element
 * must already occupy its final space (or be out of the normal flow, e.g.
 * position fixed/absolute): the helper toggles a class that should animate
 * compositor-only properties (opacity, transform). It warns when the element is
 * display:none and in the normal flow, because revealing it would shift its siblings.
 * @param {DOMElement} el The element to reveal
 * @param {String} revealClass The class to add, defaults to 'is-visible'
 * @returns a promise that resolves when the class was applied
 */
export async function revealWithoutShift(el, revealClass = 'is-visible') {
  const { display, position } = window.getComputedStyle(el);
  if (display === 'none' && !['fixed', 'absolute'].includes(position)) {
    // eslint-disable-next-line no-console
    console.warn('[aem-cwv-helper] revealWithoutShift(): the element is display:none and in the normal flow, so revealing it will shift its siblings. Reserve its space (or take it out of the flow) and animate only opacity/transform.');
  }
  return runBeforePaint(() => el.classList.add(revealClass));
}

// Timestamp of the most recent discrete user input; layout shifts within 500ms
// of one are excluded from CLS (hadRecentInput).
const DISCRETE_INPUT_EVENTS = ['pointerdown', 'keydown'];
const CLS_INPUT_GRACE = 500;
let lastDiscreteInput = 0;
let discreteInputTracked = false;

function trackDiscreteInput() {
  if (discreteInputTracked) {
    return;
  }
  discreteInputTracked = true;
  DISCRETE_INPUT_EVENTS.forEach((type) => {
    window.addEventListener(type, () => {
      lastDiscreteInput = performance.now();
    }, { capture: true, passive: true });
  });
}

/**
 * Runs a layout-shifting DOM update (typically inserting late content like
 * banners or recommendations) inside the 500ms grace window that follows a
 * discrete user input, where layout shifts are excluded from CLS. Falls back to
 * running after `timeout` milliseconds if the user never interacts.
 * @param {Function} fn The DOM update to run
 * @param {Object} options
 * @param {Number} options.timeout Max time to wait for an interaction, defaults to 4000ms
 * @returns a promise that resolves with the function result
 */
export function insertAfterInteraction(fn, { timeout = 4000 } = {}) {
  trackDiscreteInput();
  return new Promise((resolve) => {
    if (lastDiscreteInput && performance.now() - lastDiscreteInput < CLS_INPUT_GRACE) {
      resolve(runBeforePaint(fn));
      return;
    }
    let timeoutId;
    const run = () => {
      window.clearTimeout(timeoutId);
      DISCRETE_INPUT_EVENTS.forEach((type) => window.removeEventListener(type, run, true));
      resolve(runBeforePaint(fn));
    };
    DISCRETE_INPUT_EVENTS.forEach((type) => window.addEventListener(type, run, { capture: true, passive: true }));
    timeoutId = window.setTimeout(run, timeout);
  });
}

/**
 * Runs a DOM update inside a View Transition when the browser supports it:
 * shifts that happen inside a view transition are animated smoothly and don't
 * count as unexpected layout shifts. Falls back to running the update on the
 * next frame otherwise.
 * @param {Function} fn The DOM update to run
 * @returns a promise that resolves with the function result once the transition finished
 */
export async function updateWithViewTransition(fn) {
  if (typeof document.startViewTransition !== 'function') {
    return runBeforePaint(fn);
  }
  let result;
  const transition = document.startViewTransition(() => {
    result = fn();
    return result;
  });
  await transition.finished;
  return result;
}

// Creates a PerformanceObserver for the given entry type, or returns null when
// the browser doesn't support it.
function observeEntries(type, options, handle) {
  const Observer = window.PerformanceObserver;
  if (typeof Observer !== 'function' || !(Observer.supportedEntryTypes || []).includes(type)) {
    return null;
  }
  try {
    const observer = new Observer((list) => list.getEntries().forEach(handle));
    observer.observe({ type, buffered: true, ...options });
    return observer;
  } catch (e) {
    return null;
  }
}

/**
 * Observes layout shifts and reports each shift's score and the elements that
 * moved, flagging the likely culprit: the first source whose box changed size.
 * Bigger sources that merely moved are usually victims pushed by it, not the cause.
 * @param {Function} callback Called with { value, culprit, sources, entry }
 * @param {Object} options
 * @param {Boolean} options.includeRecentInput Also report input-excluded shifts, defaults to false
 * @returns {PerformanceObserver} the observer (call disconnect() to stop), or null if unsupported
 */
export function observeLayoutShifts(callback, { includeRecentInput = false } = {}) {
  return observeEntries('layout-shift', {}, (entry) => {
    if (entry.hadRecentInput && !includeRecentInput) {
      return;
    }
    const sources = (entry.sources || []).map((source) => ({
      node: source.node,
      selector: getSelector(source.node),
      previousRect: source.previousRect,
      currentRect: source.currentRect,
      resized: source.previousRect.width !== source.currentRect.width
        || source.previousRect.height !== source.currentRect.height,
    }));
    callback({
      value: entry.value,
      culprit: sources.find((source) => source.resized) || sources[0] || null,
      sources,
      entry,
    });
  });
}

/**
 * Observes Largest Contentful Paint candidates as the browser upgrades them,
 * reporting the element, its selector, url, size and render time. The last
 * reported candidate is the page's LCP element.
 * @param {Function} callback Called with { element, selector, url, size, startTime, entry }
 * @returns {PerformanceObserver} the observer (call disconnect() to stop), or null if unsupported
 */
export function observeLcpCandidates(callback) {
  return observeEntries('largest-contentful-paint', {}, (entry) => {
    callback({
      element: entry.element || null,
      selector: getSelector(entry.element),
      url: entry.url || null,
      size: entry.size,
      startTime: entry.startTime,
      entry,
    });
  });
}

/**
 * Observes slow interactions (the events INP is computed from), reporting the
 * target and the input-delay / processing / presentation-delay breakdown that
 * tells you which phase to fix.
 * @param {Function} callback Called with { target, selector, type, duration, inputDelay, processingTime, presentationDelay, entry }
 * @param {Object} options
 * @param {Number} options.durationThreshold Minimum duration to report in ms, defaults to 200
 * @returns {PerformanceObserver} the observer (call disconnect() to stop), or null if unsupported
 */
export function observeSlowInteractions(callback, { durationThreshold = 200 } = {}) {
  return observeEntries('event', { durationThreshold }, (entry) => {
    if (!entry.interactionId) {
      return;
    }
    callback({
      target: entry.target || null,
      selector: getSelector(entry.target),
      type: entry.name,
      duration: entry.duration,
      inputDelay: entry.processingStart - entry.startTime,
      processingTime: entry.processingEnd - entry.processingStart,
      presentationDelay: entry.duration - (entry.processingEnd - entry.startTime),
      entry,
    });
  });
}
