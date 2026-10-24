# Grass & Grip

A 3D isometric racing game for the browser, in the spirit of GeneRally. Up to eight cars (humans + AI) race on local keyboards, phones or online rooms. Built with TypeScript and Three.js.

## Tracks

| Track | Size | Character |
| --- | --- | --- |
| Red Canyon | Small | Desert switchbacks between rock ridges and two mesas |
| Meadow Ring | Small | Quick loop round a pond, S-bends, sand traps |
| Old Town | Medium | Walled figure-8 street circuit; one street crosses the other on a flyover |
| Harbor Bridge | Medium | Quay road along the sea, two bridges over dock channels |
| Jungle Temple | Medium | Dirt road through rainforest, mud holes, river bridge, temple ruins |
| Harvest Rally | Medium | Gravel farm lanes round fields, hay bales, barn and fences |
| Alpine Pass | Large | Snow, double hairpin, mountain sweeper, frozen lake, black ice |
| Grand Prix | Large | F1-style circuit with kerbs, gravel traps, run-off and grandstands |

Each track has its own theme (sky, ground, trees, barriers, road markings), its own start line and pit lane. Surfaces from most to least grip: asphalt, dirt, gravel, grass, snow, mud, sand, water, ice. Ice barely slows you, so slides keep going.

## Racing

- **Cars:** Rally (all-rounder), Formula 1 (quick on tarmac, fragile, hopeless off it), Buggy (best off-road), Truck (heavy, sturdy, shoves others) and Kart (twitchy, quick in tight corners). They lap within a few percent of each other on average. The grid can be mixed or one car type only.
- **Setup:** gearing, steering and wings, each from −2 to +2.
- **Options:** damage, tyre wear and fuel use (off, normal, double) and car-to-car contact. Worn tyres, low fuel and damage all slow you down. Stop in a pit box to refill everything.
- **AI:** Easy, Medium, Hard or any percentage. AI cars follow a racing line, pass on the side with room, pit when they need to, and go back if they miss a checkpoint.
- **Laps:** 8 checkpoints per lap, crossed in order. A **FINAL LAP** banner shows when you start your last lap.
- **Starting grid:** random for a single race and online. In a championship, the first race is random and later races line up by points.
- **Championship:** pick tracks in order. Races score 10-8-6-5-4-3-2-1 and ties go to wins, then best finishes. Saved in the browser.
- **Lap records:** the HUD shows this race's top 3 and the track record. The menu shows the all-time top 3 per track. Records are kept in the browser and reset when a track's layout changes.

## Track editor

Open `/editor` to draw a small, medium or large track. Tools: road points, hills, rivers (bridges appear automatically), painted surfaces, objects (trees, tyres, cones, rocks, hay) and barriers. You can also set the ground, road (asphalt or dirt) and theme. A live check marks anything unraceable. **Save & race** opens the track in the menu, tracks can be exported and imported as JSON, and an online host can race them.

## Controls

| Mode | Drive | Handbrake |
| --- | --- | --- |
| 1 player | Arrows or WASD | Space / Shift |
| 2 players, P1 | Arrows | Right Shift / Enter |
| 2 players, P2 | WASD | Left Shift / Space |

`C` camera (follow / overview), `M` mute, `R` restart, `Esc` menu, `U` checkpoint debug, `F3` net overlay (online).

**Phones** play in landscape. Slide your left thumb anywhere on the left half to steer, and use the right-hand pedals for gas, brake/reverse and handbrake. **CAM** and **FULL** buttons sit at the top, plus **MENU** in local races.

## Run it

```bash
npm install
npm run dev        # http://localhost:47315 (local) and /room (online)
npm test
npm run typecheck
npm run build
npm start          # production: serves dist/ + websocket on $PORT (default 47315)
```

`npm run dev` runs one Node process that hosts the game server with Vite as middleware, so hot reload and the websocket share a port.

## Online

Open `/room` (or `/room?id=name` for a separate room) in up to eight browsers. Each player picks a name, color, car and setup. The host (the first player in the room) sets AI count, AI level, laps, track, grid and options. The race starts when everyone is ready.

The server is authoritative: it runs the same `step()` at 60 ticks/s and sends compact snapshots 20 times a second. Your own car is predicted locally and reconciled against the server. Other cars are interpolated about 100 ms behind. To test a bad connection:

```bash
FAKE_LAG_MS=150 FAKE_JITTER_MS=40 npm run dev
```

**Deploy:** any host that runs one long-lived Node process with websockets (Render, Fly.io, Railway). Build with `npm ci --include=dev && npm run build`, start with `npm start`. Use Node 20.11+. On Render, use the included `render.yaml` blueprint.

## Architecture

```
src/sim/      pure, deterministic simulation (also runs on the server)
  sim.ts        createRace(), step(), standings()
  physics.ts    car model, surfaces, wear, fuel, damage, collisions
  track.ts      centerline, surfaces, heights, bridges and flyovers, gates, pits
  maps/         the built-in tracks, one file each
  ai.ts         AI driver; racingLine.ts plans its line and speeds
  trackTools.ts editor support: validation, auto bridges, safe parsing
src/client/   browser only: Three.js renderer, scenery, themes, HUD, sound, input, touch controls
src/net/      protocol, snapshots, prediction, interpolation, rooms
src/server/   HTTP + websocket server
tests/        vitest
```

- **Fixed timestep:** `step()` always advances exactly 1/60 s. The client interpolates between states when it renders.
- **Deterministic:** the sim uses its own sin/cos/atan2, counts time in integer ticks and uses no randomness, so every machine computes the same race. `hashState()` detects desyncs.
- **Plain data:** state and inputs are JSON. `step()` never changes its input, which keeps rollback and replay simple.
- **Rendering stays separate:** the sim is 2D. Visual effects, scenery and the HUD never feed back into it.
