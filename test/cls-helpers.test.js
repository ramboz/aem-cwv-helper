import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  reserveSpace,
  stabilizeMedia,
  revealWithoutShift,
  insertAfterInteraction,
  updateWithViewTransition,
  observeLayoutShifts,
  observeLcpCandidates,
  observeSlowInteractions,
} from '../aem-cwv-helper.js';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.PerformanceObserver;
  delete document.startViewTransition;
});

// Fake PerformanceObserver that lets tests feed entries manually
class FakePerformanceObserver {
  static supportedEntryTypes = ['layout-shift', 'largest-contentful-paint', 'event'];

  static instances = [];

  constructor(cb) {
    this.cb = cb;
    FakePerformanceObserver.instances.push(this);
  }

  observe(options) {
    this.options = options;
  }

  disconnect() {}

  emit(entries) {
    this.cb({ getEntries: () => entries }, this);
  }
}

function installFakeObserver() {
  FakePerformanceObserver.instances = [];
  window.PerformanceObserver = FakePerformanceObserver;
}

describe('reserveSpace', () => {
  it('sets min-height on all matching containers', () => {
    document.body.innerHTML = '<div class="slot"></div><div class="slot"></div>';
    reserveSpace('.slot', 90);
    document.querySelectorAll('.slot').forEach((el) => {
      expect(el.style.minHeight).toBe('90px');
    });
  });

  it('accepts CSS length strings', () => {
    document.body.innerHTML = '<div class="slot"></div>';
    reserveSpace('.slot', '20vh');
    expect(document.querySelector('.slot').style.minHeight).toBe('20vh');
  });

  it('warns when called after FCP on an already-rendered element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ startTime: 50 }]);
    document.body.innerHTML = '<div class="slot"></div>';
    const el = document.querySelector('.slot');
    el.getClientRects = () => [{ width: 100, height: 10 }]; // simulate painted element
    reserveSpace('.slot', 90);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('after first contentful paint'));
    expect(el.style.minHeight).toBe('90px'); // still applies
  });

  it('does not warn for still-hidden elements even after FCP', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ startTime: 50 }]);
    document.body.innerHTML = '<div class="slot"></div>';
    // jsdom getClientRects() returns [] — same as a display:none element
    reserveSpace('.slot', 90);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('stabilizeMedia', () => {
  it('derives aspect-ratio from width/height attributes', () => {
    document.body.innerHTML = '<img src="a.jpg" width="1600" height="900">';
    const unresolved = stabilizeMedia();
    expect(document.querySelector('img').style.getPropertyValue('aspect-ratio')).toBe('1600 / 900');
    expect(unresolved).toHaveLength(0);
  });

  it('uses data-aspect-ratio when no dimensions are present', () => {
    document.body.innerHTML = '<iframe src="embed.html" data-aspect-ratio="16 / 9"></iframe>';
    stabilizeMedia();
    expect(document.querySelector('iframe').style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
  });

  it('falls back to defaultAspectRatio and reports unresolved elements', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<video src="clip.mp4"></video><img src="unknown.jpg">';
    const unresolved = stabilizeMedia(document, { defaultAspectRatio: '4 / 3' });
    expect(document.querySelector('video').style.getPropertyValue('aspect-ratio')).toBe('4 / 3');
    expect(unresolved).toHaveLength(0);
    warn.mockRestore();

    document.body.innerHTML = '<img src="unknown.jpg">';
    const warn2 = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unresolved2 = stabilizeMedia();
    expect(unresolved2).toHaveLength(1);
    expect(warn2).toHaveBeenCalledWith(expect.stringContaining('could not determine'), unresolved2);
  });

  it('scopes the scan to the given root', () => {
    document.body.innerHTML = `
      <div class="hero"><img src="a.jpg" width="16" height="9"></div>
      <div class="other"><img src="b.jpg" width="1" height="1"></div>
    `;
    stabilizeMedia(document.querySelector('.hero'));
    expect(document.querySelector('.hero img').style.getPropertyValue('aspect-ratio')).toBe('16 / 9');
    expect(document.querySelector('.other img').style.getPropertyValue('aspect-ratio')).toBe('');
  });
});

