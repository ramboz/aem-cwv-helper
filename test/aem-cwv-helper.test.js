import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  prioritizeImages,
  yieldUnlessUrgent,
  runWhenIdle,
  runBeforePaint,
  yieldToMain,
  runAfterPaint,
  readAfterPaint,
  callCostlyApi,
  callCostlyUiApi,
  splitLongTask,
  performAsyncUiUpdate,
  readCostlyDomValue,
  splitLongIteration,
  removeDomNode,
  patchDatalayer,
  patchEventListeners,
  debounceUiUpdate,
  loadDeferredCSS,
  prefetchResources,
} from '../aem-cwv-helper.js';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('prioritizeImages', () => {
  it('sets eager loading and high fetch priority on matching images', () => {
    document.body.innerHTML = `
      <img class="hero" src="a.jpg">
      <img class="hero" src="b.jpg">
      <img class="other" src="c.jpg">
    `;
    prioritizeImages('.hero');
    const heroes = document.querySelectorAll('.hero');
    heroes.forEach((img) => {
      expect(img.getAttribute('loading')).toBe('eager');
      expect(img.getAttribute('fetchpriority')).toBe('high');
    });
    const other = document.querySelector('.other');
    expect(other.getAttribute('loading')).toBeNull();
    expect(other.getAttribute('fetchpriority')).toBeNull();
  });
});

describe('yieldUnlessUrgent / yieldToMain', () => {
  it('resolves', async () => {
    await expect(yieldUnlessUrgent()).resolves.toBeUndefined();
    await expect(yieldToMain()).resolves.toBeUndefined();
  });
});

describe('runWhenIdle', () => {
  it('resolves with the function result', async () => {
    await expect(runWhenIdle(() => 42)).resolves.toBe(42);
  });

  it('unwraps promise results', async () => {
    await expect(runWhenIdle(async () => 'done')).resolves.toBe('done');
  });
});

describe('runBeforePaint', () => {
  it('resolves with the function result on the next frame', async () => {
    await expect(runBeforePaint(() => 'painted')).resolves.toBe('painted');
  });
});

describe('runAfterPaint / readAfterPaint', () => {
  it('resolves with the function result after the next paint', async () => {
    await expect(runAfterPaint(() => 'updated')).resolves.toBe('updated');
  });

  it('readAfterPaint returns the read value', async () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el');
    await expect(readAfterPaint(() => el.tagName)).resolves.toBe('DIV');
  });
});

describe('deprecated aliases', () => {
  it('still point to the canonical implementations', () => {
    expect(callCostlyApi).toBe(runWhenIdle);
    expect(callCostlyUiApi).toBe(runBeforePaint);
    expect(splitLongTask).toBe(yieldToMain);
    expect(performAsyncUiUpdate).toBe(runAfterPaint);
    expect(readCostlyDomValue).toBe(readAfterPaint);
  });
});

describe('splitLongIteration', () => {
  it('applies the function to every item in order', async () => {
    const items = [...Array(100).keys()];
    const seen = [];
    await splitLongIteration(items, (item) => seen.push(item));
    expect(seen).toEqual(items);
  });

  it('yields when the deadline is crossed', async () => {
    const items = [...Array(10).keys()];
    const seen = [];
    // A 0ms limit forces a yield between every item
    await splitLongIteration(items, (item) => seen.push(item), 0);
    expect(seen).toEqual(items);
  });
});

describe('removeDomNode', () => {
  it('hides then removes the element', async () => {
    document.body.innerHTML = '<div id="stale"></div>';
    const el = document.getElementById('stale');
    const promise = removeDomNode(el);
    expect(el.style.display).toBe('none');
    await promise;
    expect(document.getElementById('stale')).toBeNull();
  });
});

