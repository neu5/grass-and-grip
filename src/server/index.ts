import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { TICK_RATE } from '../sim';
import type { ClientMessage, ServerMessage } from '../net/protocol';
import { Room } from '../net/room';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 47315);
const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
/** Race snapshots go out every Nth sim tick. */
const BROADCAST_EVERY = 2;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
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

const server = createServer();

if (PROD) {
  server.on('request', serveStatic);
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: ROOT, appType: 'mpa', server: { middlewareMode: true, hmr: { server } } });
  server.on('request', (req, res) => vite.middlewares(req, res));
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

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.room === room && c.socket.readyState === WebSocket.OPEN) c.socket.send(data);
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
      error = room.join(id, msg.name, msg.color);
      break;
    case 'ready':
      error = room.setReady(id, msg.ready);
      break;
    case 'settings':
      error = room.setSettings(id, msg);
      break;
    case 'input':
      room.setInput(id, msg.input);
      break;
  }
  if (error) send(client.socket, { t: 'error', message: error });
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    const roomId = (url.searchParams.get('room') || 'main').slice(0, 32);
    const client: Client = { id: String(nextId++), room: roomFor(roomId), socket: ws };
    clients.add(client);
    send(ws, { t: 'welcome', id: client.id });
    send(ws, { t: 'lobby', lobby: client.room.view() });
    ws.on('message', (data) => {
      try {
        handle(client, JSON.parse(String(data)) as ClientMessage);
      } catch {
        send(ws, { t: 'error', message: 'Bad message' });
      }
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
  while (simTime + TICK_MS <= now) {
    simTime += TICK_MS;
    for (const room of rooms.values()) {
      if (room.tick() && room.race && room.race.tick % BROADCAST_EVERY === 0) broadcast(room, { t: 'state', state: room.race });
    }
  }
  for (const room of rooms.values()) {
    if (sentVersion.get(room) !== room.version) {
      sentVersion.set(room, room.version);
      broadcast(room, { t: 'lobby', lobby: room.view() });
    }
  }
  setTimeout(loop, 4);
}
loop();

server.listen(PORT, () => {
  console.log(`Grass & Grip ${PROD ? '' : 'dev '}server on http://localhost:${PORT}  (online lobby: /room)`);
});
