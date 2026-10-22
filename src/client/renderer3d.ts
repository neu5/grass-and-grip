import * as THREE from 'three';
import {
  CARS,
  getTrack,
  heightAt,
  isStoppedInPit,
  needsPitService,
  pitBoxIndex,
  slopeAttitude,
  terrainHeightAt,
  toCarKind,
  BARRIER_HALF,
  missedGate,
  nearestSampleIndex,
  bridgeSpan,
  BRIDGE_DECK_MARGIN,
  inWater,
  WATER_BED,
  WATER_SURFACE,
  type Bridge,
  type CarKind,
  type CarState,
  type GameState,
  type Track,
} from '../sim';
import type { SoundEngine } from './audio';
import { checkpointDebugPose } from './checkpointDebug';
import { soundEvents } from './soundEvents';
import { drawHud, type Label } from './hud';
import { paintTrackSurface, SkidMarks, splitBridgeDecks } from './trackTexture';

export type CameraMode = 'follow' | 'overview';

const ISO_AZIMUTH = Math.PI / 4;
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const CAMERA_DISTANCE = 3000;
const FOLLOW_MIN_EXTENT = 620;
const SURFACE_RES = 2;
const CAR_FALL_GRAVITY = 900;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  return o;
}

const rallyWheelGeo = new THREE.CylinderGeometry(4.6, 4.6, 3.6, 14).rotateX(Math.PI / 2);
const f1WheelGeo = new THREE.CylinderGeometry(5.2, 5.2, 4.4, 14).rotateX(Math.PI / 2);
const wheelMat = std('#151515', { roughness: 0.9 });
const glassMat = std('#1b2633', { roughness: 0.25, metalness: 0.3 });
const carbon = std('#1a1a1a', { roughness: 0.35, metalness: 0.45 });

const CAR_BUILDERS: Record<CarKind, (color: string) => THREE.Group> = {
  rally: buildRallyMesh,
  f1: buildF1Mesh,
  buggy: buildBuggyMesh,
  truck: buildTruckMesh,
  kart: buildKartMesh,
};

function buildCarMesh(color: string, kind: CarKind = 'rally'): THREE.Group {
  const g = (CAR_BUILDERS[kind] ?? buildRallyMesh)(color);
  attachDamageFx(g, kind);
  return g;
}

function addWheels(g: THREE.Group, geo: THREE.BufferGeometry, y: number, spots: [number, number][]) {
  for (const [x, z] of spots) {
    const w = new THREE.Mesh(geo, wheelMat);
    w.position.set(x, y, z);
    g.add(w);
  }
}

function box(g: THREE.Group, mat: THREE.Material, size: [number, number, number], pos: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos);
  g.add(m);
  return m;
}

const buggyWheelGeo = new THREE.CylinderGeometry(6, 6, 5, 14).rotateX(Math.PI / 2);
const truckWheelGeo = new THREE.CylinderGeometry(5.4, 5.4, 4.6, 14).rotateX(Math.PI / 2);
const kartWheelGeo = new THREE.CylinderGeometry(3, 3, 3.2, 12).rotateX(Math.PI / 2);
const cageMat = std('#2b2b2b', { roughness: 0.5, metalness: 0.5 });
const skinMat = std('#e0b48a', { roughness: 0.8 });

/** Open frame, roll cage and fat tyres standing proud of the body. */
function buildBuggyMesh(color: string): THREE.Group {
  const L = CARS.buggy.length;
  const W = CARS.buggy.width;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const paint = std(color, { roughness: 0.5, metalness: 0.1 });
  box(g, paint, [L * 0.8, 3, W * 0.6], [0, 7, 0]);
  box(g, paint, [L * 0.3, 2.4, W * 0.8], [L * 0.38, 6.4, 0]);
  box(g, cageMat, [L * 0.18, 4, W * 0.5], [-L * 0.32, 9.6, 0]);
  // Cage: four posts and a top frame.
  for (const x of [-L * 0.16, L * 0.12]) {
    for (const z of [-W * 0.26, W * 0.26]) box(g, cageMat, [1.2, 9, 1.2], [x, 13, z]);
  }
  box(g, cageMat, [L * 0.32, 1.2, W * 0.56], [-L * 0.02, 17.4, 0]);
  box(g, glassMat, [L * 0.18, 3, W * 0.36], [-L * 0.02, 10.4, 0]);
  addWheels(g, buggyWheelGeo, 6, [
    [-L * 0.34, -W * 0.56],
    [-L * 0.34, W * 0.56],
    [L * 0.32, -W * 0.56],
    [L * 0.32, W * 0.56],
  ]);
  return shadowed(g);
}

/** Tall cab up front, flat bed behind: reads as heavy from far away. */
function buildTruckMesh(color: string): THREE.Group {
  const L = CARS.truck.length;
  const W = CARS.truck.width;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const paint = std(color, { roughness: 0.5, metalness: 0.15 });
  const dark = std('#3a3a3a', { roughness: 0.8 });
  box(g, dark, [L, 3, W * 0.9], [0, 5.5, 0]);
  box(g, paint, [L * 0.34, 12, W], [L * 0.32, 13, 0]);
  box(g, glassMat, [1, 5, W * 0.8], [L * 0.49, 15.5, 0]);
  box(g, paint, [L * 0.6, 2, W], [-L * 0.18, 8, 0]);
  for (const z of [-W / 2, W / 2]) box(g, paint, [L * 0.6, 5, 1], [-L * 0.18, 11, z]);
  box(g, paint, [1, 5, W], [-L * 0.48, 11, 0]);
  box(g, std('#ffd54a', { roughness: 0.4 }), [L * 0.12, 1.2, W * 0.5], [L * 0.32, 19.6, 0]);
  addWheels(g, truckWheelGeo, 5.4, [
    [-L * 0.36, -W / 2],
    [-L * 0.36, W / 2],
    [-L * 0.18, -W / 2],
    [-L * 0.18, W / 2],
    [L * 0.3, -W / 2],
    [L * 0.3, W / 2],
  ]);
  return shadowed(g);
}

/** Low tube frame with the driver sitting on top. */
function buildKartMesh(color: string): THREE.Group {
  const L = CARS.kart.length;
  const W = CARS.kart.width;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const paint = std(color, { roughness: 0.4, metalness: 0.2 });
  box(g, cageMat, [L * 0.9, 1, W * 0.7], [0, 2.4, 0]);
  box(g, paint, [L * 0.26, 2.4, W * 0.8], [L * 0.4, 3.2, 0]);
  for (const z of [-W * 0.42, W * 0.42]) box(g, paint, [L * 0.4, 2, 2], [0, 3.4, z]);
  box(g, paint, [L * 0.18, 4.6, W * 0.46], [-L * 0.08, 5, 0]);
  box(g, paint, [L * 0.2, 5.2, W * 0.44], [-L * 0.06, 9.6, 0]);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), std('#f4f4f4', { roughness: 0.3 }));
  helmet.position.set(-L * 0.04, 14, 0);
  g.add(helmet);
  box(g, skinMat, [1.6, 1, W * 0.5], [L * 0.12, 8.6, 0]);
  addWheels(g, kartWheelGeo, 3, [
    [-L * 0.36, -W / 2],
    [-L * 0.36, W / 2],
    [L * 0.34, -W / 2],
    [L * 0.34, W / 2],
  ]);
  return shadowed(g);
}

