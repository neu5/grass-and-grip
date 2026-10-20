const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;

export const STEER_DEADZONE = 0.3;
export const STEER_GAIN = 0.6;
export const STEER_EXPO = 2;

export interface MobileFlags {
  pointerCoarse?: boolean;
  maxTouchPoints?: number;
  userAgent?: string;
  /** `?mobile=1` (or any value other than `0`) forces the overlay on. */
  force?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SteerPad {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TouchLayout {
  steer: SteerPad;
  forward: Rect;
  reverse: Rect;
  brake: Rect;
  camera: Rect;
}

export interface MappedControls {
  throttle: number;
  steer: number;
  handbrake: boolean;
  camera: boolean;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Coarse pointer, or a mobile UA that also reports touch — not a desktop trackpad. */
export function isMobileLike(flags: MobileFlags): boolean {
  if (flags.force) return true;
  if (flags.pointerCoarse) return true;
  const touch = (flags.maxTouchPoints ?? 0) > 0;
  return touch && MOBILE_UA.test(flags.userAgent ?? '');
}

export function readBrowserMobileFlags(win: {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { userAgent?: string; maxTouchPoints?: number };
  location?: { search?: string };
}): MobileFlags {
  const params = new URLSearchParams(win.location?.search ?? '');
  const mobileParam = params.get('mobile');
  return {
    force: mobileParam !== null && mobileParam !== '0',
    pointerCoarse: win.matchMedia?.('(pointer: coarse)').matches ?? false,
    maxTouchPoints: win.navigator?.maxTouchPoints ?? 0,
    userAgent: win.navigator?.userAgent ?? '',
  };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export function steerCenter(pad: SteerPad): { cx: number; halfW: number } {
  return { cx: (pad.left + pad.right) / 2, halfW: Math.max(1, (pad.right - pad.left) / 2) };
}

/**
 * Horizontal-only steer. Big deadzone + expo. Screen right is steer +1.
 * Vertical motion is ignored (gas lives on FWD/REV buttons).
 */
export function mapSteerAxis(
  x: number,
  pad: SteerPad,
  deadzone = STEER_DEADZONE,
  gain = STEER_GAIN,
  expo = STEER_EXPO,
): number {
  const { cx, halfW } = steerCenter(pad);
  const n = clamp((x - cx) / halfW, -1, 1);
  const a = Math.abs(n);
  if (a < deadzone) return 0;
  const t = (a - deadzone) / (1 - deadzone);
  return Math.sign(n) * gain * t ** expo;
}

export interface MapPointersOpts {
  deadzone?: number;
  /** Steer pointer after capture — mapped even outside the pad, never treated as a button. */
  capturedSteer?: Point | null;
}

/**
 * Right stick = steer only. Left FWD/REV hold throttle. BRAKE is handbrake. No auto-gas.
 */
export function mapPointersToControls(pointers: Point[], layout: TouchLayout, opts: MapPointersOpts = {}): MappedControls {
  let steer = 0;
  let forward = false;
  let reverse = false;
  let handbrake = false;
  let camera = false;
  let stickUsed = false;

  if (opts.capturedSteer) {
    steer = mapSteerAxis(opts.capturedSteer.x, layout.steer, opts.deadzone);
    stickUsed = true;
  }

  for (const p of pointers) {
    if (opts.capturedSteer && p.x === opts.capturedSteer.x && p.y === opts.capturedSteer.y) continue;
    if (pointInRect(p, layout.camera)) {
      camera = true;
      continue;
    }
    if (pointInRect(p, layout.forward)) {
      forward = true;
      continue;
    }
    if (pointInRect(p, layout.reverse)) {
      reverse = true;
      continue;
    }
    if (pointInRect(p, layout.brake)) {
      handbrake = true;
      continue;
    }
    if (!stickUsed && pointInRect(p, layout.steer)) {
      steer = mapSteerAxis(p.x, layout.steer, opts.deadzone);
      stickUsed = true;
    }
  }

  const throttle = reverse && !forward ? -1 : forward && !reverse ? 1 : 0;
  return { throttle, steer, handbrake, camera };
}

export function isPortraitView(width: number, height: number, orientationType?: string): boolean {
  if (orientationType?.startsWith('landscape')) return false;
  if (orientationType?.startsWith('portrait')) return true;
  return height > width;
}

export function isLandscapeView(width: number, height: number, orientationType?: string): boolean {
  return !isPortraitView(width, height, orientationType);
}

/** Portrait is not playable — block until the viewport is actually landscape. */
export function shouldBlockPortrait(mobile: boolean, racing: boolean, landscape: boolean): boolean {
  return mobile && racing && !landscape;
}

export function shouldShowRotateHint(mobile: boolean, racing: boolean, landscape: boolean): boolean {
  return shouldBlockPortrait(mobile, racing, landscape);
}

export interface OverlayInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Keep CAM / FWD / REV / BRAKE / steer inside the visible game area, clear of notches
 * and in-app browser chrome (Instagram side bars, address bars).
 * Right inset is a bit smaller than left so the steer pad sits slightly righter.
 */
export function overlayInsets(
  view: { offsetLeft: number; offsetTop: number; width: number; height: number },
  inner: { width: number; height: number },
  safe: { left?: number; right?: number; top?: number; bottom?: number } = {},
): OverlayInsets {
  const landscape = view.width >= view.height;
  const chromeLeft = landscape ? 120 : 48;
  const chromeRight = landscape ? 104 : 48;
  const chromeBottom = landscape ? 28 : 24;
  const chromeTop = 10;
  const viewRightGap = Math.max(0, inner.width - view.offsetLeft - view.width);
  const viewBottomGap = Math.max(0, inner.height - view.offsetTop - view.height);
  return {
    left: view.offsetLeft + Math.max(safe.left ?? 0, 12) + chromeLeft,
    right: viewRightGap + Math.max(safe.right ?? 0, 12) + chromeRight,
    top: view.offsetTop + Math.max(safe.top ?? 0, 8) + chromeTop,
    bottom: viewBottomGap + Math.max(safe.bottom ?? 0, 12) + chromeBottom,
  };
}

export function cameraHudHint(cameraName: string, keyHints: boolean): string {
  return keyHints ? `Camera: ${cameraName} (C to switch)` : `Camera: ${cameraName}`;
}
