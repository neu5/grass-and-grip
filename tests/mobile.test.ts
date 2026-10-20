import { describe, expect, it } from 'vitest';
import { mergeInputs } from '../src/client/input';
import {
  STEER_DEADZONE,
  STEER_GAIN,
  cameraHudHint,
  isLandscapeView,
  isMobileLike,
  isPortraitView,
  mapPointersToControls,
  mapSteerAxis,
  overlayInsets,
  pointInRect,
  readBrowserMobileFlags,
  shouldBlockPortrait,
  shouldShowRotateHint,
  type TouchLayout,
} from '../src/client/touchMap';

const layout: TouchLayout = {
  steer: { left: 620, top: 250, right: 820, bottom: 336 },
  forward: { left: 80, top: 180, right: 176, bottom: 244 },
  reverse: { left: 80, top: 252, right: 176, bottom: 316 },
  brake: { left: 80, top: 324, right: 176, bottom: 380 },
  camera: { left: 80, top: 122, right: 126, bottom: 168 },
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
  const pad = { left: 0, top: 0, right: 200, bottom: 86 };

  it('is idle at the center and inside the deadzone', () => {
    expect(mapSteerAxis(100, pad)).toBe(0);
    expect(mapSteerAxis(100 + STEER_DEADZONE * 100 - 1, pad)).toBe(0);
  });

  it('maps far left/right to capped steer and ignores vertical pad size', () => {
    expect(mapSteerAxis(200, pad)).toBeCloseTo(STEER_GAIN);
    expect(mapSteerAxis(0, pad)).toBeCloseTo(-STEER_GAIN);
  });
});

describe('mapPointersToControls', () => {
  it('maps a right-thumb stick to steer only, with no auto-gas', () => {
    const idle = mapPointersToControls([], layout);
    expect(idle.throttle).toBe(0);
    expect(idle.steer).toBe(0);

    const right = mapPointersToControls([{ x: 820, y: 293 }], layout);
    expect(right.steer).toBeCloseTo(STEER_GAIN);
    expect(right.throttle).toBe(0);
    expect(right.handbrake).toBe(false);

    const topOfStick = mapPointersToControls([{ x: 720, y: 250 }], layout);
    expect(topOfStick.throttle).toBe(0);
    expect(topOfStick.steer).toBeCloseTo(0);

    const bottomOfStick = mapPointersToControls([{ x: 720, y: 336 }], layout);
    expect(bottomOfStick.throttle).toBe(0);
  });

  it('holds FWD for throttle and REV for reverse; both cancel', () => {
    const fwd = mapPointersToControls([{ x: 120, y: 215 }], layout);
    expect(fwd.throttle).toBe(1);
    expect(fwd.steer).toBe(0);
    expect(fwd.handbrake).toBe(false);

    const rev = mapPointersToControls([{ x: 120, y: 284 }], layout);
    expect(rev.throttle).toBe(-1);
    expect(rev.steer).toBe(0);
    expect(rev.handbrake).toBe(false);

    const both = mapPointersToControls(
      [
        { x: 120, y: 215 },
        { x: 120, y: 284 },
      ],
      layout,
    );
    expect(both.throttle).toBe(0);
  });

  it('maps BRAKE to handbrake (same as Shift) without adding gas', () => {
    const r = mapPointersToControls([{ x: 120, y: 350 }], layout);
    expect(r.handbrake).toBe(true);
    expect(r.throttle).toBe(0);
    expect(r.steer).toBe(0);
    expect(r.camera).toBe(false);
  });

  it('maps CAM to camera (same as C) without adding gas', () => {
    const r = mapPointersToControls([{ x: 100, y: 145 }], layout);
    expect(r.camera).toBe(true);
    expect(r.handbrake).toBe(false);
    expect(r.throttle).toBe(0);
  });

  it('can reverse and hold brake at once from two pointers', () => {
    const r = mapPointersToControls(
      [
        { x: 120, y: 284 },
        { x: 120, y: 350 },
      ],
      layout,
    );
    expect(r.throttle).toBe(-1);
    expect(r.handbrake).toBe(true);
    expect(r.camera).toBe(false);
  });

  it('can steer and hold reverse at once from two pointers', () => {
    const r = mapPointersToControls(
      [
        { x: 820, y: 293 },
        { x: 120, y: 284 },
      ],
      layout,
    );
    expect(r.throttle).toBe(-1);
    expect(r.steer).toBeCloseTo(STEER_GAIN);
    expect(r.handbrake).toBe(false);
    expect(r.camera).toBe(false);
  });

  it('keeps a captured stick from becoming a button when dragged left', () => {
    const dragged = { x: 100, y: 145 };
    const r = mapPointersToControls([], layout, { capturedSteer: dragged });
    expect(r.camera).toBe(false);
    expect(r.handbrake).toBe(false);
    expect(r.throttle).toBe(0);
    expect(r.steer).toBeLessThan(0);
  });

  it('idles when a pointer misses every control (no auto-gas)', () => {
    expect(mapPointersToControls([{ x: 400, y: 40 }], layout)).toEqual({
      throttle: 0,
      steer: 0,
      handbrake: false,
      camera: false,
    });
  });
});

describe('layout helpers', () => {
  it('pointInRect matches inclusive edges', () => {
    expect(pointInRect({ x: 80, y: 122 }, layout.camera)).toBe(true);
    expect(pointInRect({ x: 79, y: 122 }, layout.camera)).toBe(false);
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

  it('pushes overlay inward from visual viewport + fat side chrome', () => {
    const wide = overlayInsets({ offsetLeft: 0, offsetTop: 0, width: 844, height: 390 }, { width: 844, height: 390 });
    expect(wide.left).toBeGreaterThanOrEqual(120);
    expect(wide.right).toBeGreaterThanOrEqual(100);
    expect(wide.right).toBeLessThan(140);

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
