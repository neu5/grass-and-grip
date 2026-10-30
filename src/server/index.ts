import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { getTrack, racingLine, TICK_RATE, TRACK_IDS } from '../sim';
import type { ClientMessage, ServerMessage } from '../net/protocol';
import { SNAPSHOT_HZ } from '../net/protocol';
import { snapshotText } from '../net/snapshot';
import { Room } from '../net/room';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 47315);
const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const SNAP_EVERY = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_HZ));
const FAKE_LAG_MS = Math.max(0, Number(process.env.FAKE_LAG_MS ?? 0) || 0);
const FAKE_JITTER_MS = Math.max(0, Number(process.env.FAKE_JITTER_MS ?? 0) || 0);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (path === '/') path = '/index.html';
  if (!extname(path)) path += '.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
});
server.on('connection', (sock) => sock.setNoDelay(true));

if (PROD) {
  server.on('request', (req, res) => req.url !== '/healthz' && serveStatic(req, res));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: ROOT, appType: 'mpa', server: { middlewareMode: true, hmr: { server } } });
  server.on('request', (req, res) => req.url !== '/healthz' && vite.middlewares(req, res));
}

interface Client {
  id: string;
  room: Room;
  socket: WebSocket;
}

const rooms = new Map<string, Room>();
const clients = new Set<Client>();
const sentVersion = new Map<Room, number>();
let nextId = 1;

function lagMs(): number {
  if (FAKE_LAG_MS <= 0 && FAKE_JITTER_MS <= 0) return 0;
  const jitter = FAKE_JITTER_MS > 0 ? (Math.random() * 2 - 1) * FAKE_JITTER_MS : 0;
  return Math.max(0, FAKE_LAG_MS + jitter);
}

function later(fn: () => void): void {
  const ms = lagMs();
  if (ms <= 0) fn();
  else setTimeout(fn, ms);
}

function send(socket: WebSocket, msg: ServerMessage) {
  sendRaw(socket, JSON.stringify(msg));
}

function sendRaw(socket: WebSocket, text: string) {
  later(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  });
}

/** The latest race state to every client in the room: encoded once, with each client's own input ack. */
function sendSnapshot(room: Room) {
  if (!room.race) return;
  const text = snapshotText(room.race);
  for (const c of clients) if (c.room === room) sendRaw(c.socket, text(room.ackOf(c.id)));
}

function broadcast(room: Room, msg: ServerMessage) {
  for (const c of clients) if (c.room === room) send(c.socket, msg);
}

function roomFor(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id);
    rooms.set(id, room);
  }
  return room;
}

function handle(client: Client, msg: ClientMessage) {
  const { room, id } = client;
  let error: string | null = null;
  switch (msg.t) {
    case 'join':
      error = room.join(id, msg.name, msg.color, msg.car, msg.setup);
      break;
    case 'ready':
      error = room.setReady(id, msg.ready);
      break;
    case 'settings':
      error = room.setSettings(id, msg);
      break;
    case 'setup':
      error = room.setSetup(id, msg.setup);
      break;
    case 'input':
      room.setInput(id, msg.input, msg.seq);
      break;
    case 'ping':
      send(client.socket, { t: 'pong', t0: msg.t0 });
      break;
  }
  if (error) send(client.socket, { t: 'error', message: error });
}

function disableNagle(ws: WebSocket) {
  const sock = (ws as WebSocket & { _socket?: Socket })._socket;
  sock?.setNoDelay(true);
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') return;
  (socket as Socket).setNoDelay?.(true);
  wss.handleUpgrade(req, socket, head, (ws) => {
    disableNagle(ws);
    const roomId = (url.searchParams.get('room') || 'main').slice(0, 32);
    const client: Client = { id: String(nextId++), room: roomFor(roomId), socket: ws };
    clients.add(client);
    send(ws, { t: 'welcome', id: client.id });
    send(ws, { t: 'lobby', lobby: client.room.view() });
    ws.on('message', (data) => {
      later(() => {
        try {
          handle(client, JSON.parse(String(data)) as ClientMessage);
        } catch {
          send(ws, { t: 'error', message: 'Bad message' });
        }
      });
    });
    ws.on('close', () => {
      clients.delete(client);
      client.room.leave(client.id);
      if (![...clients].some((c) => c.room === client.room)) {
        rooms.delete(client.room.id);
        sentVersion.delete(client.room);
      }
    });
  });
});

const TICK_MS = 1000 / TICK_RATE;
let simTime = performance.now();
function loop() {
  const now = performance.now();
  if (now - simTime > 250) simTime = now - TICK_MS;
  // Rooms due a snapshot. After a stall several ticks run back to back; only the newest state is sent.
  const due = new Set<Room>();
  while (simTime + TICK_MS <= now) {
    simTime += TICK_MS;
    for (const room of rooms.values()) {
      if (room.tick() && room.race && room.race.tick % SNAP_EVERY === 0) due.add(room);
    }
  }
  for (const room of due) sendSnapshot(room);
  for (const room of rooms.values()) {
    if (sentVersion.get(room) !== room.version) {
      sentVersion.set(room, room.version);
      broadcast(room, { t: 'lobby', lobby: room.view() });
    }
  }
  setTimeout(loop, 4);
}
loop();

/** Build every map and its racing line ahead of time, one per turn of the event loop, so the first race on a map doesn't stall every room. */
function warmTracks(ids: readonly string[]) {
  const [id, ...rest] = ids;
  if (!id) return;
  racingLine(getTrack(id));
  setTimeout(() => warmTracks(rest), 50);
}

server.listen(PORT, () => {
  warmTracks(TRACK_IDS);
  const lag = FAKE_LAG_MS ? `  fake lag ${FAKE_LAG_MS}ms ±${FAKE_JITTER_MS}ms` : '';
  console.log(`Grass & Grip ${PROD ? '' : 'dev '}server on http://localhost:${PORT}  (online lobby: /room)${lag}`);
});
