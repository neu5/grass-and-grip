import * as THREE from 'three';
import { CARS, getTrack, type CarKind, type CarState, type GameState, type Track } from '../sim';
import { drawHud, type Label } from './hud';
import { paintTrackSurface, SkidMarks } from './trackTexture';

export type CameraMode = 'follow' | 'overview';

const ISO_AZIMUTH = Math.PI / 4;
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const CAMERA_DISTANCE = 3000;
const FOLLOW_MIN_EXTENT = 620;
const SURFACE_RES = 2;

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

function buildCarMesh(color: string, kind: CarKind = 'rally'): THREE.Group {
  return kind === 'f1' ? buildF1Mesh(color) : buildRallyMesh(color);
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
}

const TREE_GREENS = ['#2f6e2a', '#3a7d31', '#2a6326'].map((c) => new THREE.Color(c));

/** All trees as a handful of instanced meshes: one draw call per tree part. */
function buildForest(spots: TreeSpot[]): THREE.Group {
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
    m.compose(new THREE.Vector3(t.x, 0, t.y), q, new THREE.Vector3(t.r, t.r, t.r));
    trunk.setMatrixAt(i, m);
    tiers.forEach((tier, k) => {
      tier.setMatrixAt(i, m);
      tier.setColorAt(i, TREE_GREENS[(i + k) % 3]);
    });
  });
  g.add(trunk, ...tiers);
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

function buildGantry(track: Track): THREE.Group {
  const g = new THREE.Group();
  const gate = track.gates[0];
  const off = track.def.halfWidth + 20;
  const nx = (gate.b.x - gate.a.x) / 2;
  const ny = (gate.b.y - gate.a.y) / 2;
  const len = Math.sqrt(nx * nx + ny * ny);
  const ux = nx / len;
  const uy = ny / len;
  const postMat = std('#d9d9d9', { metalness: 0.4, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 58, 8), postMat);
    post.position.set(gate.center.x + ux * off * s, 29, gate.center.y + uy * off * s);
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(off * 2 + 6, 12, 2),
    [std('#c9342b'), std('#c9342b'), std('#c9342b'), std('#c9342b'), std('#fff', { map: checkerTexture() }), std('#fff', { map: checkerTexture() })],
  );
  banner.position.set(gate.center.x, 56, gate.center.y);
  banner.rotation.y = -Math.atan2(uy, ux);
  g.add(banner);
  return shadowed(g);
}

