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
 * Prioritizes the loaing of critical images to reduce the LCP duration.
 * @param {String} selector The CSS selector for the images that needed to be prioritized
 */
export function prioritizeImages(selector) {
  document.querySelectorAll(selector).forEach((img) => {
    img.setAttribute('loading', 'eager');
    img.setAttribute('fetchpriority', 'high');
    img.loading = 'eager';
    img.fetchpriority = 'high';
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
 * Performs a costly API call that isn't urgent.
 * @param {Function} fn the logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function callCostlyApi(fn) {
  return new Promise((resolve) => {
    window.requestIdleCallback(() => {
      resolve(fn());
    });  
  });
}

/**
 * Performs a costly UI update on that isn't urgent.
 * @param {Function} fn the logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function callCostlyUiApi(fn) {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve(fn());
    });  
  });
}

/**
 * A method that yields to the main thread, so you can break up long tasks.
 * @returns a promise that resolves when the task can safely resume
 */
export async function splitLongTask() {
  return yieldUnlessUrgent();
}

/**
 * Performs an async UI update that isn't urgent.
 * @param {Function} fn The logic to execute
 * @returns a promise that resolves when the function was executed
 */
export async function performAsyncUiUpdate(fn) {
  return afterNextPaint(() => fn());
}

/**
 * Reads a costly DOM value that typically causes layout thrashing.
 * @param {Function} fn The logic to execute
 * @returns a promise that resolves when the function was executed
 */
export const readCostlyDomValue = performAsyncUiUpdate;

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
      await splitLongTask();
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
  return callCostlyApi(() => el.remove());
}

/**
 * Patches the data layer push methods to break up long tasks.
 * @param {Object} dl The data layer object, typically `window.dataLayer`
 */
export function patchDatalayer(dl) {
  const originalDataLayerPush = dl.push;
  dl.push = (...args) => {
    splitLongTask().then(() => {
      originalDataLayerPush(...args);
    });
  };
}

/**
 * Patches event listeners added by external libraries to break up long tasks, or any library
 * matching a given pattern.
 * @param {String[]} types Array of event types to patch, defaults to ['load', 'DOMContentLoaded', 'click']
 * @param {RegEx} pattern A regex pattern for 1st party libraries we want to patch as well
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
          splitLongTask().then(() => {
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
 * @returns a functiona promise that resolves when the desired logic was executed
 */
export function debounceUiUpdate(fn) {
  let rafId;
  return (...args) => {
    cancelAnimationFrame(rafId);
    return new Promise((resolve) => {
      rafId = requestAnimationFrame(() => {
        resolve(fn(...args));
      });
    });
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
  return callCostlyApi(() => {
    document.head.appendChild(link);
    link.media = 'all';
  });
}

/**
 * Prefetches resources to improve LCP.
 * @param {String[]} urls The URLs of the resources to prefetch
 * @returns a promise that resolves when the resources were prefetched
 */
export async function prefetchResources(urls) {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  return callCostlyApi(() => {
    document.head.appendChild(link);
    return new Promise((resolve) => {
      link.onload = resolve;
    });
  });
}
