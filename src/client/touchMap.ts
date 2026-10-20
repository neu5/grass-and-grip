const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;

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

export interface StickPad {
  cx: number;
  cy: number;
  radius: number;
}

export interface TouchLayout {
  stick: StickPad;
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

/**
 * Map a pointer on the right-hand stick to drive axes.
 * Screen up (smaller y) is throttle +1; right is steer +1.
 */
export function mapStickToDrive(p: Point, stick: StickPad, deadzone = 0.14): { throttle: number; steer: number } {
  if (stick.radius <= 0) return { throttle: 0, steer: 0 };
  const nx = (p.x - stick.cx) / stick.radius;
  const ny = (p.y - stick.cy) / stick.radius;
  const mag = Math.hypot(nx, ny);
  if (mag < deadzone) return { throttle: 0, steer: 0 };
  const scale = mag > 1 ? 1 / mag : 1;
  return {
    steer: clamp(nx * scale, -1, 1),
    throttle: clamp(-ny * scale, -1, 1),
  };
}

const STICK_GRAB = 1.5;

export interface MapPointersOpts {
  deadzone?: number;
  /** Stick pointer after capture — mapped even outside the pad, never treated as a button. */
  capturedStick?: Point | null;
}

/**
 * Assign pointers to stick / brake / camera hit regions.
 * Camera and brake win over an uncaptured stick if a point sits on both (they should not overlap).
 */
export function mapPointersToControls(pointers: Point[], layout: TouchLayout, opts: MapPointersOpts = {}): MappedControls {
  const deadzone = opts.deadzone ?? 0.14;
  let throttle = 0;
  let steer = 0;
  let handbrake = false;
  let camera = false;
  let stickUsed = false;

  if (opts.capturedStick) {
    const drive = mapStickToDrive(opts.capturedStick, layout.stick, deadzone);
    throttle = drive.throttle;
    steer = drive.steer;
    stickUsed = true;
  }

  for (const p of pointers) {
    if (opts.capturedStick && p.x === opts.capturedStick.x && p.y === opts.capturedStick.y) continue;
    if (pointInRect(p, layout.camera)) {
      camera = true;
      continue;
    }
    if (pointInRect(p, layout.brake)) {
      handbrake = true;
      continue;
    }
    const dist = Math.hypot(p.x - layout.stick.cx, p.y - layout.stick.cy);
    if (!stickUsed && dist <= layout.stick.radius * STICK_GRAB) {
      const drive = mapStickToDrive(p, layout.stick, deadzone);
      throttle = drive.throttle;
      steer = drive.steer;
      stickUsed = true;
    }
  }

  return { throttle, steer, handbrake, camera };
}

export function shouldForceCssLandscape(mobile: boolean, portrait: boolean, orientationLocked: boolean): boolean {
  return mobile && portrait && !orientationLocked;
}

export function cameraHudHint(cameraName: string, keyHints: boolean): string {
  return keyHints ? `Camera: ${cameraName} (C to switch)` : `Camera: ${cameraName}`;
}
