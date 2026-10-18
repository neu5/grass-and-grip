import './style.css';
import { BINDINGS_SOLO, Keyboard } from './client/input';
import { Renderer3D } from './client/renderer3d';
import { CAR_COLORS, COLOR_NAMES, LAP_OPTIONS, MAX_PLAYERS, type ClientMessage, type LobbyState, type ServerMessage } from './net/protocol';
import { TICK_RATE, type GameState, type PlayerInput } from './sim';

/** Render this many ticks behind the newest snapshot so there is always a pair to interpolate. */
const INTERP_DELAY_TICKS = 6;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer3D(canvas, $<HTMLCanvasElement>('#hud'), 'meadow');
renderer.finishHint = 'Back to the room in a few seconds…';
const keyboard = new Keyboard(window);
const menu = $<HTMLDivElement>('#menu');
const joinForm = $<HTMLFormElement>('#join-form');
const lobbyEl = $<HTMLDivElement>('#lobby');
const readyBtn = $<HTMLButtonElement>('#ready');
const errorEl = $<HTMLParagraphElement>('#error');

const roomId = new URLSearchParams(location.search).get('id') || 'main';
$('#room-id').textContent = roomId;
const nameInput = $<HTMLInputElement>('#name');
nameInput.value = localStorage.getItem('gg-name') ?? '';

let myId = '';
let lobby: LobbyState | null = null;
let snapshots: GameState[] = [];
let tickOffset: number | null = null;
let lastSentInput = '';
let socket: WebSocket;

function radios(container: HTMLElement, name: string, values: readonly (string | number)[], label: (v: string) => string, style?: (v: string) => string) {
  for (const v of values) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="${name}" value="${v}" /><span style="${style?.(String(v)) ?? ''}">${label(String(v))}</span>`;
    container.append(l);
  }
}
radios($('#colors'), 'color', CAR_COLORS, (c) => COLOR_NAMES[c], (c) => `background:${c}33;border-color:${c}`);
radios($('#ai'), 'ai', [0, 1, 2, 3], (v) => v);
radios($('#laps'), 'laps', LAP_OPTIONS, (v) => v);

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  setTimeout(() => (errorEl.hidden = true), 3000);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
  socket.onopen = () => ($('#conn').textContent = 'Connected');
  socket.onclose = () => {
    $('#conn').textContent = 'Disconnected — reconnecting…';
    lobby = null;
    snapshots = [];
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
    } else if (msg.t === 'state') onSnapshot(msg.state);
  };
}

function renderLobby() {
  const me = lobby?.players.find((p) => p.id === myId);
  const inRace = !!lobby && lobby.phase !== 'lobby';
  menu.hidden = inRace;
  if (!inRace) {
    snapshots = [];
    lastSentInput = '';
  }
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
      }${p.host ? ' <span class="badge">host</span>' : ''}</span><span class="${p.ready ? 'ready' : 'badge'}">${p.ready ? 'READY' : 'not ready'}</span></li>`,
    )
    .join('');
  const isHost = me.host;
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=ai]')) {
    input.checked = Number(input.value) === lobby.aiCount;
    input.disabled = !isHost || Number(input.value) > MAX_PLAYERS - lobby.players.length;
  }
  for (const input of lobbyEl.querySelectorAll<HTMLInputElement>('input[name=laps]')) {
    input.checked = Number(input.value) === lobby.laps;
    input.disabled = !isHost;
  }
  const waiting = lobby.players.filter((p) => !p.ready).length;
  $('#status').textContent = `${lobby.players.length} human${lobby.players.length > 1 ? 's' : ''} + ${lobby.aiCount} AI. ${
    waiting ? `Waiting for ${waiting} driver${waiting > 1 ? 's' : ''} to get ready.` : ''
  }${isHost ? '' : ' The host picks AI and laps.'}`;
  readyBtn.textContent = me.ready ? 'Ready! (click to cancel)' : 'Ready';
  readyBtn.classList.toggle('on', me.ready);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const color = joinForm.querySelector<HTMLInputElement>('input[name=color]:checked')?.value ?? '';
  localStorage.setItem('gg-name', nameInput.value.trim());
  send({ t: 'join', name: nameInput.value, color });
});
readyBtn.addEventListener('click', () => {
  const me = lobby?.players.find((p) => p.id === myId);
  send({ t: 'ready', ready: !me?.ready });
});
lobbyEl.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'ai') send({ t: 'settings', aiCount: Number(input.value) });
  if (input.name === 'laps') send({ t: 'settings', laps: Number(input.value) });
});

function onSnapshot(state: GameState) {
  const last = snapshots[snapshots.length - 1];
  if (last && state.tick <= last.tick) {
    snapshots = [];
    tickOffset = null;
  }
  if (snapshots.length === 0) renderer.resetRace();
  snapshots.push(state);
  if (snapshots.length > 30) snapshots.shift();
  renderer.onTick(state);
  const sample = state.tick - (performance.now() * TICK_RATE) / 1000;
  tickOffset = tickOffset === null || Math.abs(sample - tickOffset) > TICK_RATE ? sample : tickOffset + (sample - tickOffset) * 0.05;
}

function myCarId(): number | undefined {
  return lobby?.cars[myId];
}

function sendInput() {
  if (myCarId() === undefined || !menu.hidden) return;
  const input: PlayerInput = keyboard.sample(BINDINGS_SOLO);
  const key = JSON.stringify(input);
  if (key !== lastSentInput) {
    lastSentInput = key;
    send({ t: 'input', input });
  }
}

function frame(now: number) {
  sendInput();
  if (snapshots.length > 0 && tickOffset !== null && menu.hidden) {
    const renderTick = (now * TICK_RATE) / 1000 + tickOffset - INTERP_DELAY_TICKS;
    let i = snapshots.length - 1;
    while (i > 0 && snapshots[i - 1].tick > renderTick) i--;
    const b = snapshots[i];
    const a = snapshots[Math.max(0, i - 1)];
    const alpha = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (renderTick - a.tick) / (b.tick - a.tick)));
    const carId = myCarId();
    renderer.render(a, b, alpha, carId === undefined ? [] : [carId]);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && menu.hidden) renderer.toggleCamera();
});

connect();
requestAnimationFrame(frame);
