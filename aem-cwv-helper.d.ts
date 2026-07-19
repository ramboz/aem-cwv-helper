/**
 * Type declarations for aem-cwv-helper.
 */

/** Prioritizes the loading of critical images to reduce the LCP duration. */
export function prioritizeImages(selector: string): void;

/** Yields to the main thread unless the page is being hidden or unloaded. */
export function yieldUnlessUrgent(): Promise<void>;

/** Runs a costly, non-urgent function during browser idle time. */
export function runWhenIdle<T>(fn: () => T | Promise<T>): Promise<T>;

/** Runs a costly UI update on the next animation frame. */
export function runBeforePaint<T>(fn: () => T | Promise<T>): Promise<T>;

/** Yields to the main thread so long tasks can be broken up. */
export function yieldToMain(): Promise<void>;

/** Runs a non-urgent UI update after the next paint. */
export function runAfterPaint<T>(fn: () => T | Promise<T>): Promise<T>;

/** Reads a costly DOM value after the next paint to limit layout thrashing. */
export const readAfterPaint: typeof runAfterPaint;

/** @deprecated Use {@link runWhenIdle} instead. */
export const callCostlyApi: typeof runWhenIdle;

/** @deprecated Use {@link runBeforePaint} instead. */
export const callCostlyUiApi: typeof runBeforePaint;

/** @deprecated Use {@link yieldToMain} instead. */
export const splitLongTask: typeof yieldToMain;

/** @deprecated Use {@link runAfterPaint} instead. */
export const performAsyncUiUpdate: typeof runAfterPaint;

/** @deprecated Use {@link readAfterPaint} instead. */
export const readCostlyDomValue: typeof readAfterPaint;

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

/**
 * Reserves vertical space for async content so its arrival doesn't shift
 * elements below it. Warns when called after the container already painted.
 */
export function reserveSpace(selector: string, minHeight: number | string): void;

/**
 * Gives unsized media an aspect-ratio so the browser reserves their space
 * before they load. Returns the elements whose ratio couldn't be determined.
 */
export function stabilizeMedia(
  root?: Element | Document,
  options?: { defaultAspectRatio?: string },
): Element[];

/**
 * Reveals a hidden element by toggling a class that should animate only
 * compositor properties; warns when the reveal would shift siblings.
 */
export function revealWithoutShift(el: Element, revealClass?: string): Promise<void>;

/**
 * Runs a layout-shifting DOM update inside the post-input grace window where
 * shifts are excluded from CLS; falls back after the timeout.
 */
export function insertAfterInteraction<T>(
  fn: () => T | Promise<T>,
  options?: { timeout?: number },
): Promise<T>;

/** Runs a DOM update inside a View Transition when supported. */
export function updateWithViewTransition<T>(fn: () => T | Promise<T>): Promise<T>;

export interface LayoutShiftSource {
  node: Node | null;
  selector: string | null;
  previousRect: DOMRectReadOnly;
  currentRect: DOMRectReadOnly;
  resized: boolean;
}

/** Observes layout shifts, flagging the likely culprit element per shift. */
export function observeLayoutShifts(
  callback: (shift: {
    value: number;
    culprit: LayoutShiftSource | null;
    sources: LayoutShiftSource[];
    entry: PerformanceEntry;
  }) => void,
  options?: { includeRecentInput?: boolean },
): PerformanceObserver | null;

/** Observes Largest Contentful Paint candidates as the browser upgrades them. */
export function observeLcpCandidates(
  callback: (candidate: {
    element: Element | null;
    selector: string | null;
    url: string | null;
    size: number;
    startTime: number;
    entry: PerformanceEntry;
  }) => void,
): PerformanceObserver | null;

/** Observes slow interactions with an input/processing/presentation breakdown. */
export function observeSlowInteractions(
  callback: (interaction: {
    target: Node | null;
    selector: string | null;
    type: string;
    duration: number;
    inputDelay: number;
    processingTime: number;
    presentationDelay: number;
    entry: PerformanceEntry;
  }) => void,
  options?: { durationThreshold?: number },
): PerformanceObserver | null;
