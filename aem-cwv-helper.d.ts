/**
 * Type declarations for aem-cwv-helper.
 */

/** Prioritizes the loading of critical images to reduce the LCP duration. */
export function prioritizeImages(selector: string): void;

/** Yields to the main thread unless the page is being hidden or unloaded. */
export function yieldUnlessUrgent(): Promise<void>;

/** Runs a costly, non-urgent function during browser idle time. */
export function callCostlyApi<T>(fn: () => T | Promise<T>): Promise<T>;

/** Runs a costly UI update on the next animation frame. */
export function callCostlyUiApi<T>(fn: () => T | Promise<T>): Promise<T>;

/** Yields to the main thread so long tasks can be broken up. */
export function splitLongTask(): Promise<void>;

/** Runs a non-urgent UI update after the next paint. */
export function performAsyncUiUpdate<T>(fn: () => T | Promise<T>): Promise<T>;

/** Reads a costly DOM value after the next paint to limit layout thrashing. */
export const readCostlyDomValue: typeof performAsyncUiUpdate;

/**
 * Iterates over items, yielding to the main thread whenever the time
 * limit (in milliseconds) is exceeded.
 */
export function splitLongIteration<T>(
  items: T[],
  fn: (item: T) => unknown,
  limit?: number,
): Promise<void>;

/** Removes a DOM element in a way that limits costly layout thrashing. */
export function removeDomNode(el: Element): Promise<void>;

/** Patches a data layer's push method to break up long tasks. */
export function patchDatalayer(dl: { push: (...args: unknown[]) => unknown }): void;

/**
 * Patches window/document event listeners added by external libraries (or
 * 1st-party code matching the pattern) to break up long tasks.
 */
export function patchEventListeners(types?: string[], pattern?: RegExp): void;

/** Debounces a UI update via requestAnimationFrame. */
export function debounceUiUpdate<A extends unknown[], T>(
  fn: (...args: A) => T,
): (...args: A) => Promise<T>;

/** Loads a CSS file without blocking rendering. */
export function loadDeferredCSS(href: string): Promise<void>;

/** Prefetches resources to improve LCP. */
export function prefetchResources(urls: string[]): Promise<unknown>;