const SMOKE_START = 0.16;
const FIRE_START = 0.82;
const MAX_SMOKE_PUFFS = 18;
const puffGeo = new THREE.SphereGeometry(4.4, 6, 5);

function fxMat(color: string, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** Tiny engine fire on very wrecked cars. Smoke puffs are spawned in the renderer. */
function attachDamageFx(car: THREE.Group, kind: CarKind): void {
  const L = CARS[kind].length;
  const fire = new THREE.Group();
  fire.name = 'dmgFire';
  const fireMat = fxMat('#ff6418', 0.92);
  const coreMat = fxMat('#ffdd66', 0.9);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(2.6, 10, 5), fireMat);
  flame.position.set(0, 10, 0);
  const core = new THREE.Mesh(new THREE.ConeGeometry(1.45, 7, 5), coreMat);
  core.position.set(0, 8.6, 0);
  fire.add(flame, core);
  fire.position.set(-L * 0.38, 6.5, 0);
  fire.visible = false;
  car.add(fire);
}

function updateFireFx(mesh: THREE.Group, damage: number, time: number) {
  const fire = mesh.getObjectByName('dmgFire') as THREE.Group | undefined;
  if (!fire) return;
  const dmg = Math.min(1, Math.max(0, damage));
  const burning = dmg >= FIRE_START;
  fire.visible = burning;
  if (burning) {
    const k = (dmg - FIRE_START) / (1 - FIRE_START);
    const flicker = 0.85 + Math.sin(time * 20) * 0.12;
    fire.scale.set(0.85 + k * 0.25, (0.9 + k * 0.35) * flicker, 0.85 + k * 0.25);
  }
}

interface SmokePuff {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  base: number;
  fade: number;
}

function buildRallyMesh(color: string): THREE.Group {
  const L = CARS.rally.length;
  const W = CARS.rally.width;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const paint = std(color, { roughness: 0.45, metalness: 0.15 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(L, 6, W), paint);
  body.position.y = 6.5;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 4, W * 0.8), paint);
  nose.position.set(L * 0.5, 5, 0);
  g.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 5.5, W * 0.78), glassMat);
  cabin.position.set(-L * 0.05, 12, 0);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.3, 1.2, W * 0.7), paint);
  roof.position.set(-L * 0.07, 15.2, 0);
  g.add(roof);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, W + 2), std('#222'));
  wing.position.set(-L * 0.47, 13, 0);
  g.add(wing);
  for (const z of [-W * 0.3, W * 0.3]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 1.5), std('#222'));
    strut.position.set(-L * 0.45, 10.5, z);
    g.add(strut);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.4, 3), std('#ffffff', { roughness: 0.5 }));
  stripe.position.set(0, 9.7, 0);
  g.add(stripe);
  for (const [x, z] of [
    [-L * 0.32, -W / 2],
    [-L * 0.32, W / 2],
    [L * 0.3, -W / 2],
    [L * 0.3, W / 2],
  ]) {
    const w = new THREE.Mesh(rallyWheelGeo, wheelMat);
    w.position.set(x, 4.6, z);
    g.add(w);
  }
  return shadowed(g);
}

/** Low, wide-winged open-wheeler — distinct from the boxy rally body. */
function buildF1Mesh(color: string): THREE.Group {
  const L = CARS.f1.length;
  const W = CARS.f1.width;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const paint = std(color, { roughness: 0.35, metalness: 0.25 });
  const track = W * 0.62;

  const tub = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 3.2, W * 0.38), paint);
  tub.position.set(-L * 0.02, 4.2, 0);
  g.add(tub);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(L * 0.38, 2.2, 3.4), paint);
  nose.position.set(L * 0.32, 3.6, 0);
  g.add(nose);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, 1.4, 2.2), paint);
  tip.position.set(L * 0.52, 3.2, 0);
  g.add(tip);

  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, W * 1.35), carbon);
  frontWing.position.set(L * 0.58, 2.1, 0);
  g.add(frontWing);
  for (const z of [-W * 0.64, W * 0.64]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.2, 0.7), carbon);
    plate.position.set(L * 0.57, 3.2, z);
    g.add(plate);
  }

  for (const z of [-W * 0.28, W * 0.28]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 3.4, 5.2), paint);
    pod.position.set(-L * 0.04, 4.4, z);
    g.add(pod);
  }

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, 3.4, W * 0.28), glassMat);
  cockpit.position.set(-L * 0.04, 6.8, 0);
  g.add(cockpit);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.45, 8, 18).rotateX(Math.PI / 2), carbon);
  halo.position.set(-L * 0.02, 8.4, 0);
  halo.scale.set(1.15, 0.55, 1);
  g.add(halo);

  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, W * 1.2), carbon);
  rearWing.position.set(-L * 0.48, 10.6, 0);
  g.add(rearWing);
  const lowerWing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, W * 1.1), carbon);
  lowerWing.position.set(-L * 0.48, 8.4, 0);
  g.add(lowerWing);
  for (const z of [-W * 0.58, W * 0.58]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(4.4, 8.2, 0.7), carbon);
    plate.position.set(-L * 0.48, 7.2, z);
    g.add(plate);
  }
  for (const z of [-W * 0.22, W * 0.22]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 0.8), carbon);
    strut.position.set(-L * 0.46, 7, z);
    g.add(strut);
  }

  const engineCover = new THREE.Mesh(new THREE.BoxGeometry(L * 0.22, 3.6, W * 0.32), paint);
  engineCover.position.set(-L * 0.28, 6.2, 0);
  g.add(engineCover);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.35, 1.8), std('#ffffff', { roughness: 0.5 }));
  stripe.position.set(0.04 * L, 5.9, 0);
  g.add(stripe);

  for (const [x, z] of [
    [-L * 0.34, -track],
    [-L * 0.34, track],
    [L * 0.34, -track],
    [L * 0.34, track],
  ]) {
    const w = new THREE.Mesh(f1WheelGeo, wheelMat);
    w.position.set(x, 5.2, z);
    g.add(w);
  }
  return shadowed(g);
}

