const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;

export const STEER_DEADZONE = 0.22;
export const STEER_GAIN = 0.65;
export const THROTTLE_GAIN = 1;
export const STEER_EXPO = 1.8;

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

export function padCenter(pad: SteerPad): { cx: number; cy: number; radius: number } {
  return {
    cx: (pad.left + pad.right) / 2,
    cy: (pad.top + pad.bottom) / 2,
    radius: Math.max(1, Math.min(pad.right - pad.left, pad.bottom - pad.top) / 2),
  };
}

/**
 * 2-axis stick. Screen up = throttle +1 (forward), down = throttle -1 (reverse),
 * right = steer +1. Radial deadzone + expo so it is not twitchy.
 */
export function mapStickToDrive(
  p: Point,
  pad: SteerPad,
  deadzone = STEER_DEADZONE,
): { throttle: number; steer: number } {
  const { cx, cy, radius } = padCenter(pad);
  const nx = (p.x - cx) / radius;
  const ny = (p.y - cy) / radius;
  const mag = Math.hypot(nx, ny);
  if (mag < deadzone) return { throttle: 0, steer: 0 };
  const clip = mag > 1 ? 1 / mag : 1;
  const t = (Math.min(mag, 1) - deadzone) / (1 - deadzone);
  const eased = t ** STEER_EXPO;
  const ux = (nx * clip) / Math.min(mag, 1);
  const uy = (ny * clip) / Math.min(mag, 1);
  return {
    steer: clamp(ux * eased * STEER_GAIN, -1, 1),
    throttle: clamp(-uy * eased * THROTTLE_GAIN, -1, 1),
  };
}

export interface MapPointersOpts {
  deadzone?: number;
  /** Steer pointer after capture — mapped even outside the pad, never treated as a button. */
  capturedSteer?: Point | null;
}

/**
 * Assign pointers to stick / brake / camera.
 * Stick is 2-axis (no auto-gas). BRAKE is handbrake only.
 */
export function mapPointersToControls(pointers: Point[], layout: TouchLayout, opts: MapPointersOpts = {}): MappedControls {
  let throttle = 0;
  let steer = 0;
  let handbrake = false;
  let camera = false;
  let stickUsed = false;

  if (opts.capturedSteer) {
    const drive = mapStickToDrive(opts.capturedSteer, layout.steer, opts.deadzone);
    throttle = drive.throttle;
    steer = drive.steer;
    stickUsed = true;
  }

  for (const p of pointers) {
    if (opts.capturedSteer && p.x === opts.capturedSteer.x && p.y === opts.capturedSteer.y) continue;
    if (pointInRect(p, layout.camera)) {
      camera = true;
      continue;
    }
    if (pointInRect(p, layout.brake)) {
      handbrake = true;
      continue;
    }
    if (!stickUsed && pointInRect(p, layout.steer)) {
      const drive = mapStickToDrive(p, layout.steer, opts.deadzone);
      throttle = drive.throttle;
      steer = drive.steer;
      stickUsed = true;
    }
  }

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
 * Keep CAM / BRAKE / steer inside the visible game area, clear of notches
 * and in-app browser chrome (Instagram side bars, address bars).
 */
export function overlayInsets(
  view: { offsetLeft: number; offsetTop: number; width: number; height: number },
  inner: { width: number; height: number },
  safe: { left?: number; right?: number; top?: number; bottom?: number } = {},
): OverlayInsets {
  const landscape = view.width >= view.height;
  const chromeLeft = landscape ? 120 : 48;
  const chromeRight = landscape ? 140 : 48;
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
