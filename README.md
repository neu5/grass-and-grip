# Grass & Grip

A small 3D isometric racing game in the browser, in the spirit of GeneRally. It is rendered with Three.js: low-poly cars, real-time shadows, tyre stacks and trees, with a follow camera and a whole-track overview camera. Three tracks: **Meadow Ring** (asphalt vs grass), **Harbor Bridge** (hills, a winding river crossed by two arch bridges, sand run-offs, and a left-hand hairpin) and **Alpine Pass** (the one large map: snow everywhere off the road, a frozen pond, a strip of black ice across the tarmac, gravel traps backed by red-and-white barriers, and traffic cones on the apexes that go flying when clipped). Surfaces, from most to least grip: asphalt, gravel, grass, snow, sand, water, ice; ice has almost no drag either, so a slide keeps going. Water is strong drag, not grass. Sand is looser and slides more than grass. Pick the track in the local menu, or the host picks it in `/room`. You can race up to eight cars (humans + AI). One or two players share a keyboard locally, each with their own name and car color (remembered in the browser; the two can't share a color, and AI drivers take the names and colors left over); online rooms take 1–8 humans and AI fills the rest (humans + AI ≤ 8). Eight car colors stay unique. Pick from five cars, and a car type can repeat. They are balanced to lap within a few percent of each other on average, each with its own strengths: **Rally** (default all-rounder, slides more), **Formula 1** (a touch quicker on tarmac, but fragile and hopeless on grass, sand or snow), **Buggy** (a little slower on tarmac, by far the best off the road, sturdy), **Truck** (heavy: slow to turn and stop, hard to hurt, shoves others aside) or **Kart** (tiny and twitchy, quickest in tight corners, lowest top speed, dislikes grass). The grid can be Mixed or one-make. **Car setup** has three steps from −2 to +2 each: gearing (acceleration vs top speed), steering (slow vs quick) and wings (low drag vs grip). **Race options** set damage, tyre wear and fuel use to off, normal or double, and car-to-car contact to on or off; the HUD hides bars for anything turned off. Hard braking, slides and grass wear tyres (HUD 100% fresh → 0% worn); worn tyres grip and brake less. Fuel starts at 100% and burns with throttle (idle/coast less); a lighter tank is a bit quicker, empty fuel is slower. Hitting a wall, tree, tyre stack or another car adds crash damage (HUD 100% healthy → 0% wrecked); bigger hits hurt more, grazes little. A damaged car loses some accel and top speed; only a near-wreck crawls, and it still steers. Small smoke puffs come off a hurt car (more often as damage rises); a little fire only when it is very broken. Stop in a pit box (four marked stalls off the start/finish straight) to refill fuel, tyres and body together over a couple of seconds; crew run in while you sit still. AI drivers follow a precomputed racing line (outside-inside-outside, straight through S-bends) at a speed plan worked out for their own car and setup, slow down on worn tyres, counter-steer slides, pass slower cars on the side with room (not mid-corner), back off when boxed in, and wriggle free if they get stuck. If an AI drives past a checkpoint without crossing it, it turns back and drives through it; a human who misses one gets an arrow and a "go back" warning. When a human crosses the line onto the last lap (in races of two or more laps), a big **FINAL LAP** banner shows for a couple of seconds and the lap counter turns yellow until the flag. **AI level** is Easy / Medium / Hard (40 / 70 / 90%) or any custom percentage: higher levels drive closer to the plan, wander less off the line, make fewer late-braking mistakes and leave smaller gaps when passing. AI peels in when fuel is near empty, tyres are worn out, or the car is very broken — it stays at race pace on the racing line, then slows only in the pit lane, sits until the bars recover, and rejoins. It does not pit every lap, and it will skip or wait in the pit lane if every stall is busy.

**Starting grid**: a single local race and every online room race line the cars up in a random order, shuffled again on every start, so you will not always start on pole.

**Championship** (local play): pick Championship in the menu and tick the tracks to race, in order. The same drivers, cars and options run every round; each race scores 10-8-6-5-4-3-2-1, and ties are split on wins, then on the best finishes. The first round starts from a random grid; every later round lines up in championship order, the leader on pole and last place at the back. After each race a results screen shows the race and the championship table; the last one shows a podium. The season is saved in the browser, so **Continue championship** picks it up after a reload or Esc.

**Track editor** (`/editor`): draw your own track on a top-down map, Small (1200 × 800), Medium (1600 × 1050, the size of the built-in tracks) or Large (2200 × 1450). Changing the size stretches or shrinks the design to fit; the start line and pits stay in the top-left corner. Tools: **Road** (click to add points, drag to shape, right-click to remove; point 1 is the start line on the straight by the pits), **Hills** (scroll for size, Shift+scroll for height, below zero digs a dip), **River** (bridges appear on their own where the road crosses), **Paint** (gravel, sand, snow, ice or grass areas, optionally over the road), **Objects** (trees, tyre stacks, cones) and **Barriers**. A live check lists anything that would make the track unraceable (road running into itself, corners too tight, water without a bridge, a tree on the road, the start away from the pits) and circles it on the map. **3D view** shows the real thing, **Save & race** stores it in the browser and opens it in the menu; tracks can also be exported and imported as JSON files. Custom tracks show up in the local track picker and championships, and the host of an online room can pick one of theirs: the server checks it and sends it to everyone in the room.

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

Open `/room` (or `/room?id=anything` for a separate room) in up to 8 browsers. Each player types a name, picks a car plus one of 8 car colors (a color can only be used once per room; repeated car types are fine) and joins. In the lobby each player can change their own car setup. The host (first player in the room) picks the number of AI cars (humans + AI ≤ 8), the AI level, the lap count (1–99), the track, the grid (mixed or one-make) and the race options. Fastest laps are kept two ways. The race HUD shows **this race's** top 3 (every race starts empty) with the **track record** under it: the best lap ever on that map, flagged **NEW RECORD** when someone beats it mid-race. The menu and lobby show each track's all-time top 3 (**Fastest laps ever**). Local play stores the all-time list in `localStorage`; an online room keeps it in server memory for the session and each client also writes it locally so a refresh does not wipe it. The results screen after a single race names the race's fastest lap and the track record, or says it was broken. When every human has clicked **Ready**, the race starts with a 5 second countdown on the grid. The start snapshot includes the track id so every client loads the same map. A few seconds after the race ends, everyone goes back to the room. People who join during a race watch it and take part in the next one.

The server is authoritative. It runs the same `step()` as local play at 60 ticks/s and broadcasts a compact, quantized snapshot 20 times a second. Each client input is tagged with a `seq`/`tick`; the snapshot acks the last seq the server applied. Your own car is predicted locally with `stepOwnCar()` (same physics as `step`), then reconciled on every snapshot by rewinding to the server pose and replaying unacked inputs. Small corrections are blended, not snapped. Other cars render about 100 ms behind the newest snapshot, interpolating between them and briefly extrapolating if a snapshot is late. TCP Nagle is off on the websocket.

```
src/net/protocol.ts     message types, compact snapshot shape, colors, limits
src/net/snapshot.ts     quantize / dequantize race snapshots
src/net/prediction.ts   InputQueue, rewind+replay, smooth corrections
src/net/interpolate.ts  100 ms interpolation buffer + short extrapolate
src/net/room.ts         Room: join/leave, colors, host, settings, ready -> race -> results -> lobby (no I/O, unit-tested)
src/server/index.ts     HTTP + websocket server (/ws?room=id), 60 Hz loop, 20 Hz snaps, serves dist/ in production
src/room.ts             /room page: lobby UI, prediction, interpolation, F3 net overlay
src/editor.ts           /editor page: track editor
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

All sound is synthesised in the browser (no audio files): each of the four cars nearest the camera has an engine note that climbs through fake gears with speed (a deep truck, a screaming kart), tyres squeal when sliding on tarmac or ice, loose ground rumbles, and crashes, flying cones, the pit crew's air guns, the countdown beeps, lap and finish chimes, and a three-ding bell when the leader starts the last lap all have their own sounds. Sound starts on the first click or key press; `M` mutes it and the choice is remembered.

Press `C` to switch between the follow and overview cameras, `U` to toggle checkpoint-gate debug, `R` to restart the race and `Esc` to go back to the menu.

On a phone (coarse pointer, or a mobile browser with touch) play is landscape-only. The game tries to lock orientation and enter fullscreen (first tap, **CAM**, or **FULL**). If the lock fails, a blocking **Rotate phone** screen stays up until the device is actually landscape — portrait is not playable. Left thumb steers: put it down anywhere on the left half of the screen and slide it left or right (a ring shows where it landed; about a thumb's width of travel is full lock, and resting it where it landed drives straight). Right thumb works the pedals: **GAS**, **BRAKE** (brakes, then reverses when stopped) and **HANDBRAKE** above them; you can slide from one pedal to another. **CAM** at the top switches the camera like `C`, **FULL** goes fullscreen, and **MENU** (local races) quits to the menu. On short screens the HUD shrinks to a small driver card (position, lap, times, thin T/F/D bars) and a slim standings list. After a single race a results screen shows the finishing order with **Race again** and **Back to menu** buttons (on any device; `R` still restarts on a keyboard). Desktop keyboards stay as above — no overlay. `/room` lobby buttons are larger for fingers.

## Architecture

The sim is pure and deterministic, so the online server runs exactly the same code as local play.

```
src/sim/      pure, DOM-free simulation (can run on a server as-is)
  types.ts    GameState, CarState, PlayerInput, TickInputs, FastestLap (plain JSON data)
  fastestLaps.ts  insert/sort/cap the top 3 completed laps (ties keep the earlier time); new-record check
  sim.ts      createRace(), step(state, inputs) -> new state, standings(), hashState()
  physics.ts  car model (grip, slip, drift, tyre wear, fuel, crash damage), collisions
  pits.ts     pit-box service: stopped-in-box check, incremental fuel + tyre + body refill
  track.ts    track definitions (Meadow Ring, Harbor Bridge), spline centerline, surfaces (asphalt/grass/sand/water), height, bridges, checkpoint gates, obstacles, pit boxes
  ai.ts       AI driver that outputs PlayerInput just like a human (racing line, passing, missed-gate recovery, pit stops)
  racingLine.ts  minimum-curvature racing line, per-car speed plan, missed-checkpoint check
  trackTools.ts  editor support: starter track, auto bridges, validation, safe parsing of shared tracks
  dmath.ts    deterministic sin/cos/atan2
src/client/   browser-only code
  renderer3d.ts  Three.js scene: orthographic isometric camera, lights/shadows, car meshes
  trackTexture.ts  paints the grass/asphalt/curb ground texture and the skid-mark layer
  audio.ts    Web Audio synth: engines, squeal, rumble, one-shots; soundEvents.ts turns state changes into one-shots
  hud.ts      2D canvas overlay: lap times, standings, this race's fastest laps plus the track record, tyre wear, fuel, damage, countdown
  game.ts     fixed-timestep loop, input sampling, input log
  championship.ts  season rounds, points table with countback, save/resume
tests/        vitest tests for the simulation
```

- **Fixed timestep.** `step()` always advances exactly 1/60 s. The client runs it from an accumulator and interpolates between the previous and current state when rendering.
- **Deterministic.** The sim only uses basic IEEE-754 operations plus its own `dsin`/`dcos`/`datan2`, because `Math.sin` and friends can differ between JS engines. There is no randomness, and time is counted in integer ticks. `hashState()` makes it easy to detect desyncs.
- **Plain data.** State and per-tick inputs (`{ throttle, steer, handbrake }` keyed by car id) survive a JSON round-trip, and a test checks this. `step()` never mutates its input, which makes rollback and replays straightforward. The client also records an `inputLog` with every tick's inputs.
- **Rendering is separate.** The sim is pure 2D (x/y plus heading). The 3D renderer maps sim `(x, y)` to world `(x, 0, z)`. Body roll, skid marks, scenery outside the walls, camera smoothing and the HUD are all client-only and never feed back into the sim. Trees and tyre stacks inside the walls are sim obstacles, so cars really hit them.
- **Laps.** Each track has 8 gates, and gate 0 is the finish line. Gates have to be crossed in order and in the driving direction, so cutting the track or reversing over the line does not count as a lap.
