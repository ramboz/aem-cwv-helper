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
 * @param {Object} dl The data layer object, typically `window.dataLayer`
 */
export function patchDatalayer(dl) {
  // Bind the receiver: before a tag manager loads, `dl.push` is `Array.prototype.push`
  // and calling it unbound throws.
  const originalDataLayerPush = dl.push.bind(dl);
  dl.push = (...args) => {
    yieldToMain().then(() => {
      originalDataLayerPush(...args);
    });
  };
}

/**
 * Patches event listeners added by external libraries to break up long tasks, or any library
 * matching a given pattern.
 * @param {String[]} types Array of event types to patch, defaults to ['load', 'DOMContentLoaded', 'click']
 * @param {RegExp} pattern A regex pattern for 1st party libraries we want to patch as well
 */
export function patchEventListeners(types = ['load', 'DOMContentLoaded', 'click'], pattern) {
  const lowercaseTypes = types.map((type) => type.toLowerCase());
  const handler = {
    apply: function (target, thisArg, argumentsList) {
      const [eventName, listener, options = false] = argumentsList;
      const src = new Error().stack.split('\n')[2];
      if (src && lowercaseTypes.includes(eventName.toLowerCase())
          && (!src.includes(window.location.hostname)
             || (pattern && src.match(pattern)))) {
        argumentsList[1] = (event) => {
          const { currentTarget, target } = event;
          yieldToMain().then(() => {
            Object.defineProperty(event, 'currentTarget', {
              writable: false,
              value: currentTarget,
            });
            Object.defineProperty(event, 'target', {
              writable: false,
              value: target,
            });
            listener(event);
          });
        }
      }
      return target.call(thisArg, ...argumentsList);
    },
  };
  
  window.addEventListener = new Proxy(window.addEventListener, handler);
  document.addEventListener = new Proxy(document.addEventListener, handler);
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