function buildTyreStack(r: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 8, 18).rotateX(Math.PI / 2), std(i % 2 ? '#e8e8e8' : '#1a1a1a'));
    ring.position.y = r * 0.28 + i * r * 0.5;
    g.add(ring);
  }
  return shadowed(g);
}

interface TreeSpot {
  x: number;
  y: number;
  r: number;
  h?: number;
}

const TREE_GREENS = ['#2f6e2a', '#3a7d31', '#2a6326'].map((c) => new THREE.Color(c));

/** All trees as a handful of instanced meshes: one draw call per tree part. */
const SNOW_TOP = new THREE.Color('#eef3f6');

/** Pines; on a snowy map the top tier is white. */
function buildForest(spots: TreeSpot[], winter = false): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 7).translate(0, 0.45, 0), std('#6b4a2b'), spots.length);
  const tiers = [0, 1, 2].map(
    (i) =>
      new THREE.InstancedMesh(
        new THREE.ConeGeometry(1.15 - i * 0.28, 1.3, 9).translate(0, 1.25 + i * 0.75, 0),
        std('#ffffff', { flatShading: true }),
        spots.length,
      ),
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((t, i) => {
    q.setFromAxisAngle(up, i * 1.7);
    m.compose(new THREE.Vector3(t.x, t.h ?? 0, t.y), q, new THREE.Vector3(t.r, t.r, t.r));
    trunk.setMatrixAt(i, m);
    tiers.forEach((tier, k) => {
      tier.setMatrixAt(i, m);
      tier.setColorAt(i, winter && k === 2 ? SNOW_TOP : TREE_GREENS[(i + k) % 3]);
    });
  });
  g.add(trunk, ...tiers);
  return shadowed(g);
}

/** Red and white concrete blocks along each barrier line, riding the ground. */
function buildBarriers(track: Track): THREE.Group {
  const g = new THREE.Group();
  const red = std('#c9372c', { roughness: 0.8 });
  const white = std('#e9e6df', { roughness: 0.85 });
  const block = 22;
  for (const b of track.def.barriers ?? []) {
    const dx = b.b.x - b.a.x;
    const dy = b.b.y - b.a.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / block));
    const angle = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = b.a.x + dx * t;
      const z = b.a.y + dy * t;
      const m = new THREE.Mesh(new THREE.BoxGeometry((len / n) * 0.96, 9, BARRIER_HALF * 2), i % 2 ? white : red);
      m.position.set(x, terrainHeightAt(track, x, z) + 4, z);
      m.rotation.y = -angle;
      g.add(m);
    }
  }
  return shadowed(g);
}

const coneMat = std('#ff6a1a', { roughness: 0.6 });
const coneBandMat = std('#f4f4f4', { roughness: 0.5 });
const coneBaseMat = std('#262626', { roughness: 0.8 });

/** Traffic cone, base on the ground at the origin. */
function buildConeMesh(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = new THREE.Group();
  body.name = 'body';
  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 10), coneBaseMat);
  base.position.y = 0.6;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 10), coneMat);
  cone.position.y = 7.4;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 3.05, 2.2, 10), coneBandMat);
  band.position.y = 7.6;
  body.add(base, cone, band);
  g.add(body);
  return shadowed(g);
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCrewPerson(shirt: string): THREE.Group {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const skin = std('#e6c8a8');
  const pants = std('#2a2c34');
  const cloth = std(shirt);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(2.1, 5.2, 2.3), pants);
  leftLeg.position.set(0, 2.6, -1.25);
  leftLeg.name = 'leftLeg';
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(2.1, 5.2, 2.3), pants);
  rightLeg.position.set(0, 2.6, 1.25);
  rightLeg.name = 'rightLeg';
  g.add(leftLeg, rightLeg);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(3.5, 5, 4.1), cloth);
  torso.position.set(0, 7.9, 0);
  g.add(torso);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 4.8, 1.7), cloth);
  leftArm.position.set(0, 7.5, -3);
  leftArm.name = 'leftArm';
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 4.8, 1.7), cloth);
  rightArm.position.set(0, 7.5, 3);
  rightArm.name = 'rightArm';
  g.add(leftArm, rightArm);

  const head = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.1, 3.1), skin);
  head.position.set(0, 12, 0);
  g.add(head);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 3.4), std('#f3f3f3'));
  lid.position.set(0, 13.4, 0);
  g.add(lid);
  return shadowed(g);
}

const CREW_SHIRTS = ['#f2f2f2', '#d32f2f', '#1e88e5', '#f9a825'];

interface CrewActor {
  mesh: THREE.Group;
  restX: number;
  restY: number;
  x: number;
  y: number;
  heading: number;
  box: number;
  slot: number;
  phase: number;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
}

function spawnCrew(track: Track): CrewActor[] {
  const crew: CrewActor[] = [];
  track.def.pitBoxes.forEach((b, box) => {
    for (let slot = 0; slot < 2; slot++) {
      const restX = b.x + b.w * (0.28 + slot * 0.44);
      const restY = b.y - 12;
      const mesh = buildCrewPerson(CREW_SHIRTS[(box * 2 + slot) % CREW_SHIRTS.length]);
      mesh.position.set(restX, terrainHeightAt(track, restX, restY), restY);
      crew.push({
        mesh,
        restX,
        restY,
        x: restX,
        y: restY,
        heading: Math.PI / 2,
        box,
        slot,
        phase: 0,
        leftLeg: mesh.getObjectByName('leftLeg')!,
        rightLeg: mesh.getObjectByName('rightLeg')!,
        leftArm: mesh.getObjectByName('leftArm')!,
        rightArm: mesh.getObjectByName('rightArm')!,
      });
    }
  });
  return crew;
}

function buildPitDecor(track: Track): THREE.Group {
  const g = new THREE.Group();
  const lane = track.def.pitLane;
  const curbH = terrainHeightAt(track, lane.x + lane.w / 2, lane.y + 2);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(lane.w, 3.2, 4), std('#d5d0c6'));
  curb.position.set(lane.x + lane.w / 2, curbH + 1.6, lane.y + 2);
  g.add(curb);
  const paint = std('#f6f6f6');
  const t = 1.8;
  const h = 0.7;
  for (const b of track.def.pitBoxes) {
    const segs: [number, number, number, number][] = [
      [b.x + b.w / 2, b.y, b.w, t],
      [b.x + b.w / 2, b.y + b.h, b.w, t],
      [b.x, b.y + b.h / 2, t, b.h],
      [b.x + b.w, b.y + b.h / 2, t, b.h],
    ];
    for (const [x, z, w, d] of segs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint);
      m.position.set(x, terrainHeightAt(track, x, z) + h / 2, z);
      g.add(m);
    }
  }
  return shadowed(g);
}