function buildWalls(width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const t = 10;
  const h = 12;
  const segs: [number, number, number, number][] = [
    [width / 2, -t / 2, width + t * 2, t],
    [width / 2, height + t / 2, width + t * 2, t],
    [-t / 2, height / 2, t, height],
    [width + t / 2, height / 2, t, height],
  ];
  const mat = std('#cfcac0', { roughness: 0.95 });
  for (const [x, z, w, d] of segs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    wall.position.set(x, h / 2, z);
    g.add(wall);
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
  private camHalfHeight = 400;
  private camInitialized = false;
  private track: Track;
  private skids: SkidMarks;
  private skidTexture: THREE.CanvasTexture;
  private skidUploadTick = 0;
  private carMeshes: THREE.Group[] = [];
  private carKeys: string[] = [];
  private hud: CanvasRenderingContext2D;
  private lastFrame = performance.now();
  cameraMode: CameraMode = 'follow';
  finishHint = 'Press R to race again · Esc for menu';

  constructor(
    private glCanvas: HTMLCanvasElement,
    private hudCanvas: HTMLCanvasElement,
    trackId: string,
  ) {
    this.track = getTrack(trackId);
    const { width, height } = this.track.def;
    this.hud = hudCanvas.getContext('2d')!;

    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#9fd3f0');

    this.scene.add(new THREE.HemisphereLight('#dff1ff', '#3d5a2a', 1.4));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(width / 2 - 500, 1100, height / 2 - 700);
    sun.target.position.set(width / 2, 0, height / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1300, right: 1300, top: 1300, bottom: -1300, near: 10, far: 4000 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), std('#4b9c40', { roughness: 1 }));
    outer.position.set(width / 2, -0.5, height / 2);
    outer.receiveShadow = true;
    this.scene.add(outer);

    const surfaceTex = new THREE.CanvasTexture(paintTrackSurface(this.track, SURFACE_RES));
    surfaceTex.colorSpace = THREE.SRGBColorSpace;
    surfaceTex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2), std('#fff', { map: surfaceTex, roughness: 0.95 }));
    ground.position.set(width / 2, 0, height / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.skids = new SkidMarks(width, height);
    this.skidTexture = new THREE.CanvasTexture(this.skids.canvas);
    this.skidTexture.colorSpace = THREE.SRGBColorSpace;
    const skidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.skidTexture, transparent: true, depthWrite: false, roughness: 1 }),
    );
    skidPlane.position.set(width / 2, 0.3, height / 2);
    skidPlane.receiveShadow = true;
    this.scene.add(skidPlane);

    const trees: TreeSpot[] = sceneryTrees(width, height);
    for (const o of this.track.def.obstacles) {
      if (o.kind === 'tree') {
        trees.push(o);
        continue;
      }
      const mesh = buildTyreStack(o.r);
      mesh.position.set(o.x, 0, o.y);
      this.scene.add(mesh);
    }
    this.scene.add(buildGantry(this.track), buildWalls(width, height), buildForest(trees));
  }

  resetRace() {
    const ctx = this.skids.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.skids.canvas.width, this.skids.canvas.height);
    this.skidTexture.needsUpdate = true;
    this.camInitialized = false;
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'follow' ? 'overview' : 'follow';
  }

  /** Called once per simulated tick. */
  onTick(state: GameState) {
    this.skids.update(state);
    if (this.skids.dirty && state.tick - this.skidUploadTick >= 4) {
      this.skidTexture.needsUpdate = true;
      this.skids.dirty = false;
      this.skidUploadTick = state.tick;
    }
  }

  private syncCars(state: GameState) {
    const keys = state.cars.map((c) => `${c.kind ?? 'rally'}:${c.color}`);
    if (keys.join() === this.carKeys.join()) return;
    for (const m of this.carMeshes) this.scene.remove(m);
    this.carMeshes = state.cars.map((c) => buildCarMesh(c.color, c.kind === 'f1' ? 'f1' : 'rally'));
    for (const m of this.carMeshes) this.scene.add(m);
    this.carKeys = keys;
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
    const { width, height } = this.track.def;
    const overview = this.frame(
      [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(width, 0, 0),
        new THREE.Vector3(0, 0, height),
        new THREE.Vector3(width, 0, height),
        new THREE.Vector3(width / 2, 60, 0),
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

  /** `frameDt` overrides wall-clock camera smoothing, e.g. for offline capture. */
  render(prev: GameState, curr: GameState, alpha: number, humanIds: number[], frameDt?: number) {
    this.syncCars(curr);
    const { w, h } = this.resize();
    const positions: THREE.Vector3[] = [];

    for (let i = 0; i < curr.cars.length; i++) {
      const a = prev.cars[i] ?? curr.cars[i];
      const b = curr.cars[i];
      const x = a.x + (b.x - a.x) * alpha;
      const y = a.y + (b.y - a.y) * alpha;
      const angle = lerpAngle(a.angle, b.angle, alpha);
      const mesh = this.carMeshes[i];
      mesh.position.set(x, 0, y);
      mesh.rotation.y = -angle;
      mesh.rotation.x = bodyRoll(b);
      positions.push(new THREE.Vector3(x, 0, y));
    }

    this.updateCamera(positions, humanIds, w / Math.max(1, h), frameDt);
    this.gl.render(this.scene, this.camera);

    const labels: Label[] = humanIds.map((id) => {
      const p = positions[id].clone().setY(34).project(this.camera);
      return { text: curr.cars[id].name, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    });
    this.hud.clearRect(0, 0, w, h);
    drawHud(this.hud, curr, humanIds, w, h, alpha, labels, this.cameraMode === 'follow' ? 'Follow' : 'Overview', this.finishHint);
  }
}

function bodyRoll(car: CarState): number {
  const lateral = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
  return Math.max(-0.14, Math.min(0.14, lateral / 1800));
}