describe('revealWithoutShift', () => {
  it('adds the reveal class on the next frame', async () => {
    document.body.innerHTML = '<div class="banner"></div>';
    const el = document.querySelector('.banner');
    await revealWithoutShift(el);
    expect(el.classList.contains('is-visible')).toBe(true);
  });

  it('supports a custom class name', async () => {
    document.body.innerHTML = '<div class="banner"></div>';
    const el = document.querySelector('.banner');
    await revealWithoutShift(el, 'open');
    expect(el.classList.contains('open')).toBe(true);
  });

  it('warns when the element is display:none in the normal flow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div class="banner" style="display: none"></div>';
    await revealWithoutShift(document.querySelector('.banner'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('display:none'));
  });

  it('does not warn for out-of-flow display:none elements', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div class="banner" style="display: none; position: fixed"></div>';
    await revealWithoutShift(document.querySelector('.banner'));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('insertAfterInteraction', () => {
  it('runs right away when a discrete input just happened', async () => {
    window.dispatchEvent(new Event('pointerdown'));
    const fn = vi.fn(() => 'inserted');
    await expect(insertAfterInteraction(fn)).resolves.toBe('inserted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for the next discrete input', async () => {
    // Get past the grace window of the previous test's input
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    const fn = vi.fn();
    const promise = insertAfterInteraction(fn, { timeout: 5000 });
    expect(fn).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('keydown'));
    await promise;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the timeout when the user never interacts', async () => {
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    const fn = vi.fn(() => 42);
    await expect(insertAfterInteraction(fn, { timeout: 50 })).resolves.toBe(42);
  });
});

describe('updateWithViewTransition', () => {
  it('falls back to the next frame when View Transitions are unsupported', async () => {
    await expect(updateWithViewTransition(() => 'updated')).resolves.toBe('updated');
  });

  it('uses document.startViewTransition when available', async () => {
    const startViewTransition = vi.fn((cb) => {
      cb();
      return { finished: Promise.resolve() };
    });
    document.startViewTransition = startViewTransition;
    await expect(updateWithViewTransition(() => 'transitioned')).resolves.toBe('transitioned');
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });
});

describe('observeLayoutShifts', () => {
  it('returns null when PerformanceObserver is unsupported', () => {
    expect(observeLayoutShifts(() => {})).toBeNull();
  });

  it('flags the resized source as culprit over a bigger moved-only source', () => {
    installFakeObserver();
    document.body.innerHTML = '<div id="pushed"></div><div id="grower"></div>';
    const pushed = document.getElementById('pushed');
    const grower = document.getElementById('grower');
    const shifts = [];
    const observer = observeLayoutShifts((shift) => shifts.push(shift));
    expect(observer).toBeInstanceOf(FakePerformanceObserver);
    FakePerformanceObserver.instances[0].emit([{
      value: 0.12,
      hadRecentInput: false,
      sources: [
        { // big element that only moved: the victim/amplifier
          node: pushed,
          previousRect: { width: 800, height: 600, y: 100 },
          currentRect: { width: 800, height: 600, y: 400 },
        },
        { // element that grew: the actual cause
          node: grower,
          previousRect: { width: 800, height: 0, y: 100 },
          currentRect: { width: 800, height: 300, y: 100 },
        },
      ],
    }]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].value).toBe(0.12);
    expect(shifts[0].culprit.node).toBe(grower);
    expect(shifts[0].culprit.selector).toBe('#grower');
    expect(shifts[0].sources).toHaveLength(2);
  });

  it('filters out input-excluded shifts by default', () => {
    installFakeObserver();
    const shifts = [];
    observeLayoutShifts((shift) => shifts.push(shift));
    FakePerformanceObserver.instances[0].emit([{ value: 0.2, hadRecentInput: true, sources: [] }]);
    expect(shifts).toHaveLength(0);
  });
});

describe('observeLcpCandidates', () => {
  it('reports element, selector, url and timing per candidate', () => {
    installFakeObserver();
    document.body.innerHTML = '<img id="hero" src="hero.jpg">';
    const candidates = [];
    observeLcpCandidates((candidate) => candidates.push(candidate));
    FakePerformanceObserver.instances[0].emit([{
      element: document.getElementById('hero'),
      url: 'https://example.com/hero.jpg',
      size: 240000,
      startTime: 1234,
    }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].selector).toBe('#hero');
    expect(candidates[0].url).toBe('https://example.com/hero.jpg');
    expect(candidates[0].startTime).toBe(1234);
  });
});

describe('observeSlowInteractions', () => {
  it('reports the input/processing/presentation breakdown', () => {
    installFakeObserver();
    document.body.innerHTML = '<button id="cta"></button>';
    const interactions = [];
    observeSlowInteractions((interaction) => interactions.push(interaction), { durationThreshold: 100 });
    expect(FakePerformanceObserver.instances[0].options.durationThreshold).toBe(100);
    FakePerformanceObserver.instances[0].emit([{
      interactionId: 7,
      name: 'click',
      target: document.getElementById('cta'),
      startTime: 100,
      processingStart: 150,
      processingEnd: 250,
      duration: 300,
    }]);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].selector).toBe('#cta');
    expect(interactions[0].inputDelay).toBe(50);
    expect(interactions[0].processingTime).toBe(100);
    expect(interactions[0].presentationDelay).toBe(150);
  });

  it('skips entries without an interactionId', () => {
    installFakeObserver();
    const interactions = [];
    observeSlowInteractions((interaction) => interactions.push(interaction));
    FakePerformanceObserver.instances[0].emit([{ interactionId: 0, name: 'keydown' }]);
    expect(interactions).toHaveLength(0);
  });
});