function crewTarget(actor: CrewActor, car: CarState | null, serving: boolean): { x: number; y: number } {
  if (!car || !serving) return { x: actor.restX, y: actor.restY };
  const ca = Math.cos(car.angle);
  const sa = Math.sin(car.angle);
  // Wall side of the stalls is -y, which is to the car's right when heading +x.
  const rx = sa;
  const ry = -ca;
  if (actor.slot === 0) {
    return { x: car.x + rx * 16, y: car.y + ry * 16 };
  }
  return { x: car.x - ca * 18 + rx * 8, y: car.y - sa * 18 + ry * 8 };
}

const CHECKPOINT_DEBUG_HEIGHT = 48;

function checkpointDebugMat(color: string, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Translucent planes + poles on the exact sim checkpoint lines. Hidden until U. */
function buildCheckpointDebug(track: Track): THREE.Group {
  const g = new THREE.Group();
  g.name = 'checkpointDebug';
  g.visible = false;
  const finishPlane = checkpointDebugMat('#f4f7ff', 0.42);
  const sectorPlane = checkpointDebugMat('#3ec8ff', 0.34);
  const finishPole = checkpointDebugMat('#fff7e0', 0.85);
  const sectorPole = checkpointDebugMat('#b9ecff', 0.7);
  const H = CHECKPOINT_DEBUG_HEIGHT;
  track.gates.forEach((gate, i) => {
    const pose = checkpointDebugPose(gate, i);
    const ground = terrainHeightAt(track, pose.cx, pose.cz);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(pose.width, H), pose.finish ? finishPlane : sectorPlane);
    plane.position.set(pose.cx, ground + H / 2, pose.cz);
    plane.rotation.y = pose.yaw;
    g.add(plane);
    for (const [x, z] of [
      [pose.ax, pose.az],
      [pose.bx, pose.bz],
    ]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, H, 6), pose.finish ? finishPole : sectorPole);
      pole.position.set(x, ground + H / 2, z);
      g.add(pole);
    }
  });
  return g;
}

function buildGantry(track: Track): THREE.Group {
  const g = new THREE.Group();
  const gate = track.gates[0];
  const off = track.def.halfWidth + 20;
  const nx = (gate.b.x - gate.a.x) / 2;
  const ny = (gate.b.y - gate.a.y) / 2;
  const len = Math.sqrt(nx * nx + ny * ny);
  const ux = nx / len;
  const uy = ny / len;
  const ground = terrainHeightAt(track, gate.center.x, gate.center.y);
  const postMat = std('#d9d9d9', { metalness: 0.4, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 58, 8), postMat);
    post.position.set(gate.center.x + ux * off * s, ground + 29, gate.center.y + uy * off * s);
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(off * 2 + 6, 12, 2),
    [std('#c9342b'), std('#c9342b'), std('#c9342b'), std('#c9342b'), std('#fff', { map: checkerTexture() }), std('#fff', { map: checkerTexture() })],
  );
  banner.position.set(gate.center.x, ground + 56, gate.center.y);
  banner.rotation.y = -Math.atan2(uy, ux);
  g.add(banner);
  return shadowed(g);
}

/** Ground level beyond the boundary wall: the map's base, so it does not sit on a plateau. */
function outsideLevel(track: Track): number {
  return track.def.terrain?.base ?? 0;
}

/** Boundary wall riding the ground; its outer face reaches down to the outside grass. */
function buildWalls(track: Track): THREE.Group {
  const g = new THREE.Group();
  const { width, height } = track.def;
  const t = 10;
  const h = 12;
  const mat = std('#cfcac0', { roughness: 0.95, side: THREE.DoubleSide });
  // Each side: start, end, and the outward direction.
  const sides: [number, number, number, number, number, number][] = [
    [-t, 0, width + t, 0, 0, -1],
    [-t, height, width + t, height, 0, 1],
    [0, -t, 0, height + t, -1, 0],
    [width, -t, width, height + t, 1, 0],
  ];
  for (const [x0, z0, x1, z1, ox, oz] of sides) {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8);
    const inner: THREE.Vector3[] = [];
    const innerTop: THREE.Vector3[] = [];
    const outerTop: THREE.Vector3[] = [];
    const outer: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const z = z0 + ((z1 - z0) * i) / steps;
      const ground = terrainHeightAt(track, Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, z)));
      inner.push(new THREE.Vector3(x, ground - 2, z));
      innerTop.push(new THREE.Vector3(x, ground + h, z));
      outerTop.push(new THREE.Vector3(x + ox * t, ground + h, z + oz * t));
      outer.push(new THREE.Vector3(x + ox * t, outsideLevel(track) - 1, z + oz * t));
    }
    g.add(sheet(inner, innerTop, mat), sheet(innerTop, outerTop, mat), sheet(outerTop, outer, mat));
  }
  return shadowed(g);
}

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Cosmetic trees outside the walls; cars can never reach them, so they stay client-only. */
function sceneryTrees(width: number, height: number): TreeSpot[] {
  const rand = seededRandom(7);
  const margin = 40;
  const spots: TreeSpot[] = [];
  for (let i = 0; i < 260; i++) {
    const x = -700 + rand() * (width + 1400);
    const y = -700 + rand() * (height + 1400);
    const r = 14 + rand() * 10;
    if (x > -margin && x < width + margin && y > -margin && y < height + margin) continue;
    spots.push({ x, y, r });
  }
  return spots;
}

function buildHeightGround(track: Track, map: THREE.Texture): THREE.Mesh {
  const { width, height } = track.def;
  const geo = new THREE.PlaneGeometry(width, height, 400, 262);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + width / 2;
    const wz = pos.getZ(i) + height / 2;
    pos.setY(i, terrainHeightAt(track, wx, wz));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, std('#fff', { map, roughness: 0.95 }));
  mesh.position.set(width / 2, 0, height / 2);
  mesh.receiveShadow = true;
  return mesh;
}

function buildWater(track: Track): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: '#1c6aa6',
    roughness: 0.16,
    metalness: 0.28,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // A ribbon a little wider than the river; the banks rise over its edges.
  for (const r of track.rivers) {
    const pts = r.points;
    const side = (s: number) =>
      pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const off = s * (r.halfWidth + 10);
        return new THREE.Vector3(p.x - ((b.y - a.y) / len) * off, WATER_SURFACE, p.y + ((b.x - a.x) / len) * off);
      });
    const mesh = sheet(side(-1), side(1), mat);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

function buildBridges(track: Track, decks: THREE.Texture[]): THREE.Group {
  const g = new THREE.Group();
  (track.def.bridges ?? []).forEach((b, i) => g.add(buildBridge(track, b, decks[i])));
  return shadowed(g);
}

