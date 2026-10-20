import type { PlayerInput } from '../sim';
import {
  isMobileLike,
  mapPointersToControls,
  readBrowserMobileFlags,
  shouldForceCssLandscape,
  type Point,
  type Rect,
  type TouchLayout,
} from './touchMap';

export { cameraHudHint, isMobileLike, mapPointersToControls, mapStickToDrive, readBrowserMobileFlags, shouldForceCssLandscape } from './touchMap';

const ZERO: PlayerInput = { throttle: 0, steer: 0, handbrake: false };

type LockableOrientation = { lock?: (mode: string) => Promise<void> };

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

function layoutOf(stick: HTMLElement, brake: HTMLElement, camera: HTMLElement): TouchLayout {
  const s = stick.getBoundingClientRect();
  return {
    stick: { cx: s.left + s.width / 2, cy: s.top + s.height / 2, radius: Math.min(s.width, s.height) / 2 },
    brake: rectOf(brake),
    camera: rectOf(camera),
  };
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
      <div id="mc-stick" class="mc-stick" aria-label="Drive stick">
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
  const stickEl = overlay.querySelector<HTMLElement>('#mc-stick')!;
  const knob = overlay.querySelector<HTMLElement>('#mc-knob')!;

  const pointers = new Map<number, Point>();
  let stickId: number | null = null;
  let cameraHeld = false;
  let visible = false;
  let locked = false;

  const input: PlayerInput = { ...ZERO };

  const apply = () => {
    const pts = [...pointers.entries()].filter(([id]) => id !== stickId).map(([, p]) => p);
    const captured = stickId !== null ? pointers.get(stickId) ?? null : null;
    const mapped = mapPointersToControls(pts, layoutOf(stickEl, brakeBtn, camBtn), { capturedStick: captured });
    input.throttle = mapped.throttle;
    input.steer = mapped.steer;
    input.handbrake = mapped.handbrake;
    camBtn.classList.toggle('on', mapped.camera);
    brakeBtn.classList.toggle('on', mapped.handbrake);
    if (mapped.camera && !cameraHeld) opts.onCamera();
    cameraHeld = mapped.camera;

    const s = stickEl.getBoundingClientRect();
    const radius = Math.min(s.width, s.height) / 2;
    const max = radius * 0.55;
    knob.style.transform = `translate(calc(-50% + ${mapped.steer * max}px), calc(-50% + ${-mapped.throttle * max}px))`;
  };

  const setPointer = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onDown = (e: PointerEvent) => {
    if (!visible) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPointer(e);
    const lay = layoutOf(stickEl, brakeBtn, camBtn);
    const p = { x: e.clientX, y: e.clientY };
    const dist = Math.hypot(p.x - lay.stick.cx, p.y - lay.stick.cy);
    if (dist <= lay.stick.radius * 1.5) stickId = e.pointerId;
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
    if (stickId === e.pointerId) stickId = null;
    apply();
    if (pointers.size === 0) {
      input.throttle = 0;
      input.steer = 0;
      input.handbrake = false;
      cameraHeld = false;
      knob.style.transform = 'translate(-50%, -50%)';
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
    const portrait = window.innerHeight > window.innerWidth;
    const force = visible && shouldForceCssLandscape(mobile, portrait, locked);
    document.documentElement.classList.toggle('gg-rotate', force);
    hint.hidden = !force;
  };

  const onResize = () => {
    void syncLandscape();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  const firstGesture = () => {
    void syncLandscape();
  };
  window.addEventListener('pointerdown', firstGesture, { passive: true, once: true });

  void syncLandscape();

  return {
    sample() {
      return visible ? { ...input } : { ...ZERO };
    },
    setVisible(next) {
      visible = next;
      overlay.hidden = !next;
      document.documentElement.classList.toggle('gg-racing', next);
      if (!next) {
        pointers.clear();
        stickId = null;
        cameraHeld = false;
        input.throttle = 0;
        input.steer = 0;
        input.handbrake = false;
        knob.style.transform = 'translate(-50%, -50%)';
      }
      void syncLandscape();
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('pointerdown', firstGesture);
      overlay.remove();
      hint.remove();
    },
  };
}

export function applyTouchMenuHints(mobile: boolean, root: ParentNode = document) {
  document.documentElement.classList.toggle('gg-touch', mobile);
  for (const el of root.querySelectorAll<HTMLElement>('[data-kb-hint]')) el.hidden = mobile;
  for (const el of root.querySelectorAll<HTMLElement>('[data-touch-hint]')) el.hidden = !mobile;
}
