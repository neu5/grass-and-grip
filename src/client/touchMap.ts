const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;

/** Thumb travel (CSS px) from where it landed to full steering lock. */
export const STEER_FULL_PX = 60;
/** Wobble ignored around the landing point, so resting the thumb drives straight. */
export const STEER_DEAD_PX = 6;

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

/** The pedal buttons, as screen rects. */
export interface PedalLayout {
  gas: Rect;
  brake: Rect;
  handbrake: Rect;
}

export interface PedalState {
  throttle: number;
  handbrake: boolean;
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

/**
 * Floating stick: steer from how far the thumb has slid sideways since it
 * touched down. Linear after a small deadzone, full lock at STEER_FULL_PX.
 * Screen right is steer +1.
 */
export function steerFromDrag(dx: number, full = STEER_FULL_PX, dead = STEER_DEAD_PX): number {
  const a = Math.abs(dx);
  if (a <= dead) return 0;
  return Math.sign(dx) * Math.min(1, (a - dead) / (full - dead));
}

/**
 * Pedals under the given thumbs. GAS drives, BRAKE brakes and then reverses
 * (like the down key); BRAKE wins if both are held. HANDBRAKE is separate.
 * A thumb can slide from one pedal to another.
 */
export function mapPedals(points: Point[], layout: PedalLayout): PedalState {
  let gas = false;
  let brake = false;
  let handbrake = false;
  for (const p of points) {
    if (pointInRect(p, layout.gas)) gas = true;
    else if (pointInRect(p, layout.brake)) brake = true;
    else if (pointInRect(p, layout.handbrake)) handbrake = true;
  }
  return { throttle: brake ? -1 : gas ? 1 : 0, handbrake };
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
 * Keep the pedals and buttons inside the visible game area, clear of notches
 * and in-app browser chrome (side bars, address bars).
 */
export function overlayInsets(
  view: { offsetLeft: number; offsetTop: number; width: number; height: number },
  inner: { width: number; height: number },
  safe: { left?: number; right?: number; top?: number; bottom?: number } = {},
): OverlayInsets {
  // A little room for in-app browser chrome; thumbs sit near the corners.
  const landscape = view.width >= view.height;
  const chromeLeft = landscape ? 24 : 16;
  const chromeRight = landscape ? 24 : 16;
  const chromeBottom = landscape ? 16 : 16;
  const chromeTop = 8;
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