/** Quads between two matching polylines. */
function sheet(a: THREE.Vector3[], b: THREE.Vector3[], mat: THREE.Material, uv?: (p: THREE.Vector3) => [number, number]) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < a.length; k++) {
    for (const p of [a[k], b[k]]) {
      pos.push(p.x, p.y, p.z);
      if (uv) uvs.push(...uv(p));
    }
    if (k > 0) {
      const v = k * 2;
      idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function tube(points: THREE.Vector3[], radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 8), mat);
}

/** Box from `bottom` up to `top`, centred on (x, z), turned to `angle`. */
function pillar(x: number, z: number, bottom: number, top: number, w: number, d: number, angle: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, top - bottom, d), mat);
  m.position.set(x, (top + bottom) / 2, z);
  m.rotation.y = -angle;
  return m;
}

/**
 * Deck that follows the road: painted asphalt, raised footways, railings and
 * lamps on top; girders, a steel arch with spandrel posts and concrete
 * abutments below.
 */
function buildBridge(track: Track, b: Bridge, deckTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const span = bridgeSpan(track, b);
  if (span.length < 2) return g;
  const H = b.height;
  const hw = track.def.halfWidth;
  const road = hw + 9;
  const edge = hw + BRIDGE_DECK_MARGIN;
  const under = H - 5;
  const girderBottom = H - 13;
  const girderOff = hw - 10;

  const asphalt = std('#fff', { map: deckTex, roughness: 0.9, side: THREE.DoubleSide });
  const concrete = std('#c3beb3', { roughness: 0.95, side: THREE.DoubleSide });
  const fascia = std('#9c978d', { roughness: 0.9, side: THREE.DoubleSide });
  const steel = std('#b8452c', { roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
  const rail = std('#dfe3e8', { roughness: 0.35, metalness: 0.6 });
  const lampMat = std('#3b3f45', { roughness: 0.5, metalness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffe2a0', emissiveIntensity: 1.2 });

  const at = (k: number, off: number, y: number) => {
    const i = span[k];
    const p = track.samples[i];
    const n = track.normals[i];
    return new THREE.Vector3(p.x + n.x * off, y, p.y + n.y * off);
  };
  const line = (off: number, y: number) => span.map((_, k) => at(k, off, y));
  const deckUv = (p: THREE.Vector3): [number, number] => [(p.x - b.x) / b.w, 1 - (p.z - b.y) / b.h];

  // Deck: road paint, curbs up to footways, footways, outer faces, underside.
  g.add(sheet(line(-road, H + 0.3), line(road, H + 0.3), asphalt, deckUv));
  for (const s of [-1, 1]) {
    g.add(sheet(line(s * road, H + 0.3), line(s * road, H + 1.8), concrete));
    g.add(sheet(line(s * road, H + 1.8), line(s * edge, H + 1.8), concrete));
    g.add(sheet(line(s * edge, H + 1.8), line(s * edge, under), steel));
    // Girder under each wheel track.
    const o = s * girderOff;
    g.add(sheet(line(o - 5, under), line(o - 5, girderBottom), steel));
    g.add(sheet(line(o + 5, under), line(o + 5, girderBottom), steel));
    g.add(sheet(line(o - 5, girderBottom), line(o + 5, girderBottom), steel));
  }
  g.add(sheet(line(-edge, under), line(edge, under), fascia));

  // Railings: posts, a top rail and a mid rail on both edges.
  for (const s of [-1, 1]) {
    const off = s * (edge - 1.5);
    for (let k = 0; k < span.length; k += 3) {
      const p = at(k, off, 0);
      g.add(pillar(p.x, p.z, H + 1.8, H + 9, 1.6, 1.6, 0, rail));
    }
    g.add(tube(line(off, H + 9), 0.9, rail));
    g.add(tube(line(off, H + 5.4), 0.55, rail));
  }

  // Lamps on alternating sides.
  for (const [t, s] of [
    [0.2, 1],
    [0.5, -1],
    [0.8, 1],
  ] as const) {
    const k = Math.round(t * (span.length - 1));
    const base = at(k, s * (edge - 4), H + 1.8);
    const head = at(k, s * (edge - 12), H + 22);
    g.add(pillar(base.x, base.z, base.y, H + 23, 1.4, 1.4, 0, lampMat));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lampMat);
    arm.position.set((base.x + head.x) / 2, H + 23, (base.z + head.z) / 2);
    arm.scale.set(Math.hypot(head.x - base.x, head.z - base.z), 1, 1.2);
    arm.rotation.y = -Math.atan2(head.z - base.z, head.x - base.x);
    g.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 3), glow);
    bulb.position.set(head.x, H + 22, head.z);
    bulb.rotation.y = arm.rotation.y;
    g.add(bulb);
  }

  // Stretch over water: arch springs from the abutments at each bank.
  const wet = span.map((i) => inWater(track, track.samples[i].x, track.samples[i].y));
  const ws = wet.indexOf(true);
  const we = wet.lastIndexOf(true);
  if (ws < 0) return g;
  const a0 = Math.max(0, ws - 1);
  const a1 = Math.min(span.length - 1, we + 1);
  for (const k of [a0, a1]) {
    const i = span[k];
    const p = track.samples[i];
    g.add(pillar(p.x, p.y, WATER_BED - 2, under, 14, edge * 2 + 26, track.tangentAngles[i], concrete));
  }
  const spring = WATER_SURFACE + 1;
  const crown = under - 1;
  const archY = (k: number) => {
    const t = (k - a0) / (a1 - a0);
    return spring + (crown - spring) * (1 - (2 * t - 1) * (2 * t - 1));
  };
  // Ribs sit under the deck edges so they show from the side.
  const ribOff = edge - 5;
  for (const s of [-1, 1]) {
    const o = s * ribOff;
    const pts: THREE.Vector3[] = [];
    for (let k = a0; k <= a1; k++) pts.push(at(k, o, archY(k)));
    g.add(tube(pts, 3, steel));
    for (let k = a0 + 3; k <= a1 - 3; k += 3) {
      const y = archY(k);
      if (under - y < 2) continue;
      const p = at(k, o, 0);
      g.add(pillar(p.x, p.z, y, under, 2.4, 2.4, track.tangentAngles[span[k]], steel));
    }
  }
  // Cross bracing between the two arch ribs.
  for (const t of [0.25, 0.5, 0.75]) {
    const k = Math.round(a0 + t * (a1 - a0));
    g.add(tube([at(k, -ribOff, archY(k)), at(k, ribOff, archY(k))], 1.4, steel));
  }
  return g;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose?.();
  });
}

export class Renderer3D {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
  private camDir = new THREE.Vector3(
    Math.sin(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION),
    Math.sin(ISO_ELEVATION),
    Math.cos(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION),
  );
  private camTarget = new THREE.Vector3();
  /** Optional sound; the renderer feeds it states and the listening point. */
  sound: SoundEngine | null = null;
  private lastTick: GameState | null = null;

