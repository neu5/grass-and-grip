import { describe, expect, it } from 'vitest';
import { mergeInputs } from '../src/client/input';
import {
  STEER_GAIN,
  cameraHudHint,
  isMobileLike,
  isPortraitView,
  mapPointersToControls,
  mapSteerAxis,
  overlayInsets,
  pointInRect,
  readBrowserMobileFlags,
  shouldForceCssLandscape,
  shouldShowRotateHint,
  deviceIsLandscape,
  type TouchLayout,
} from '../src/client/touchMap';

const layout: TouchLayout = {
  steer: { left: 620, top: 250, right: 820, bottom: 340 },
  brake: { left: 80, top: 250, right: 160, bottom: 330 },
  camera: { left: 80, top: 140, right: 160, bottom: 220 },
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

describe('mapSteerAxis', () => {
  const pad = { left: 0, top: 0, right: 200, bottom: 80 };

  it('is idle at the center and inside the deadzone', () => {
    expect(mapSteerAxis(100, pad)).toBe(0);
    expect(mapSteerAxis(120, pad)).toBe(0);
  });

  it('steers right/left only, with low sensitivity and a capped gain', () => {
    const right = mapSteerAxis(200, pad);
    const left = mapSteerAxis(0, pad);
    const midRight = mapSteerAxis(160, pad);
    expect(right).toBeCloseTo(STEER_GAIN);
    expect(left).toBeCloseTo(-STEER_GAIN);
    expect(Math.abs(midRight)).toBeLessThan(Math.abs(right));
    expect(Math.abs(midRight)).toBeLessThan(0.25);
  });

  it('ignores vertical motion (x only)', () => {
    expect(mapSteerAxis(100, { ...pad, top: 400, bottom: 500 })).toBe(0);
  });
});

describe('mapPointersToControls', () => {
  it('auto-throttles and maps a right-thumb steer', () => {
    const idle = mapPointersToControls([], layout);
    expect(idle.throttle).toBe(1);
    expect(idle.steer).toBe(0);

    const drive = mapPointersToControls([{ x: 820, y: 295 }], layout);
    expect(drive.steer).toBeCloseTo(STEER_GAIN);
    expect(drive.throttle).toBe(1);
    expect(drive.handbrake).toBe(false);
    expect(drive.camera).toBe(false);
  });

  it('maps BRAKE to handbrake (same as Shift) and cuts auto-throttle', () => {
    const r = mapPointersToControls([{ x: 120, y: 290 }], layout);
    expect(r.handbrake).toBe(true);
    expect(r.throttle).toBe(0);
    expect(r.steer).toBe(0);
    expect(r.camera).toBe(false);
  });

  it('maps CAM to camera (same as C)', () => {
    const r = mapPointersToControls([{ x: 120, y: 180 }], layout);
    expect(r.camera).toBe(true);
    expect(r.handbrake).toBe(false);
    expect(r.throttle).toBe(1);
  });

  it('can steer and hold brake at once from two pointers', () => {
    const r = mapPointersToControls(
      [
        { x: 820, y: 295 },
        { x: 120, y: 290 },
      ],
      layout,
    );
    expect(r.steer).toBeCloseTo(STEER_GAIN);
    expect(r.handbrake).toBe(true);
    expect(r.throttle).toBe(0);
    expect(r.camera).toBe(false);
  });

  it('keeps a captured steer from becoming a button when dragged left', () => {
    const dragged = { x: 120, y: 180 };
    const r = mapPointersToControls([], layout, { capturedSteer: dragged });
    expect(r.camera).toBe(false);
    expect(r.handbrake).toBe(false);
    expect(r.steer).toBeLessThan(0);
    expect(r.throttle).toBe(1);
  });

  it('still auto-throttles when a pointer misses every control, and snaps steer to 0', () => {
    expect(mapPointersToControls([{ x: 400, y: 40 }], layout)).toEqual({
      throttle: 1,
      steer: 0,
      handbrake: false,
      camera: false,
    });
  });
});

describe('layout helpers', () => {
  it('pointInRect matches inclusive edges', () => {
    expect(pointInRect({ x: 80, y: 140 }, layout.camera)).toBe(true);
    expect(pointInRect({ x: 79, y: 140 }, layout.camera)).toBe(false);
  });

  it('detects portrait vs landscape, trusting orientation.type when present', () => {
    expect(isPortraitView(390, 844)).toBe(true);
    expect(isPortraitView(844, 390)).toBe(false);
    expect(isPortraitView(390, 844, 'landscape-primary')).toBe(false);
    expect(isPortraitView(844, 390, 'portrait-primary')).toBe(true);
  });

  it('CSS-rotates only when the page is portrait but the device is already landscape', () => {
    expect(shouldForceCssLandscape({ mobile: true, viewPortrait: true, orientationLocked: false, deviceLandscape: true })).toBe(true);
    expect(shouldForceCssLandscape({ mobile: true, viewPortrait: true, orientationLocked: false, deviceLandscape: false })).toBe(false);
    expect(shouldForceCssLandscape({ mobile: true, viewPortrait: true, orientationLocked: true, deviceLandscape: true })).toBe(false);
    expect(shouldForceCssLandscape({ mobile: true, viewPortrait: false, orientationLocked: false, deviceLandscape: true })).toBe(false);
    expect(shouldForceCssLandscape({ mobile: false, viewPortrait: true, orientationLocked: false, deviceLandscape: true })).toBe(false);
  });

  it('reads device landscape from orientation type or window.orientation', () => {
    expect(deviceIsLandscape({ screen: { orientation: { type: 'landscape-primary' } } })).toBe(true);
    expect(deviceIsLandscape({ screen: { orientation: { type: 'portrait-primary' } } })).toBe(false);
    expect(deviceIsLandscape({ orientation: 90 })).toBe(true);
    expect(deviceIsLandscape({ orientation: 0, screen: { width: 390, height: 844 } })).toBe(false);
  });

  it('hides Rotate phone when already landscape or after CSS rotate', () => {
    expect(shouldShowRotateHint(true, false)).toBe(false);
    expect(shouldShowRotateHint(false, true)).toBe(false);
    expect(shouldShowRotateHint(true, true)).toBe(false);
    expect(shouldShowRotateHint(false, false)).toBe(true);
  });

  it('pushes overlay inward from visual viewport + browser chrome', () => {
    const wide = overlayInsets({ offsetLeft: 0, offsetTop: 0, width: 844, height: 390 }, { width: 844, height: 390 });
    expect(wide.left).toBeGreaterThanOrEqual(72);
    expect(wide.right).toBeGreaterThanOrEqual(72);

    const insta = overlayInsets(
      { offsetLeft: 40, offsetTop: 0, width: 760, height: 390 },
      { width: 844, height: 390 },
    );
    expect(insta.left).toBeGreaterThan(wide.left);
    expect(insta.right).toBeGreaterThan(wide.right);

    const portrait = overlayInsets({ offsetLeft: 0, offsetTop: 0, width: 390, height: 844 }, { width: 390, height: 844 });
    expect(portrait.left).toBeLessThan(wide.left);
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
