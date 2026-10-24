import './style.css';
import { fillFastestList } from './client/fastestBoard';
import { loadFastestLaps, persistFastestLaps } from './client/fastestStore';
import { BINDINGS_SOLO, Keyboard, mergeInputs, NO_PLAYER_INPUT } from './client/input';
import { loadCustomTracks } from './client/customTracks';
import { mountLapsPicker } from './client/lapsPicker';
import { mountRulesFields, mountSetupFields } from './client/raceOptionsUi';
import { drawNetDebug } from './client/netDebug';
import { SoundEngine } from './client/audio';
import { Renderer3D } from './client/renderer3d';
import { applyTouchMenuHints, detectMobile, mountTouchControls } from './client/touchControls';
import { SNAPSHOT_HZ, CAR_COLORS, CAR_KINDS, CAR_KIND_NAMES, CAR_KIND_SHORT, CAR_MODES, CAR_MODE_NAMES, COLOR_NAMES, MAX_PLAYERS, TRACK_IDS, TRACK_NAMES, parseCarKind, parseCarMode, type CarKind, type ClientMessage, type CompactSnapshot, type LobbyState, type ServerMessage, type TrackId } from './net/protocol';
import { SnapshotBuffer, mergeOwn } from './net/interpolate';
import { InputQueue, lerpCar, reconcile, replaceCar } from './net/prediction';
import { decodeSnapshot } from './net/snapshot';
import { DT, parseTrackDef, registerTrack, stepOwnCar, type GameState, type PlayerInput, type TrackDef } from './sim';

const MAX_STEPS_PER_FRAME = 8;
const PING_EVERY_MS = 500;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#game');
const hudCanvas = $<HTMLCanvasElement>('#hud');
const renderer = new Renderer3D(canvas, hudCanvas, 'meadow');
renderer.finishHint = 'Back to the room in a few seconds…';
const sound = new SoundEngine();
renderer.sound = sound;
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true });
const keyboard = new Keyboard(window);
const mobile = detectMobile();
applyTouchMenuHints(mobile);
if (mobile) renderer.keyHints = false;
const touch = mobile
  ? mountTouchControls({
      onCamera: () => {
        if (menu.hidden) renderer.toggleCamera();
      },
    })
  : null;
const menu = $<HTMLDivElement>('#menu');
const joinForm = $<HTMLFormElement>('#join-form');
const lobbyEl = $<HTMLDivElement>('#lobby');
const readyBtn = $<HTMLButtonElement>('#ready');
const errorEl = $<HTMLParagraphElement>('#error');
const hudCtx = hudCanvas.getContext('2d')!;

const roomId = new URLSearchParams(location.search).get('id') || 'main';
$('#room-id').textContent = roomId;
const nameInput = $<HTMLInputElement>('#name');
nameInput.value = localStorage.getItem('gg-name') ?? '';

let myId = '';
let lobby: LobbyState | null = null;
let socket: WebSocket;
const remotes = new SnapshotBuffer();
const inputs = new InputQueue();
let predicted: GameState | null = null;
let prevPredicted: GameState | null = null;
let lastAck = 0;
let acc = 0;
let lastFrame = performance.now();
let debugOn = false;
let pingMs = -1;
let lastPingAt = 0;
const snapTimes: number[] = [];