describe('patchDatalayer', () => {
  it('works on a plain array data layer (pre-tag-manager)', async () => {
    const dl = [];
    patchDatalayer(dl);
    dl.push({ event: 'one' });
    dl.push({ event: 'two' });
    expect(dl.length).toBe(0); // deferred, not yet flushed
    await vi.waitFor(() => {
      expect(dl.map((e) => e.event)).toEqual(['one', 'two']);
    });
  });

  it('defers to a custom push implementation (tag manager loaded)', async () => {
    const events = [];
    const dl = { push: (...args) => events.push(...args) };
    patchDatalayer(dl);
    dl.push({ event: 'custom' });
    await vi.waitFor(() => {
      expect(events).toEqual([{ event: 'custom' }]);
    });
  });
});

describe('debounceUiUpdate', () => {
  it('only executes the last call in a burst', async () => {
    const fn = vi.fn((v) => v);
    const debounced = debounceUiUpdate(fn);
    debounced(1);
    debounced(2);
    const result = await debounced(3);
    expect(result).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('settles superseded promises with the executed call result', async () => {
    const debounced = debounceUiUpdate((v) => v);
    const first = debounced('a');
    const second = debounced('b');
    await expect(first).resolves.toBe('b');
    await expect(second).resolves.toBe('b');
  });
});

describe('loadDeferredCSS', () => {
  it('appends a print-media stylesheet and switches to all once loaded', async () => {
    const promise = loadDeferredCSS('/styles/lazy.css');
    const link = await vi.waitFor(() => {
      const el = document.head.querySelector('link[rel="stylesheet"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(link.media).toBe('print');
    link.dispatchEvent(new Event('load'));
    await promise;
    expect(link.media).toBe('all');
  });
});

describe('prefetchResources', () => {
  it('creates one prefetch link per url and resolves once all loaded', async () => {
    const urls = ['/a.jpg', '/b.woff2', '/c.js'];
    const promise = prefetchResources(urls);
    const links = await vi.waitFor(() => {
      const els = [...document.head.querySelectorAll('link[rel="prefetch"]')];
      expect(els).toHaveLength(urls.length);
      return els;
    });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(urls);
    links.forEach((link) => link.dispatchEvent(new Event('load')));
    await expect(promise).resolves.toBeDefined();
  });
});

describe('patchDatalayer (hardening)', () => {
  it('flushes deferred pushes in FIFO order', async () => {
    const dl = [];
    patchDatalayer(dl);
    for (let i = 0; i < 5; i += 1) {
      dl.push({ event: `e${i}` });
    }
    await vi.waitFor(() => {
      expect(dl.map((e) => e.event)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    });
  });

  it('survives a tag manager replacing push after patching', async () => {
    const dl = [];
    patchDatalayer(dl);
    // Simulate GTM loading and installing its own push
    const gtmEvents = [];
    dl.push = (...args) => gtmEvents.push(...args);
    dl.push({ event: 'after-gtm' });
    await vi.waitFor(() => {
      expect(gtmEvents).toEqual([{ event: 'after-gtm' }]);
    });
  });
});

// Keep this block last: patchEventListeners proxies window/document listeners
// for the rest of the environment's lifetime.
describe('patchEventListeners (hardening)', () => {
  it('defers unattributable-to-first-party listeners but still runs them', async () => {
    patchEventListeners(['click']);
    const calls = [];
    const listener = function listener(event) {
      calls.push({ type: event.type, self: this });
    };
    document.addEventListener('click', listener);
    document.dispatchEvent(new Event('click'));
    // Deferred: not called synchronously
    expect(calls).toHaveLength(0);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0].type).toBe('click');
    document.removeEventListener('click', listener);
  });

  it('removeEventListener removes a patched listener', async () => {
    const listener = vi.fn();
    document.addEventListener('click', listener);
    document.removeEventListener('click', listener);
    document.dispatchEvent(new Event('click'));
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(listener).not.toHaveBeenCalled();
  });

  it('leaves non-matching event types untouched (synchronous)', () => {
    const listener = vi.fn();
    document.addEventListener('keydown', listener);
    document.dispatchEvent(new Event('keydown'));
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', listener);
  });

  it('warns when a deferred listener calls preventDefault too late', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listener = (event) => event.preventDefault();
    document.addEventListener('click', listener);
    document.dispatchEvent(new Event('click', { cancelable: true }));
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('preventDefault'));
    });
    document.removeEventListener('click', listener);
    warn.mockRestore();
  });
});
