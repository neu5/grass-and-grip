# Grass & Grip

A small 3D isometric racing game in the browser, in the spirit of GeneRally. It is rendered with Three.js: low-poly cars, real-time shadows, tyre stacks and trees, with a follow camera and a whole-track overview camera. You race on one track. Asphalt and grass have different grip, the cars slide and drift, and you can race up to three AI opponents. One or two players share a keyboard.

## Run it

```bash
npm install
npm run dev        # http://localhost:47315
npm test           # vitest unit tests for the simulation
npm run typecheck
npm run build      # static build into dist/
```

## Controls

| Mode | Drive | Handbrake |
| --- | --- | --- |
| 1 player | Arrows or WASD | Space / Shift |
| 2 players, P1 | Arrows | Right Shift / Enter |
| 2 players, P2 | WASD | Left Shift / Space |

Press `C` to switch between the follow and overview cameras, `R` to restart the race and `Esc` to go back to the menu.

## Architecture

The code is built so online multiplayer (lockstep or server-authoritative) can be added later without a rewrite.

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
