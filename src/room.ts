import './style.css';
import { BINDINGS_SOLO, Keyboard, mergeInputs, NO_PLAYER_INPUT } from './client/input';
import { mountLapsPicker } from './client/lapsPicker';
import { drawNetDebug } from './client/netDebug';
import { Renderer3D } from './client/renderer3d';
import { applyTouchMenuHints, detectMobile, mountTouchControls } from './client/touchControls';
import { SNAPSHOT_HZ, CAR_COLORS, CAR_KINDS, CAR_KIND_NAMES, COLOR_NAMES, MAX_PLAYERS, TRACK_IDS, TRACK_NAMES, type ClientMessage, type CompactSnapshot, type LobbyState, type ServerMessage, type TrackId } from './net/protocol';
import { SnapshotBuffer, mergeOwn } from './net/interpolate';
import { InputQueue, lerpCar, reconcile, replaceCar } from './net/prediction';
import { decodeSnapshot } from './net/snapshot';
import { DT, stepOwnCar, type GameState, type PlayerInput } from './sim';

const MAX_STEPS_PER_FRAME = 8;
const PING_EVERY_MS = 500;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#game');
const hudCanvas = $<HTMLCanvasElement>('#hud');
const renderer = new Renderer3D(canvas, hudCanvas, 'meadow');
renderer.finishHint = 'Back to the room in a few seconds…';
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
radios($('#cars'), 'car', CAR_KINDS, (k) => CAR_KIND_NAMES[k as keyof typeof CAR_KIND_NAMES]);
radios($('#ai'), 'ai', [0, 1, 2, 3], (v) => v);
radios($('#track'), 'track', TRACK_IDS, (v) => TRACK_NAMES[v as TrackId] ?? v);
const lapsPicker = mountLapsPicker($('#laps'), (laps) => {
  if (laps !== lobby?.laps) send({ t: 'settings', laps });
});
joinForm.querySelector<HTMLInputElement>('input[name=car][value=rally]')!.checked = true;

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
  if (!inRace) resetRaceNet();
  joinForm.hidden = !lobby || !!me;
  lobbyEl.hidden = !lobby || !me;
  if (!lobby) return;

  const taken = lobby.players.map((p) => p.color);
  for (const input of joinForm.querySelectorAll<HTMLInputElement>('input[name=color]')) {
    input.disabled = taken.includes(input.value);
    if (input.disabled && input.checked) input.checked = false;
  }
  if (!joinForm.querySelector('input[name=color]:checked')) {
    const free = joinForm.querySelector<HTMLInputElement>('input[name=color]:not(:disabled)');
    if (free) free.checked = true;
  }
  joinForm.querySelector<HTMLButtonElement>('button')!.disabled = lobby.players.length >= MAX_PLAYERS;
  if (!me) return;

  $('#players').innerHTML = lobby.players
    .map(
      (p) => `<li><span class="swatch" style="background:${p.color}"></span><span class="grow">${escapeHtml(p.name)}${
        p.id === myId ? ' <span class="badge">(you)</span>' : ''
      }${p.host ? ' <span class="badge">host</span>' : ''} <span class="badge">${CAR_KIND_NAMES[p.car] ?? 'Rally'}</span></span><span class="${p.ready ? 'ready' : 'badge'}">${p.ready ? 'READY' : 'not ready'}</span></li>`,
    )
    .join('');
  const isHost = me.host;
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=ai]')) {
    input.checked = Number(input.value) === lobby.aiCount;
    input.disabled = !isHost || Number(input.value) > MAX_PLAYERS - lobby.players.length;
  }
  lapsPicker.setValue(lobby.laps);
  lapsPicker.setDisabled(!isHost);
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=track]')) {
    input.checked = input.value === lobby.trackId;
    input.disabled = !isHost;
  }
  const waiting = lobby.players.filter((p) => !p.ready).length;
  $('#status').textContent = `${lobby.players.length} human${lobby.players.length > 1 ? 's' : ''} + ${lobby.aiCount} AI. ${
    waiting ? `Waiting for ${waiting} driver${waiting > 1 ? 's' : ''} to get ready.` : ''
  }${isHost ? '' : ' The host picks AI, laps and track.'}`;
  readyBtn.textContent = me.ready ? 'Ready! (click to cancel)' : 'Ready';
  readyBtn.classList.toggle('on', me.ready);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const color = joinForm.querySelector<HTMLInputElement>('input[name=color]:checked')?.value ?? '';
  const car = joinForm.querySelector<HTMLInputElement>('input[name=car]:checked')?.value === 'f1' ? 'f1' : 'rally';
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
  if (input.name === 'track') send({ t: 'settings', trackId: input.value });
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
  if (remotes.length === 0) renderer.resetRace();
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
  if (e.code === 'KeyU') renderer.toggleCheckpointDebug();
  if (e.code === 'F3') {
    e.preventDefault();
    debugOn = !debugOn;
  }
});

connect();
requestAnimationFrame(frame);