  /** Where the player "hears" from: the camera's focus on the ground. */
  private listener(): { x: number; y: number } {
    return { x: this.camTarget.x, y: this.camTarget.z };
  }
  private camHalfHeight = 400;
  private camInitialized = false;
  private track: Track;
  private world = new THREE.Group();
  private skids!: SkidMarks;
  private skidTexture!: THREE.CanvasTexture;
  private skidUploadTick = 0;
  private carMeshes: THREE.Group[] = [];
  private carKeys: string[] = [];
  private carPitch: number[] = [];
  private carRoll: number[] = [];
  /** Shown car height and fall speed, so drops off the deck are not a snap. */
  private carY: number[] = [];
  private coneMeshes: THREE.Group[] = [];
  private carVy: number[] = [];
  private crew: CrewActor[] = [];
  private hud: CanvasRenderingContext2D;
  private lastFrame = performance.now();
  private smokePuffs: SmokePuff[] = [];
  private puffWait: number[] = [];
  private checkpointDebug!: THREE.Group;
  cameraMode: CameraMode = 'follow';
  finishHint = 'Press R to race again · Esc for menu';
  keyHints = true;

  constructor(
    private glCanvas: HTMLCanvasElement,
    private hudCanvas: HTMLCanvasElement,
    trackId: string,
  ) {
    this.track = getTrack(trackId);
    this.hud = hudCanvas.getContext('2d')!;

    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#9fd3f0');

    this.scene.add(new THREE.HemisphereLight('#dff1ff', '#3d5a2a', 1.15));
    const { width, height } = this.track.def;
    const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(width / 2 - 600, 760, height / 2 - 800);
    sun.target.position.set(width / 2, 0, height / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1300, right: 1300, top: 1300, bottom: -1300, near: 10, far: 4000 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.scene.add(this.world);
    this.buildWorld();
  }

  get trackId(): string {
    return this.track.def.id;
  }

  /** `force` rebuilds even for the same id (the editor changed it). */
  setTrack(trackId: string, force = false) {
    if (this.track.def.id === trackId && !force) return;
    this.track = getTrack(trackId);
    this.buildWorld();
    this.resetRace();
  }

  private canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    return t;
  }

