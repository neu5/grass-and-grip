import type { PlayerInput } from '../sim';
import {
  STEER_GAIN,
  isMobileLike,
  isPortraitView,
  mapPointersToControls,
  overlayInsets,
  readBrowserMobileFlags,
  shouldForceCssLandscape,
  shouldShowRotateHint,
  type Point,
  type Rect,
  type TouchLayout,
} from './touchMap';

export {
  cameraHudHint,
  isMobileLike,
  isPortraitView,
  mapPointersToControls,
  mapSteerAxis,
  overlayInsets,
  readBrowserMobileFlags,
  shouldForceCssLandscape,
  shouldShowRotateHint,
} from './touchMap';

const ZERO: PlayerInput = { throttle: 0, steer: 0, handbrake: false };
const AUTO: PlayerInput = { throttle: 1, steer: 0, handbrake: false };

type LockableOrientation = { lock?: (mode: string) => Promise<void>; type?: string };

export function detectMobile(win: Window = window): boolean {
  return isMobileLike(readBrowserMobileFlags(win));
}

export async function tryLockLandscape(win: Window = window): Promise<boolean> {
  const ori = (win.screen as Screen & { orientation?: LockableOrientation }).orientation;
  if (!ori?.lock) return false;
  try {
    await ori.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function layoutOf(steer: HTMLElement, brake: HTMLElement, camera: HTMLElement): TouchLayout {
  return { steer: rectOf(steer), brake: rectOf(brake), camera: rectOf(camera) };
}

function applyOverlayInsets() {
  const vv = window.visualViewport;
  const view = {
    offsetLeft: vv?.offsetLeft ?? 0,
    offsetTop: vv?.offsetTop ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
  const pad = overlayInsets(view, { width: window.innerWidth, height: window.innerHeight });
  const root = document.documentElement;
  root.style.setProperty('--mc-inset-left', `${pad.left}px`);
  root.style.setProperty('--mc-inset-right', `${pad.right}px`);
  root.style.setProperty('--mc-inset-bottom', `${pad.bottom}px`);
  root.style.setProperty('--mc-inset-top', `${pad.top}px`);
}

export interface TouchControls {
  sample(): PlayerInput;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function mountTouchControls(opts: { onCamera: () => void; root?: HTMLElement }): TouchControls {
  const host = opts.root ?? document.body;
  const overlay = document.createElement('div');
  overlay.id = 'mobile-controls';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mc-left">
      <button type="button" id="mc-cam" class="mc-btn" aria-label="Camera">CAM</button>
      <button type="button" id="mc-brake" class="mc-btn mc-brake" aria-label="Brake">BRAKE</button>
    </div>
    <div class="mc-right">
      <div id="mc-steer" class="mc-steer" aria-label="Steer">
        <div id="mc-knob" class="mc-knob"></div>
      </div>
    </div>
  `;
  const hint = document.createElement('div');
  hint.id = 'rotate-hint';
  hint.hidden = true;
  hint.textContent = 'Rotate phone';
  host.append(overlay, hint);

  const camBtn = overlay.querySelector<HTMLButtonElement>('#mc-cam')!;
  const brakeBtn = overlay.querySelector<HTMLButtonElement>('#mc-brake')!;
  const steerEl = overlay.querySelector<HTMLElement>('#mc-steer')!;
  const knob = overlay.querySelector<HTMLElement>('#mc-knob')!;

  const pointers = new Map<number, Point>();
  let steerId: number | null = null;
  let cameraHeld = false;
  let visible = false;
  let locked = false;

  const input: PlayerInput = { ...AUTO };

  const resetKnob = () => {
    knob.style.transform = 'translate(-50%, -50%)';
  };

  const apply = () => {
    const pts = [...pointers.entries()].filter(([id]) => id !== steerId).map(([, p]) => p);
    const captured = steerId !== null ? pointers.get(steerId) ?? null : null;
    const mapped = mapPointersToControls(pts, layoutOf(steerEl, brakeBtn, camBtn), { capturedSteer: captured });
    input.throttle = mapped.throttle;
    input.steer = mapped.steer;
    input.handbrake = mapped.handbrake;
    camBtn.classList.toggle('on', mapped.camera);
    brakeBtn.classList.toggle('on', mapped.handbrake);
    if (mapped.camera && !cameraHeld) opts.onCamera();
    cameraHeld = mapped.camera;

    const box = steerEl.getBoundingClientRect();
    const max = Math.max(8, box.width / 2 - 36);
    knob.style.transform = `translate(calc(-50% + ${(mapped.steer / STEER_GAIN) * max}px), -50%)`;
  };

  const setPointer = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onDown = (e: PointerEvent) => {
    if (!visible) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPointer(e);
    const lay = layoutOf(steerEl, brakeBtn, camBtn);
    if (pointInSteer({ x: e.clientX, y: e.clientY }, lay.steer)) steerId = e.pointerId;
    apply();
  };

  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    setPointer(e);
    apply();
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (steerId === e.pointerId) steerId = null;
    apply();
    if (pointers.size === 0) {
      input.throttle = 1;
      input.steer = 0;
      input.handbrake = false;
      cameraHeld = false;
      resetKnob();
      camBtn.classList.remove('on');
      brakeBtn.classList.remove('on');
    }
  };

  overlay.addEventListener('pointerdown', onDown);
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerup', onUp);
  overlay.addEventListener('pointercancel', onUp);
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());

  const syncLandscape = async () => {
    const mobile = detectMobile();
    document.documentElement.classList.toggle('gg-touch', mobile);
    if (!mobile) {
      document.documentElement.classList.remove('gg-rotate', 'gg-racing');
      hint.hidden = true;
      return;
    }
    if (visible) locked = (await tryLockLandscape()) || locked;
    const ori = (window.screen as Screen & { orientation?: LockableOrientation }).orientation?.type;
    const vv = window.visualViewport;
    const portrait = isPortraitView(vv?.width ?? window.innerWidth, vv?.height ?? window.innerHeight, ori);
    const force = visible && shouldForceCssLandscape(mobile, portrait, locked);
    document.documentElement.classList.toggle('gg-rotate', force);
    hint.hidden = !shouldShowRotateHint(!portrait, force);
    applyOverlayInsets();
  };

  const onResize = () => {
    void syncLandscape();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  const firstGesture = () => {
    void syncLandscape();
  };
  window.addEventListener('pointerdown', firstGesture, { passive: true, once: true });

  void syncLandscape();

  return {
    sample() {
      if (!visible) return { ...ZERO };
      return { ...input };
    },
    setVisible(next) {
      visible = next;
      overlay.hidden = !next;
      document.documentElement.classList.toggle('gg-racing', next);
      if (!next) {
        pointers.clear();
        steerId = null;
        cameraHeld = false;
        input.throttle = 0;
        input.steer = 0;
        input.handbrake = false;
        resetKnob();
      } else {
        input.throttle = 1;
        input.steer = 0;
        input.handbrake = false;
      }
      void syncLandscape();
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      window.removeEventListener('pointerdown', firstGesture);
      overlay.remove();
      hint.remove();
    },
  };
}

function pointInSteer(p: Point, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export function applyTouchMenuHints(mobile: boolean, root: ParentNode = document) {
  document.documentElement.classList.toggle('gg-touch', mobile);
  for (const el of root.querySelectorAll<HTMLElement>('[data-kb-hint]')) el.hidden = mobile;
  for (const el of root.querySelectorAll<HTMLElement>('[data-touch-hint]')) el.hidden = !mobile;
}
