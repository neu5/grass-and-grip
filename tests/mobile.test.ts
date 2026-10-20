import { describe, expect, it } from 'vitest';
import { mergeInputs } from '../src/client/input';
import {
  cameraHudHint,
  isMobileLike,
  mapPointersToControls,
  mapStickToDrive,
  pointInRect,
  readBrowserMobileFlags,
  shouldForceCssLandscape,
  type TouchLayout,
} from '../src/client/touchMap';

const layout: TouchLayout = {
  stick: { cx: 700, cy: 280, radius: 80 },
  brake: { left: 20, top: 250, right: 100, bottom: 330 },
  camera: { left: 20, top: 140, right: 100, bottom: 220 },
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

describe('mapStickToDrive', () => {
  const stick = { cx: 100, cy: 100, radius: 50 };

  it('is idle at the center and inside the deadzone', () => {
    expect(mapStickToDrive({ x: 100, y: 100 }, stick)).toEqual({ throttle: 0, steer: 0 });
    expect(mapStickToDrive({ x: 104, y: 101 }, stick)).toEqual({ throttle: 0, steer: 0 });
  });

  it('maps right to steer +1 and left to steer -1', () => {
    expect(mapStickToDrive({ x: 150, y: 100 }, stick).steer).toBeCloseTo(1);
    expect(mapStickToDrive({ x: 150, y: 100 }, stick).throttle).toBeCloseTo(0);
    expect(mapStickToDrive({ x: 50, y: 100 }, stick).steer).toBeCloseTo(-1);
  });

  it('maps up to throttle +1 and down to throttle -1', () => {
    expect(mapStickToDrive({ x: 100, y: 50 }, stick).throttle).toBeCloseTo(1);
    expect(mapStickToDrive({ x: 100, y: 50 }, stick).steer).toBeCloseTo(0);
    expect(mapStickToDrive({ x: 100, y: 150 }, stick).throttle).toBeCloseTo(-1);
  });

  it('clamps pointers past the rim to the unit circle', () => {
    const far = mapStickToDrive({ x: 400, y: 100 }, stick);
    expect(far.steer).toBeCloseTo(1);
    expect(far.throttle).toBeCloseTo(0);
  });
});

describe('mapPointersToControls', () => {
  it('maps a stick pointer to steer and throttle', () => {
    const drive = mapPointersToControls([{ x: 780, y: 280 }], layout);
    expect(drive.steer).toBeCloseTo(1);
    expect(drive.throttle).toBeCloseTo(0);
    expect(drive.handbrake).toBe(false);
    expect(drive.camera).toBe(false);

    const gas = mapPointersToControls([{ x: 700, y: 200 }], layout);
    expect(gas.throttle).toBeCloseTo(1);
  });

  it('maps a pointer on BRAKE to handbrake (same as Shift/Space)', () => {
    const r = mapPointersToControls([{ x: 60, y: 290 }], layout);
    expect(r.handbrake).toBe(true);
    expect(r.throttle).toBe(0);
    expect(r.steer).toBe(0);
    expect(r.camera).toBe(false);
  });

  it('maps a pointer on CAM to camera (same as C)', () => {
    const r = mapPointersToControls([{ x: 60, y: 180 }], layout);
    expect(r.camera).toBe(true);
    expect(r.handbrake).toBe(false);
  });

  it('can steer and hold brake at once from two pointers', () => {
    const r = mapPointersToControls(
      [
        { x: 780, y: 280 },
        { x: 60, y: 290 },
      ],
      layout,
    );
    expect(r.steer).toBeCloseTo(1);
    expect(r.handbrake).toBe(true);
    expect(r.camera).toBe(false);
  });

  it('keeps a captured stick from becoming a button when dragged left', () => {
    const dragged = { x: 60, y: 180 };
    const r = mapPointersToControls([], layout, { capturedStick: dragged });
    expect(r.camera).toBe(false);
    expect(r.handbrake).toBe(false);
    expect(r.steer).toBeLessThan(0);
  });

  it('ignores pointers that miss every control', () => {
    expect(mapPointersToControls([{ x: 400, y: 40 }], layout)).toEqual({
      throttle: 0,
      steer: 0,
      handbrake: false,
      camera: false,
    });
  });
});

describe('helpers', () => {
  it('pointInRect matches inclusive edges', () => {
    expect(pointInRect({ x: 20, y: 140 }, layout.camera)).toBe(true);
    expect(pointInRect({ x: 19, y: 140 }, layout.camera)).toBe(false);
  });

  it('forces a CSS landscape fallback when lock is blocked in portrait', () => {
    expect(shouldForceCssLandscape(true, true, false)).toBe(true);
    expect(shouldForceCssLandscape(true, true, true)).toBe(false);
    expect(shouldForceCssLandscape(true, false, false)).toBe(false);
    expect(shouldForceCssLandscape(false, true, false)).toBe(false);
  });

  it('hides the C-key camera hint on touch', () => {
    expect(cameraHudHint('Follow', true)).toBe('Camera: Follow (C to switch)');
    expect(cameraHudHint('Overview', false)).toBe('Camera: Overview');
  });

  it('merges keyboard and stick so desktop keys still win alongside touch', () => {
    const merged = mergeInputs({ throttle: 1, steer: 0, handbrake: false }, { throttle: 0, steer: -1, handbrake: true });
    expect(merged).toEqual({ throttle: 1, steer: -1, handbrake: true });
  });
});