  private buildWorld() {
    const debugOn = this.checkpointDebug?.visible ?? false;
    while (this.world.children.length) {
      const child = this.world.children[0];
      this.world.remove(child);
      disposeObject(child);
    }
    const { width, height } = this.track.def;

    // Grass beyond the wall: a frame around the map, so it never covers low ground inside.
    const far = 4500;
    const frame = new THREE.Shape([
      new THREE.Vector2(width / 2 - far, height / 2 - far),
      new THREE.Vector2(width / 2 + far, height / 2 - far),
      new THREE.Vector2(width / 2 + far, height / 2 + far),
      new THREE.Vector2(width / 2 - far, height / 2 + far),
    ]);
    frame.holes.push(new THREE.Path([new THREE.Vector2(0, 0), new THREE.Vector2(0, height), new THREE.Vector2(width, height), new THREE.Vector2(width, 0)]));
    const outer = new THREE.Mesh(new THREE.ShapeGeometry(frame).rotateX(Math.PI / 2), std(this.track.def.ground === 'snow' ? '#e3eaef' : '#4b9c40', { roughness: 1, side: THREE.DoubleSide }));
    outer.position.y = outsideLevel(this.track) - 0.5;
    outer.receiveShadow = true;
    this.world.add(outer);

    const surface = paintTrackSurface(this.track, SURFACE_RES);
    const deckTex = splitBridgeDecks(surface, this.track, SURFACE_RES).map((c) => this.canvasTexture(c));
    this.world.add(buildHeightGround(this.track, this.canvasTexture(surface)));
    this.world.add(buildWater(this.track));
    this.world.add(buildBridges(this.track, deckTex));

    this.skids = new SkidMarks(width, height);
    this.skidTexture = new THREE.CanvasTexture(this.skids.canvas);
    this.skidTexture.colorSpace = THREE.SRGBColorSpace;
    const skidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.skidTexture, transparent: true, depthWrite: false, roughness: 1 }),
    );
    skidPlane.position.set(width / 2, 0.35, height / 2);
    skidPlane.receiveShadow = true;
    this.world.add(skidPlane);

    const trees: TreeSpot[] = sceneryTrees(width, height).map((t) => ({ ...t, h: outsideLevel(this.track) }));
    for (const o of this.track.def.obstacles) {
      const h = terrainHeightAt(this.track, o.x, o.y);
      if (o.kind === 'tree') {
        trees.push({ ...o, h });
        continue;
      }
      const mesh = buildTyreStack(o.r);
      mesh.position.set(o.x, h, o.y);
      this.world.add(mesh);
    }
    this.crew = spawnCrew(this.track);
    for (const c of this.crew) this.world.add(c.mesh);
    this.checkpointDebug = buildCheckpointDebug(this.track);
    this.checkpointDebug.visible = debugOn;
    this.world.add(buildPitDecor(this.track), buildGantry(this.track), buildWalls(this.track), buildBarriers(this.track), buildForest(trees, this.track.def.ground === 'snow'), this.checkpointDebug);
  }

  resetRace() {
    this.lastTick = null;
    this.sound?.silence();
    const ctx = this.skids.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.skids.canvas.width, this.skids.canvas.height);
    this.skidTexture.needsUpdate = true;
    this.camInitialized = false;
    this.puffWait = [];
    this.carPitch = this.carPitch.map(() => 0);
    this.carRoll = this.carRoll.map(() => 0);
    this.carY = [];
    this.carVy = [];
    for (const p of this.smokePuffs) {
      p.age = p.life;
      p.mesh.visible = false;
    }
    for (const actor of this.crew) {
      actor.x = actor.restX;
      actor.y = actor.restY;
      actor.heading = Math.PI / 2;
      actor.phase = 0;
      actor.mesh.position.set(actor.x, terrainHeightAt(this.track, actor.x, actor.y), actor.y);
      actor.mesh.rotation.y = -actor.heading;
    }
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'follow' ? 'overview' : 'follow';
  }

  toggleCheckpointDebug() {
    this.checkpointDebug.visible = !this.checkpointDebug.visible;
  }

  private updateCrew(state: GameState, dt: number) {
    const occupants: (CarState | null)[] = this.track.def.pitBoxes.map(() => null);
    for (const car of state.cars) {
      if (!isStoppedInPit(this.track, car) || !needsPitService(car)) continue;
      const idx = pitBoxIndex(this.track, car.x, car.y);
      if (idx >= 0 && !occupants[idx]) occupants[idx] = car;
    }
    const stepDt = Math.min(0.08, Math.max(0, dt));
    for (const actor of this.crew) {
      const car = occupants[actor.box];
      const serving = !!car;
      const goal = crewTarget(actor, car, serving);
      const dx = goal.x - actor.x;
      const dy = goal.y - actor.y;
      const dist = Math.hypot(dx, dy);
      const speed = serving ? 125 : 70;
      if (dist > 1) {
        const step = Math.min(dist, speed * stepDt);
        actor.x += (dx / dist) * step;
        actor.y += (dy / dist) * step;
        actor.heading = Math.atan2(dy, dx);
        actor.phase += step * 0.55;
      } else {
        actor.phase *= 0.72;
        if (car) actor.heading = Math.atan2(car.y - actor.y, car.x - actor.x);
      }
      const swing = Math.sin(actor.phase) * Math.min(0.7, dist / 8 + Math.abs(actor.phase) * 0.08);
      actor.leftLeg.rotation.z = swing;
      actor.rightLeg.rotation.z = -swing;
      actor.leftArm.rotation.z = -swing * 0.7;
      actor.rightArm.rotation.z = swing * 0.7;
      actor.mesh.position.set(actor.x, terrainHeightAt(this.track, actor.x, actor.y), actor.y);
      actor.mesh.rotation.y = -actor.heading;
    }
  }

  /** Called once per simulated tick. */
  onTick(state: GameState) {
    if (this.sound) {
      if (this.lastTick && this.lastTick.trackId === state.trackId && state.tick > this.lastTick.tick) {
        this.sound.play(soundEvents(this.lastTick, state), state, this.listener());
      }
      this.lastTick = state;
    }
    this.skids.update(state);
    if (this.skids.dirty && state.tick - this.skidUploadTick >= 4) {
      this.skidTexture.needsUpdate = true;
      this.skids.dirty = false;
      this.skidUploadTick = state.tick;
    }
  }

  /** Cones follow the sim; knocked-over ones lie on their side. */
  private updateCones(prev: GameState, curr: GameState, alpha: number) {
    const props = curr.props ?? [];
    while (this.coneMeshes.length < props.length) {
      const m = buildConeMesh();
      this.scene.add(m);
      this.coneMeshes.push(m);
    }
    while (this.coneMeshes.length > props.length) this.scene.remove(this.coneMeshes.pop()!);
    props.forEach((b, i) => {
      const a = prev.props?.[i] ?? b;
      const x = a.x + (b.x - a.x) * alpha;
      const z = a.y + (b.y - a.y) * alpha;
      const m = this.coneMeshes[i];
      const ground = terrainHeightAt(this.track, x, z);
      m.position.set(x, ground + (b.down ? 4 : 0), z);
      m.rotation.y = -(a.angle + (b.angle - a.angle) * alpha);
      m.rotation.z = b.down ? Math.PI / 2 : 0;
    });
  }

  private syncCars(state: GameState) {
    const keys = state.cars.map((c) => `${c.kind ?? 'rally'}:${c.color}`);
    if (keys.join() === this.carKeys.join()) return;
    for (const m of this.carMeshes) this.scene.remove(m);
    this.carMeshes = state.cars.map((c) => buildCarMesh(c.color, toCarKind(c.kind)));
    for (const m of this.carMeshes) this.scene.add(m);
    this.carKeys = keys;
    this.carPitch = this.carMeshes.map(() => 0);
    this.carRoll = this.carMeshes.map(() => 0);
    this.carY = [];
    this.carVy = [];
  }

  private resize(): { w: number; h: number } {
    const w = this.glCanvas.clientWidth;
    const h = this.glCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.gl.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.gl.setSize(w, h, false);
    if (this.hudCanvas.width !== Math.round(w * dpr) || this.hudCanvas.height !== Math.round(h * dpr)) {
      this.hudCanvas.width = Math.round(w * dpr);
      this.hudCanvas.height = Math.round(h * dpr);
    }
    this.hud.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  /** Camera-space right/up axes for the fixed isometric view direction. */
  private viewAxes() {
    const right = new THREE.Vector3(0, 1, 0).cross(this.camDir).normalize();
    const up = this.camDir.clone().cross(right).normalize();
    return { right, up };
  }

  private frame(points: THREE.Vector3[], aspect: number, minExtent: number, pad: number) {
    const { right, up } = this.viewAxes();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const x = p.dot(right);
      const y = p.dot(up);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const halfH = Math.max(minExtent / 2, (maxY - minY) / 2 + pad, ((maxX - minX) / 2 + pad) / aspect);
    const base = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length);
    const shift = right.clone().multiplyScalar(cx - base.dot(right)).add(up.clone().multiplyScalar(cy - base.dot(up)));
    return { target: base.add(shift), halfH };
  }

  private updateCamera(positions: THREE.Vector3[], humanIds: number[], aspect: number, frameDt?: number) {
    // A hidden canvas has no size; framing it would poison the camera with NaN.
    if (!(aspect > 0)) return;
    const { width, height } = this.track.def;
    const overview = this.frame(
      [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(width, 0, 0),
        new THREE.Vector3(0, 0, height),
        new THREE.Vector3(width, 0, height),
        new THREE.Vector3(width / 2, 80, 0),
      ],
      aspect,
      0,
      20,
    );
    let goal = overview;
    if (this.cameraMode === 'follow' && humanIds.length > 0) {
      const focus = this.frame(
        humanIds.map((id) => positions[id]),
        aspect,
        FOLLOW_MIN_EXTENT,
        160,
      );
      goal = focus.halfH < overview.halfH ? focus : overview;
    }
    const now = performance.now();
    const dt = frameDt ?? Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const k = this.camInitialized ? 1 - Math.exp(-dt * 4) : 1;
    this.camInitialized = true;
    this.camTarget.lerp(goal.target, k);
    this.camHalfHeight += (goal.halfH - this.camHalfHeight) * k;

    const cam = this.camera;
    cam.top = this.camHalfHeight;
    cam.bottom = -this.camHalfHeight;
    cam.left = -this.camHalfHeight * aspect;
    cam.right = this.camHalfHeight * aspect;
    cam.position.copy(this.camTarget).addScaledVector(this.camDir, CAMERA_DISTANCE);
    cam.lookAt(this.camTarget);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private spawnSmokePuff(x: number, z: number, angle: number, denser: number, kind: CarKind, ground = 0) {
    let puff = this.smokePuffs.find((p) => p.age >= p.life);
    if (!puff) {
      if (this.smokePuffs.length >= MAX_SMOKE_PUFFS) return;
      const mesh = new THREE.Mesh(puffGeo, fxMat('#3a3a3a', 0.42));
      this.scene.add(mesh);
      puff = { mesh, age: 0, life: 1, vx: 0, vy: 0, vz: 0, base: 1, fade: 0.42 };
      this.smokePuffs.push(puff);
    }
    const L = CARS[toCarKind(kind)].length;
    const rear = L * 0.38;
    const jitter = 2.2;
    puff.age = 0;
    puff.life = 1.35 + Math.random() * 0.5;
    puff.base = 0.85 + denser * 0.4 + Math.random() * 0.1;
    puff.fade = 0.42 + denser * 0.16;
    puff.vx = -Math.cos(angle) * 6 + (Math.random() - 0.5) * 8;
    puff.vz = -Math.sin(angle) * 6 + (Math.random() - 0.5) * 8;
    puff.vy = 14 + denser * 6 + Math.random() * 6;
    puff.mesh.visible = true;
    puff.mesh.position.set(x - Math.cos(angle) * rear + (Math.random() - 0.5) * jitter, ground + 9, z - Math.sin(angle) * rear + (Math.random() - 0.5) * jitter);
    puff.mesh.scale.setScalar(puff.base);
    (puff.mesh.material as THREE.MeshBasicMaterial).opacity = puff.fade;
  }

  private updateSmokePuffs(prev: GameState, curr: GameState, alpha: number, dt: number) {
    const stepDt = Math.min(0.08, Math.max(0, dt));
    for (const p of this.smokePuffs) {
      if (p.age >= p.life) {
        p.mesh.visible = false;
        continue;
      }
      p.age += stepDt;
      const t = Math.min(1, p.age / p.life);
      p.mesh.position.x += p.vx * stepDt;
      p.mesh.position.y += p.vy * stepDt;
      p.mesh.position.z += p.vz * stepDt;
      p.mesh.scale.setScalar(p.base * (1 + t * 0.7));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.fade * (1 - t);
      p.mesh.visible = t < 1;
    }
    while (this.puffWait.length < curr.cars.length) this.puffWait.push(0.2);
    for (let i = 0; i < curr.cars.length; i++) {
      const a = prev.cars[i] ?? curr.cars[i];
      const b = curr.cars[i];
      const dmg = (a.damage ?? 0) + ((b.damage ?? 0) - (a.damage ?? 0)) * alpha;
      if (dmg < SMOKE_START) {
        this.puffWait[i] = 0.25;
        continue;
      }
      const k = Math.min(1, (dmg - SMOKE_START) / (1 - SMOKE_START));
      const interval = 2.2 - k * 1.5;
      this.puffWait[i] -= stepDt;
      if (this.puffWait[i] > 0) continue;
      this.puffWait[i] = interval;
      const x = a.x + (b.x - a.x) * alpha;
      const y = a.y + (b.y - a.y) * alpha;
      const angle = lerpAngle(a.angle, b.angle, alpha);
      this.spawnSmokePuff(x, y, angle, k, b.kind, heightAt(this.track, x, y));
    }
  }

  /** `frameDt` overrides wall-clock camera smoothing, e.g. for offline capture. */
  render(prev: GameState, curr: GameState, alpha: number, humanIds: number[], frameDt?: number) {
    this.syncCars(curr);
    this.updateCones(prev, curr, alpha);
    const { w, h } = this.resize();
    const positions: THREE.Vector3[] = [];
    const dt = frameDt ?? Math.min(0.1, (performance.now() - this.lastFrame) / 1000);

    for (let i = 0; i < curr.cars.length; i++) {
      const a = prev.cars[i] ?? curr.cars[i];
      const b = curr.cars[i];
      const x = a.x + (b.x - a.x) * alpha;
      const y = a.y + (b.y - a.y) * alpha;
      const angle = lerpAngle(a.angle, b.angle, alpha);
      const h = heightAt(this.track, x, y);
      const mesh = this.carMeshes[i];
      const slope = slopeAttitude(this.track, x, y, angle);
      const follow = 1 - Math.exp(-dt * 12);
      const targetRoll = slope.roll + bodyRoll(b);
      if (this.carPitch[i] == null) {
        this.carPitch[i] = slope.pitch;
        this.carRoll[i] = targetRoll;
      } else {
        this.carPitch[i] += (slope.pitch - this.carPitch[i]) * follow;
        this.carRoll[i] += (targetRoll - this.carRoll[i]) * follow;
      }
      // Drop under gravity (off the deck, into the lake); climb straight away.
      const lastY = this.carY[i];
      if (lastY == null || h >= lastY) {
        this.carY[i] = h;
        this.carVy[i] = 0;
      } else {
        this.carVy[i] = (this.carVy[i] ?? 0) + CAR_FALL_GRAVITY * dt;
        this.carY[i] = Math.max(h, lastY - this.carVy[i] * dt);
      }
      const carY = this.carY[i];
      mesh.position.set(x, carY, y);
      mesh.rotation.y = -angle;
      mesh.rotation.x = this.carRoll[i];
      mesh.rotation.z = this.carPitch[i];
      const dmg = (a.damage ?? 0) + ((b.damage ?? 0) - (a.damage ?? 0)) * alpha;
      updateFireFx(mesh, dmg, performance.now() / 1000);
      positions.push(new THREE.Vector3(x, carY, y));
    }

    this.updateSmokePuffs(prev, curr, alpha, dt);
    this.updateCrew(curr, dt);
    this.updateCamera(positions, humanIds, w / Math.max(1, h), frameDt);
    this.sound?.update(curr, this.track, this.listener(), true);
    this.gl.render(this.scene, this.camera);

    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    };
    const labels: Label[] = humanIds.map((id) => {
      const at = toScreen(positions[id].clone().setY(positions[id].y + 34));
      const label: Label = { text: curr.cars[id].name, x: at.x, y: at.y };
      const car = curr.cars[id];
      if (curr.phase === 'racing' && car.finishTick === null) {
        const idx = nearestSampleIndex(this.track, car.x, car.y);
        if (missedGate(this.track, car, idx)) {
          const gate = this.track.gates[car.nextCheckpoint];
          const from = toScreen(positions[id]);
          const to = toScreen(new THREE.Vector3(gate.center.x, terrainHeightAt(this.track, gate.center.x, gate.center.y), gate.center.y));
          const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
          label.missed = { dx: (to.x - from.x) / len, dy: (to.y - from.y) / len };
        }
      }
      return label;
    });
    this.hud.clearRect(0, 0, w, h);
    drawHud(
      this.hud,
      curr,
      humanIds,
      w,
      h,
      alpha,
      labels,
      this.cameraMode === 'follow' ? 'Follow' : 'Overview',
      this.finishHint,
      this.keyHints,
    );
  }
}

function bodyRoll(car: CarState): number {
  const lateral = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
  return Math.max(-0.14, Math.min(0.14, lateral / 1800));
}