function radios(container: HTMLElement, name: string, values: readonly (string | number)[], label: (v: string) => string, style?: (v: string) => string) {
  for (const v of values) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="${name}" value="${v}" /><span style="${style?.(String(v)) ?? ''}">${label(String(v))}</span>`;
    container.append(l);
  }
}
radios($('#colors'), 'color', CAR_COLORS, (c) => COLOR_NAMES[c], (c) => `background:${c}33;border-color:${c}`);
radios($('#cars'), 'car', CAR_KINDS, (k) => CAR_KIND_SHORT[k as keyof typeof CAR_KIND_SHORT]);
radios($('#ai'), 'ai', Array.from({ length: MAX_PLAYERS }, (_, i) => i), (v) => v);
radios($('#carmode'), 'carmode', CAR_MODES, (v) => (v === 'mixed' ? CAR_MODE_NAMES.mixed : CAR_KIND_SHORT[v as keyof typeof CAR_KIND_SHORT]) ?? v);
radios($('#track'), 'track', TRACK_IDS, (v) => TRACK_NAMES[v as TrackId] ?? v);
// The host's own editor tracks; picking one sends the whole track to the room.
const myTracks = new Map<string, TrackDef>(loadCustomTracks().map((d) => [d.id, d]));
radios($('#track'), 'track', [...myTracks.keys()], (id) => escapeHtml(myTracks.get(id)?.name ?? id));
/** Radio for a custom track the host picked that this player does not have. */
function ensureTrackRadio(def: TrackDef) {
  if ($('#track').querySelector(`input[value="${CSS.escape(def.id)}"]`)) return;
  radios($('#track'), 'track', [def.id], () => escapeHtml(def.name));
}
const lapsPicker = mountLapsPicker($('#laps'), (laps) => {
  if (laps !== lobby?.laps) send({ t: 'settings', laps });
});
joinForm.querySelector<HTMLInputElement>('input[name=car][value=rally]')!.checked = true;
const mySetup = mountSetupFields($('#my-setup'), 'setup', (setup) => send({ t: 'setup', setup }));
const roomRules = mountRulesFields($('#room-rules'), 'rule', (rules) => send({ t: 'settings', rules }), $('#room-ai-level'));

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  setTimeout(() => (errorEl.hidden = true), 3000);
}

function resetRaceNet() {
  remotes.clear();
  inputs.reset();
  predicted = null;
  prevPredicted = null;
  lastAck = 0;
  acc = 0;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
  socket.onopen = () => ($('#conn').textContent = 'Connected');
  socket.onclose = () => {
    $('#conn').textContent = 'Disconnected — reconnecting…';
    lobby = null;
    resetRaceNet();
    renderLobby();
    setTimeout(connect, 1500);
  };
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.t === 'welcome') myId = msg.id;
    else if (msg.t === 'error') showError(msg.message);
    else if (msg.t === 'lobby') {
      lobby = msg.lobby;
      const def = lobby.customTrack ? parseTrackDef(lobby.customTrack) : null;
      if (def) {
        registerTrack(def);
        ensureTrackRadio(def);
      }
      persistFastestLaps(lobby.trackId, lobby.fastestLaps ?? []);
      renderLobby();
    } else if (msg.t === 'snap') onSnapshot(msg.snap);
    else if (msg.t === 'pong') pingMs = performance.now() - msg.t0;
  };
}

function renderLobby() {
  const me = lobby?.players.find((p) => p.id === myId);
  const inRace = !!lobby && lobby.phase !== 'lobby';
  menu.hidden = inRace;
  touch?.setVisible(inRace);
  if (!inRace) {
    resetRaceNet();
    sound.silence();
  }
  joinForm.hidden = !lobby || !!me;
  lobbyEl.hidden = !lobby || !me;
  if (!lobby) return;

  const taken = lobby.players.map((p) => p.color);
  const oneMake = lobby.carMode === 'mixed' ? null : lobby.carMode;
  for (const input of joinForm.querySelectorAll<HTMLInputElement>('input[name=color]')) {
    input.disabled = taken.includes(input.value);
    if (input.disabled && input.checked) input.checked = false;
  }
  if (!joinForm.querySelector('input[name=color]:checked')) {
    const free = joinForm.querySelector<HTMLInputElement>('input[name=color]:not(:disabled)');
    if (free) free.checked = true;
  }
  for (const input of joinForm.querySelectorAll<HTMLInputElement>('input[name=car]')) {
    input.disabled = oneMake !== null;
    if (oneMake && input.value === oneMake) input.checked = true;
  }
  joinForm.querySelector<HTMLButtonElement>('button')!.disabled = lobby.players.length >= MAX_PLAYERS;
  if (!me) return;

  const shownKind = (car: CarKind) => CAR_KIND_NAMES[oneMake ?? car] ?? 'Rally';
  $('#players').innerHTML = lobby.players
    .map(
      (p) => `<li><span class="swatch" style="background:${p.color}"></span><span class="grow">${escapeHtml(p.name)}${
        p.id === myId ? ' <span class="badge">(you)</span>' : ''
      }${p.host ? ' <span class="badge">host</span>' : ''} <span class="badge">${shownKind(p.car)}</span></span><span class="${p.ready ? 'ready' : 'badge'}">${p.ready ? 'READY' : 'not ready'}</span></li>`,
    )
    .join('');
  const isHost = me.host;
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=ai]')) {
    input.checked = Number(input.value) === lobby.aiCount;
    input.disabled = !isHost || Number(input.value) > MAX_PLAYERS - lobby.players.length;
  }
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=carmode]')) {
    input.checked = input.value === lobby.carMode;
    input.disabled = !isHost;
  }
  roomRules.set(lobby.rules);
  roomRules.setDisabled(!isHost);
  mySetup.set(me.setup);
  lapsPicker.setValue(lobby.laps);
  lapsPicker.setDisabled(!isHost);
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=track]')) {
    input.checked = input.value === lobby.trackId;
    input.disabled = !isHost;
  }
  const waiting = lobby.players.filter((p) => !p.ready).length;
  $('#status').textContent = `${lobby.players.length} human${lobby.players.length > 1 ? 's' : ''} + ${lobby.aiCount} AI. ${
    waiting ? `Waiting for ${waiting} driver${waiting > 1 ? 's' : ''} to get ready.` : ''
  }${isHost ? '' : ' The host picks AI, laps, track, grid and options.'}`;
  readyBtn.textContent = me.ready ? 'Ready! (click to cancel)' : 'Ready';
  readyBtn.classList.toggle('on', me.ready);
  fillFastestList($('#fastest-laps ol'), lobby.fastestLaps ?? []);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const color = joinForm.querySelector<HTMLInputElement>('input[name=color]:checked')?.value ?? '';
  const oneMake = lobby && lobby.carMode !== 'mixed' ? lobby.carMode : null;
  const car = oneMake ?? parseCarKind(joinForm.querySelector<HTMLInputElement>('input[name=car]:checked')?.value) ?? 'rally';
  localStorage.setItem('gg-name', nameInput.value.trim());
  send({ t: 'join', name: nameInput.value, color, car });
});
readyBtn.addEventListener('click', () => {
  const me = lobby?.players.find((p) => p.id === myId);
  send({ t: 'ready', ready: !me?.ready });
});
lobbyEl.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'ai') send({ t: 'settings', aiCount: Number(input.value) });
  if (input.name === 'track') {
    const custom = myTracks.get(input.value);
    send(custom ? { t: 'settings', customTrack: custom } : { t: 'settings', trackId: input.value });
  }
  if (input.name === 'carmode') send({ t: 'settings', carMode: parseCarMode(input.value) ?? 'mixed' });
});

function myCarId(): number | undefined {
  return lobby?.cars[myId];
}

function onSnapshot(raw: CompactSnapshot) {
  const now = performance.now();
  snapTimes.push(now);
  while (snapTimes[0] < now - 1000) snapTimes.shift();
  lastAck = raw.ack;
  const state = decodeSnapshot(raw, remotes.latest ?? predicted ?? undefined);
  renderer.setTrack(state.trackId);
  if (remotes.length === 0) {
    renderer.resetRace();
    // Record from before this race; the saved laps already include the room's board.
    state.trackRecord = loadFastestLaps(state.trackId)[0] ?? null;
  }
  persistFastestLaps(state.trackId, state.fastestLaps ?? []);
  remotes.push(state, now);
  renderer.onTick(state);
  const carId = myCarId();
  if (carId === undefined) return;
  inputs.ack(raw.ack);
  predicted = reconcile(predicted, state, carId, inputs.unacked);
}

function predictTicks(now: number) {
  const carId = myCarId();
  if (carId === undefined || !predicted) return;
  acc += Math.min(0.25, (now - lastFrame) / 1000);
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
    const input: PlayerInput = mergeInputs(keyboard.sample(BINDINGS_SOLO), touch?.sample() ?? NO_PLAYER_INPUT);
    const item = inputs.push(predicted.tick, input);
    send({ t: 'input', seq: item.seq, tick: item.tick, input: item.input });
    prevPredicted = predicted;
    predicted = stepOwnCar(predicted, carId, input);
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;
}

function maybePing(now: number) {
  if (socket?.readyState !== WebSocket.OPEN || now - lastPingAt < PING_EVERY_MS) return;
  lastPingAt = now;
  send({ t: 'ping', t0: now });
}

function frame(now: number) {
  maybePing(now);
  if (menu.hidden) {
    predictTicks(now);
    const sample = remotes.sample(now);
    if (sample) {
      const carId = myCarId();
      const own = predicted && carId !== undefined ? predicted.cars.find((c) => c.id === carId) : undefined;
      const prevOwn = prevPredicted && carId !== undefined ? prevPredicted.cars.find((c) => c.id === carId) : undefined;
      const ownState =
        predicted && own
          ? replaceCar(predicted, prevOwn ? lerpCar(prevOwn, own, acc / DT) : own)
          : predicted;
      const prev = mergeOwn(sample.prev, ownState, carId);
      const curr = mergeOwn(sample.curr, ownState, carId);
      renderer.render(prev, curr, sample.alpha, carId === undefined ? [] : [carId]);
      if (debugOn) {
        drawNetDebug(
          hudCtx,
          {
            pingMs,
            snapHz: snapTimes.length || SNAPSHOT_HZ,
            seq: inputs.lastSeq,
            ack: lastAck,
            queued: inputs.unacked.length,
            predictedTick: predicted?.tick ?? 0,
            serverTick: remotes.latest?.tick ?? 0,
          },
          canvas.clientHeight,
        );
      }
    }
  }
  lastFrame = now;
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && menu.hidden) renderer.toggleCamera();
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) sound.toggleMute();
  if (e.code === 'KeyU') renderer.toggleCheckpointDebug();
  if (e.code === 'F3') {
    e.preventDefault();
    debugOn = !debugOn;
  }
});

connect();
requestAnimationFrame(frame);
