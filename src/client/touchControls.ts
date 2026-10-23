import type { PlayerInput } from '../sim';
import {
  STEER_FULL_PX,
  isLandscapeView,
  isMobileLike,
  mapPedals,
  overlayInsets,
  readBrowserMobileFlags,
  shouldBlockPortrait,
  steerFromDrag,
  type PedalLayout,
  type Point,
  type Rect,
} from './touchMap';

export {
  cameraHudHint,
  isLandscapeView,
  isMobileLike,
  isPortraitView,
  mapPedals,
  overlayInsets,
  readBrowserMobileFlags,
  shouldBlockPortrait,
  shouldShowRotateHint,
  steerFromDrag,
} from './touchMap';

const ZERO: PlayerInput = { throttle: 0, steer: 0, handbrake: false };

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

/**
 * Phone controls. Left half of the screen: a floating steering stick: put a
 * thumb down anywhere and slide it left or right. Right side: GAS, BRAKE/REV
 * and HANDBRAKE pedals; a thumb can slide between them. CAM switches camera.
 */
export function mountTouchControls(opts: { onCamera: () => void; onMenu?: () => void; root?: HTMLElement }): TouchControls {
  const host = opts.root ?? document.body;
  const overlay = document.createElement('div');
  overlay.id = 'mobile-controls';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div id="mc-steer-zone" class="mc-steer-zone"><span class="mc-hint">◀ slide to steer ▶</span></div>
    <div id="mc-stick" class="mc-stick" hidden><div id="mc-knob" class="mc-knob"></div></div>
    <button type="button" id="mc-full" class="mc-full" aria-label="Fullscreen">FULL</button>
    <button type="button" id="mc-cam" class="mc-btn mc-cam" aria-label="Camera">CAM</button>
    <button type="button" id="mc-menu" class="mc-btn mc-menu" aria-label="Menu"${opts.onMenu ? '' : ' hidden'}>MENU</button>
    <div class="mc-pedals">
      <button type="button" id="mc-hb" class="mc-btn mc-hb" aria-label="Handbrake">HANDBRAKE</button>
      <div class="mc-pedal-row">
        <button type="button" id="mc-brake" class="mc-btn mc-brake" aria-label="Brake and reverse">BRAKE<small>REV</small></button>
        <button type="button" id="mc-gas" class="mc-btn mc-gas" aria-label="Gas">GAS</button>
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

  const $ = <T extends HTMLElement>(sel: string) => overlay.querySelector<T>(sel)!;
  const zone = $('#mc-steer-zone');
  const stick = $('#mc-stick');
  const knob = $('#mc-knob');
  const camBtn = $<HTMLButtonElement>('#mc-cam');
  const gasBtn = $<HTMLButtonElement>('#mc-gas');
  const brakeBtn = $<HTMLButtonElement>('#mc-brake');
  const hbBtn = $<HTMLButtonElement>('#mc-hb');
  const gateFull = gate.querySelector<HTMLButtonElement>('#rotate-full')!;

  /** Thumbs on the pedals, by pointer id. */
  const pedalThumbs = new Map<number, Point>();
  let steerId: number | null = null;
  let steerOrigin: Point = { x: 0, y: 0 };
  let steerNow = 0;
  let visible = false;
  let blocked = false;
  let chromeAsked = false;
  const input: PlayerInput = { ...ZERO };

  const pedalLayout = (): PedalLayout => ({ gas: rectOf(gasBtn), brake: rectOf(brakeBtn), handbrake: rectOf(hbBtn) });

  const update = () => {
    if (blocked) {
      Object.assign(input, ZERO);
      return;
    }
    const pedals = mapPedals([...pedalThumbs.values()], pedalLayout());
    input.throttle = pedals.throttle;
    input.handbrake = pedals.handbrake;
    input.steer = steerNow;
    gasBtn.classList.toggle('on', pedals.throttle > 0);
    brakeBtn.classList.toggle('on', pedals.throttle < 0);
    hbBtn.classList.toggle('on', pedals.handbrake);
  };

  const requestChrome = () => {
    void (async () => {
      await tryEnterFullscreen();
      await tryLockLandscape();
      syncLayout();
    })();
  };

  const releaseSteer = () => {
    steerId = null;
    steerNow = 0;
    stick.hidden = true;
    zone.classList.remove('active');
  };

  const onDown = (e: PointerEvent) => {
    if (!visible || blocked) return;
    const t = e.target as HTMLElement;
    e.preventDefault();
    if (t.closest('#mc-full')) {
      requestChrome();
      return;
    }
    // Fullscreen and landscape lock once per race, on the first touch (browsers need a gesture).
    if (!chromeAsked) {
      chromeAsked = true;
      requestChrome();
    }
    if (t.closest('#mc-menu')) {
      opts.onMenu?.();
      return;
    }
    if (t.closest('#mc-cam')) {
      opts.onCamera();
      camBtn.classList.add('on');
      setTimeout(() => camBtn.classList.remove('on'), 150);
      return;
    }
    try {
      t.setPointerCapture?.(e.pointerId);
    } catch {
      // Not a live pointer (synthetic event): moves still bubble to the overlay.
    }
    const p = { x: e.clientX, y: e.clientY };
    if (t.closest('#mc-steer-zone') && steerId === null) {
      steerId = e.pointerId;
      steerOrigin = p;
      steerNow = 0;
      stick.hidden = false;
      stick.style.left = `${p.x}px`;
      stick.style.top = `${p.y}px`;
      knob.style.transform = 'translate(-50%, -50%)';
      zone.classList.add('active');
    } else if (t.closest('.mc-pedals')) {
      pedalThumbs.set(e.pointerId, p);
    }
    update();
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId === steerId) {
      e.preventDefault();
      const dx = e.clientX - steerOrigin.x;
      steerNow = steerFromDrag(dx);
      const shown = Math.max(-STEER_FULL_PX, Math.min(STEER_FULL_PX, dx));
      knob.style.transform = `translate(calc(-50% + ${shown}px), -50%)`;
      update();
    } else if (pedalThumbs.has(e.pointerId)) {
      e.preventDefault();
      pedalThumbs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      update();
    }
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId === steerId) releaseSteer();
    pedalThumbs.delete(e.pointerId);
    update();
  };

  overlay.addEventListener('pointerdown', onDown);
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerup', onUp);
  overlay.addEventListener('pointercancel', onUp);
  overlay.addEventListener('lostpointercapture', onUp);
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  gateFull.addEventListener('click', (e) => {
    e.preventDefault();
    requestChrome();
  });
  gate.addEventListener('pointerdown', () => requestChrome());

  const clearAll = () => {
    pedalThumbs.clear();
    releaseSteer();
    Object.assign(input, ZERO);
    for (const b of [gasBtn, brakeBtn, hbBtn, camBtn]) b.classList.remove('on');
  };

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
    if (blocked) clearAll();
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
      clearAll();
      chromeAsked = false;
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

export function applyTouchMenuHints(mobile: boolean, root: ParentNode = document) {
  document.documentElement.classList.toggle('gg-touch', mobile);
  for (const el of root.querySelectorAll<HTMLElement>('[data-kb-hint]')) el.hidden = mobile;
  for (const el of root.querySelectorAll<HTMLElement>('[data-touch-hint]')) el.hidden = !mobile;
}
