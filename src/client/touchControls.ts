import type { PlayerInput } from '../sim';
import {
  STEER_GAIN,
  isLandscapeView,
  isMobileLike,
  mapPointersToControls,
  overlayInsets,
  readBrowserMobileFlags,
  shouldBlockPortrait,
  type Point,
  type Rect,
  type TouchLayout,
} from './touchMap';

export {
  cameraHudHint,
  isLandscapeView,
  isMobileLike,
  isPortraitView,
  mapPointersToControls,
  mapSteerAxis,
  overlayInsets,
  readBrowserMobileFlags,
  shouldBlockPortrait,
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

export async function tryEnterFullscreen(doc: Document = document): Promise<boolean> {
  const root = doc.documentElement as HTMLElement & {
    requestFullscreen?: (opts?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const webkitEl = (doc as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
  if (doc.fullscreenElement || webkitEl) return true;
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return true;
    }
    const wk = root.webkitRequestFullscreen?.();
    if (wk && typeof (wk as Promise<void>).then === 'function') await wk;
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
    <button type="button" id="mc-full" class="mc-full" aria-label="Fullscreen">FULL</button>
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
  const gate = document.createElement('div');
  gate.id = 'rotate-gate';
  gate.hidden = true;
  gate.innerHTML = `
    <div class="rotate-gate-card">
      <p class="rotate-title">Rotate phone</p>
      <p class="rotate-sub">Landscape only</p>
      <button type="button" id="rotate-full">Fullscreen</button>
    </div>
  `;
  host.append(overlay, gate);

  const camBtn = overlay.querySelector<HTMLButtonElement>('#mc-cam')!;
  const brakeBtn = overlay.querySelector<HTMLButtonElement>('#mc-brake')!;
  const fullBtn = overlay.querySelector<HTMLButtonElement>('#mc-full')!;
  const gateFull = gate.querySelector<HTMLButtonElement>('#rotate-full')!;
  const steerEl = overlay.querySelector<HTMLElement>('#mc-steer')!;
  const knob = overlay.querySelector<HTMLElement>('#mc-knob')!;

  const pointers = new Map<number, Point>();
  let steerId: number | null = null;
  let cameraHeld = false;
  let visible = false;
  let blocked = false;

  const input: PlayerInput = { ...AUTO };

  const resetKnob = () => {
    knob.style.transform = 'translate(-50%, -50%)';
  };

  const apply = () => {
    if (blocked) {
      input.throttle = 0;
      input.steer = 0;
      input.handbrake = false;
      return;
    }
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

  const requestChrome = () => {
    void (async () => {
      await tryEnterFullscreen();
      await tryLockLandscape();
      syncLayout();
    })();
  };

  const onDown = (e: PointerEvent) => {
    if (!visible || blocked) return;
    const t = e.target as HTMLElement;
    if (t === fullBtn || t.closest?.('#mc-full')) {
      e.preventDefault();
      requestChrome();
      return;
    }
    e.preventDefault();
    requestChrome();
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
      input.throttle = blocked ? 0 : 1;
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
  gateFull.addEventListener('click', (e) => {
    e.preventDefault();
    requestChrome();
  });
  gate.addEventListener('pointerdown', () => requestChrome());

  const syncLayout = () => {
    const mobile = detectMobile();
    document.documentElement.classList.toggle('gg-touch', mobile);
    if (!mobile) {
      document.documentElement.classList.remove('gg-racing', 'gg-portrait-block');
      gate.hidden = true;
      blocked = false;
      return;
    }
    const vv = window.visualViewport;
    const ori = (window.screen as Screen & { orientation?: LockableOrientation }).orientation?.type;
    const landscape = isLandscapeView(vv?.width ?? window.innerWidth, vv?.height ?? window.innerHeight, ori);
    blocked = shouldBlockPortrait(mobile, visible, landscape);
    document.documentElement.classList.toggle('gg-portrait-block', blocked);
    gate.hidden = !blocked;
    overlay.hidden = !visible || blocked;
    applyOverlayInsets();
  };

  const onResize = () => syncLayout();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  document.addEventListener('fullscreenchange', onResize);

  syncLayout();

  return {
    sample() {
      if (!visible || blocked) return { ...ZERO };
      return { ...input };
    },
    setVisible(next) {
      visible = next;
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
        requestChrome();
      }
      syncLayout();
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      document.removeEventListener('fullscreenchange', onResize);
      overlay.remove();
      gate.remove();
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
