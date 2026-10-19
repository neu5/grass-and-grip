# Grass & Grip

A small 3D isometric racing game in the browser, in the spirit of GeneRally. It is rendered with Three.js: low-poly cars, real-time shadows, tyre stacks and trees, with a follow camera and a whole-track overview camera. You race on one track. Asphalt and grass have different grip, the cars slide and drift, and you can race up to three AI opponents. One or two players share a keyboard. Pick **Rally** (default, slides more) or **Formula 1** (faster, more grip); colors stay unique, car type can repeat.

## Run it

```bash
npm install
npm run dev        # http://localhost:47315 (local play) and /room (online)
npm test           # vitest unit tests for the simulation, room, and prediction/queue
npm run typecheck
npm run build      # client build into dist/
npm start          # production: serves dist/ + websocket on $PORT (default 47315)
```

`npm run dev` starts one Node process (`src/server/index.ts`, via `tsx watch`) that runs the game server and mounts Vite as middleware, so the client has hot reload and the websocket lives on the same port.

## Online multiplayer

Open `/room` (or `/room?id=anything` for a separate room) in up to 4 browsers. Each player types a name, picks Rally or Formula 1 plus one of 4 car colors (a color can only be used once per room; two Formula 1s is fine) and joins. The host (first player in the room) picks the number of AI cars (humans + AI ≤ 4) and the lap count. When every human has clicked **Ready**, the race starts with a 5 second countdown on the grid. A few seconds after the race ends, everyone goes back to the room. People who join during a race watch it and take part in the next one.

The server is authoritative. It runs the same `step()` as local play at 60 ticks/s and broadcasts a compact, quantized snapshot 20 times a second. Each client input is tagged with a `seq`/`tick`; the snapshot acks the last seq the server applied. Your own car is predicted locally with `stepOwnCar()` (same physics as `step`), then reconciled on every snapshot by rewinding to the server pose and replaying unacked inputs. Small corrections are blended, not snapped. Other cars render about 100 ms behind the newest snapshot, interpolating between them and briefly extrapolating if a snapshot is late. TCP Nagle is off on the websocket.

```
src/net/protocol.ts     message types, compact snapshot shape, colors, limits
src/net/snapshot.ts     quantize / dequantize race snapshots
src/net/prediction.ts   InputQueue, rewind+replay, smooth corrections
src/net/interpolate.ts  100 ms interpolation buffer + short extrapolate
src/net/room.ts         Room: join/leave, colors, host, settings, ready -> race -> results -> lobby (no I/O, unit-tested)
src/server/index.ts     HTTP + websocket server (/ws?room=id), 60 Hz loop, 20 Hz snaps, serves dist/ in production
src/room.ts             /room page: lobby UI, prediction, interpolation, F3 net overlay
```

`F3` toggles a net debug overlay (ping, snapshot rate, seq/ack).

To fake a bad connection locally (two browser tabs on `/room`):

```bash
FAKE_LAG_MS=150 FAKE_JITTER_MS=40 npm run dev
```

### Deploy

Any host that runs a long-lived Node process with websockets works (Render, Fly.io, Railway). It is a single process, so use one instance. Rooms live in memory.

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Node 20.11 or newer. The server listens on `$PORT`, which these hosts set for you.

On Render, the repo has a `render.yaml` blueprint (free web service, health check `/healthz`): Dashboard → New → Blueprint → pick this repo and branch → Apply. Free instances sleep after ~15 minutes idle, so the first visit takes a moment to wake up. The page connects with `wss://` on the same origin, so no extra configuration is needed. On Fly.io or Railway, use the same two commands (Railway's Nixpacks detects them from `package.json`).

## Controls

| Mode | Drive | Handbrake |
| --- | --- | --- |
| 1 player | Arrows or WASD | Space / Shift |
| 2 players, P1 | Arrows | Right Shift / Enter |
| 2 players, P2 | WASD | Left Shift / Space |

Press `C` to switch between the follow and overview cameras, `R` to restart the race and `Esc` to go back to the menu.

## Architecture

The sim is pure and deterministic, so the online server runs exactly the same code as local play.

```
src/sim/      pure, DOM-free simulation (can run on a server as-is)
  types.ts    GameState, CarState, PlayerInput, TickInputs (plain JSON data)
  sim.ts      createRace(), step(state, inputs) -> new state, standings(), hashState()
  physics.ts  car model (grip, slip, drift), collisions
  track.ts    track definitions, spline centerline, surfaces, checkpoint gates, obstacles (tyres, trees)
  ai.ts       AI driver that outputs PlayerInput just like a human
  dmath.ts    deterministic sin/cos/atan2
src/client/   browser-only code
  renderer3d.ts  Three.js scene: orthographic isometric camera, lights/shadows, car meshes
  trackTexture.ts  paints the grass/asphalt/curb ground texture and the skid-mark layer
  hud.ts      2D canvas overlay: lap times, standings, countdown
  game.ts     fixed-timestep loop, input sampling, input log
tests/        vitest tests for the simulation
```

- **Fixed timestep.** `step()` always advances exactly 1/60 s. The client runs it from an accumulator and interpolates between the previous and current state when rendering.
- **Deterministic.** The sim only uses basic IEEE-754 operations plus its own `dsin`/`dcos`/`datan2`, because `Math.sin` and friends can differ between JS engines. There is no randomness, and time is counted in integer ticks. `hashState()` makes it easy to detect desyncs.
- **Plain data.** State and per-tick inputs (`{ throttle, steer, handbrake }` keyed by car id) survive a JSON round-trip, and a test checks this. `step()` never mutates its input, which makes rollback and replays straightforward. The client also records an `inputLog` with every tick's inputs.
- **Rendering is separate.** The sim is pure 2D (x/y plus heading). The 3D renderer maps sim `(x, y)` to world `(x, 0, z)`. Body roll, skid marks, scenery outside the walls, camera smoothing and the HUD are all client-only and never feed back into the sim. Trees and tyre stacks inside the walls are sim obstacles, so cars really hit them.
- **Laps.** Each track has 8 gates, and gate 0 is the finish line. Gates have to be crossed in order and in the driving direction, so cutting the track or reversing over the line does not count as a lap.
