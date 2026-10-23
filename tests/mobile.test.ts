import { describe, expect, it } from 'vitest';
import { mergeInputs } from '../src/client/input';
import {
  STEER_DEAD_PX,
  STEER_FULL_PX,
  cameraHudHint,
  isLandscapeView,
  isMobileLike,
  isPortraitView,
  mapPedals,
  overlayInsets,
  pointInRect,
  readBrowserMobileFlags,
  shouldBlockPortrait,
  shouldShowRotateHint,
  steerFromDrag,
  type PedalLayout,
} from '../src/client/touchMap';

// A landscape phone: pedals bottom right.
const pedals: PedalLayout = {
  gas: { left: 700, top: 240, right: 812, bottom: 372 },
  brake: { left: 592, top: 268, right: 688, bottom: 372 },
  handbrake: { left: 592, top: 178, right: 812, bottom: 230 },
};

describe('isMobileLike', () => {
  it('is true when the pointer is coarse', () => {
    expect(isMobileLike({ pointerCoarse: true, maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (X11)' })).toBe(true);
  });

  it('is true for a phone UA that also reports touch', () => {
    expect(
      isMobileLike({
        pointerCoarse: false,
        maxTouchPoints: 5,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }),
    ).toBe(true);
  });

  it('is false on desktop Chrome (fine pointer, no mobile UA)', () => {
    expect(
      isMobileLike({
        pointerCoarse: false,
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
      }),
    ).toBe(false);
  });

  it('is false for a desktop trackpad (touch points, Macintosh UA, fine pointer)', () => {
    expect(
      isMobileLike({
        pointerCoarse: false,
        maxTouchPoints: 1,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
      }),
    ).toBe(false);
  });

  it('honors a force flag', () => {
    expect(isMobileLike({ force: true, pointerCoarse: false, maxTouchPoints: 0, userAgent: 'Mozilla' })).toBe(true);
  });
});

describe('readBrowserMobileFlags', () => {
  it('reads coarse pointer, UA, touch points, and ?mobile=1', () => {
    expect(
      readBrowserMobileFlags({
        matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
        navigator: { userAgent: 'iPhone', maxTouchPoints: 5 },
        location: { search: '?mobile=1' },
      }),
    ).toEqual({ force: true, pointerCoarse: true, maxTouchPoints: 5, userAgent: 'iPhone' });
  });

  it('does not force when mobile=0', () => {
    expect(readBrowserMobileFlags({ location: { search: '?mobile=0' } }).force).toBe(false);
  });
});

describe('steering stick', () => {
  it('drives straight while the thumb rests where it landed', () => {
    expect(steerFromDrag(0)).toBe(0);
    expect(steerFromDrag(STEER_DEAD_PX)).toBe(0);
    expect(steerFromDrag(-STEER_DEAD_PX)).toBe(0);
  });

  it('reaches full lock with a short slide, both ways', () => {
    expect(steerFromDrag(STEER_FULL_PX)).toBe(1);
    expect(steerFromDrag(-STEER_FULL_PX)).toBe(-1);
    expect(steerFromDrag(400)).toBe(1);
  });

  it('is linear in between, so half a slide is about half lock', () => {
    const half = steerFromDrag((STEER_FULL_PX + STEER_DEAD_PX) / 2);
    expect(half).toBeCloseTo(0.5, 2);
    expect(steerFromDrag(30)).toBeGreaterThan(steerFromDrag(20));
  });
});

describe('pedals', () => {
  it('idles with no thumbs (no auto-gas)', () => {
    expect(mapPedals([], pedals)).toEqual({ throttle: 0, handbrake: false });
  });

  it('GAS drives, BRAKE brakes then reverses, HANDBRAKE is separate', () => {
    expect(mapPedals([{ x: 750, y: 300 }], pedals)).toEqual({ throttle: 1, handbrake: false });
    expect(mapPedals([{ x: 640, y: 320 }], pedals)).toEqual({ throttle: -1, handbrake: false });
    expect(mapPedals([{ x: 700, y: 200 }], pedals)).toEqual({ throttle: 0, handbrake: true });
  });

  it('lets brake win over gas, and handbrake ride along with gas', () => {
    expect(mapPedals([{ x: 750, y: 300 }, { x: 640, y: 320 }], pedals).throttle).toBe(-1);
    expect(mapPedals([{ x: 750, y: 300 }, { x: 700, y: 200 }], pedals)).toEqual({ throttle: 1, handbrake: true });
  });

  it('follows a thumb sliding from GAS onto BRAKE', () => {
    expect(mapPedals([{ x: 705, y: 320 }], pedals).throttle).toBe(1);
    expect(mapPedals([{ x: 680, y: 320 }], pedals).throttle).toBe(-1);
  });

  it('ignores a thumb off every pedal', () => {
    expect(mapPedals([{ x: 400, y: 40 }], pedals)).toEqual({ throttle: 0, handbrake: false });
  });
});

describe('layout helpers', () => {
  it('pointInRect matches inclusive edges', () => {
    expect(pointInRect({ x: 700, y: 240 }, pedals.gas)).toBe(true);
    expect(pointInRect({ x: 699, y: 240 }, pedals.gas)).toBe(false);
  });

  it('detects portrait vs landscape, trusting orientation.type when present', () => {
    expect(isPortraitView(390, 844)).toBe(true);
    expect(isPortraitView(844, 390)).toBe(false);
    expect(isLandscapeView(844, 390)).toBe(true);
    expect(isPortraitView(390, 844, 'landscape-primary')).toBe(false);
    expect(isPortraitView(844, 390, 'portrait-primary')).toBe(true);
  });

  it('blocks play until the viewport is actually landscape', () => {
    expect(shouldBlockPortrait(true, true, false)).toBe(true);
    expect(shouldBlockPortrait(true, true, true)).toBe(false);
    expect(shouldBlockPortrait(true, false, false)).toBe(false);
    expect(shouldBlockPortrait(false, true, false)).toBe(false);
  });

  it('shows a blocking rotate gate only while racing in portrait', () => {
    expect(shouldShowRotateHint(true, true, false)).toBe(true);
    expect(shouldShowRotateHint(true, true, true)).toBe(false);
    expect(shouldShowRotateHint(true, false, false)).toBe(false);
  });

  it('keeps the controls near the corners, inside the visible viewport', () => {
    const wide = overlayInsets({ offsetLeft: 0, offsetTop: 0, width: 844, height: 390 }, { width: 844, height: 390 });
    expect(wide.left).toBeGreaterThanOrEqual(24);
    expect(wide.left).toBeLessThan(60);
    expect(wide.right).toBeGreaterThanOrEqual(24);
    expect(wide.right).toBeLessThan(60);

    const insta = overlayInsets(
      { offsetLeft: 40, offsetTop: 0, width: 760, height: 390 },
      { width: 844, height: 390 },
    );
    expect(insta.left).toBeGreaterThan(wide.left);
    expect(insta.right).toBeGreaterThan(wide.right);
  });

  it('hides the C-key camera hint on touch', () => {
    expect(cameraHudHint('Follow', true)).toBe('Camera: Follow (C to switch)');
    expect(cameraHudHint('Overview', false)).toBe('Camera: Overview');
  });

  it('merges keyboard and touch so desktop keys still work', () => {
    const merged = mergeInputs({ throttle: 1, steer: 0, handbrake: false }, { throttle: 0, steer: -0.4, handbrake: true });
    expect(merged.handbrake).toBe(true);
    expect(merged.steer).toBeCloseTo(-0.4);
  });
});
