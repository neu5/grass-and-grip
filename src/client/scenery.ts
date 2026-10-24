import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BARRIER_HALF, terrainHeightAt, type Decor, type Track } from '../sim';
import type { BarrierStyle, TreeStyle } from './themes';

/** Low-poly scenery: trees of several kinds, rocks, hay bales, barriers and drawn-only buildings. */

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  return o;
}

/** Merge parts (each already placed) into one geometry. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

const colors = (list: string[]) => list.map((c) => new THREE.Color(c));

/** One instanced part of a tree: geometry at unit scale (base at y=0), colours picked per tree. */
interface TreePart {
  geo: THREE.BufferGeometry;
  colors: THREE.Color[];
  flat?: boolean;
}

const TRUNK = colors(['#6b4a2b']);

function pineParts(winter: boolean): TreePart[] {
  const greens = colors(['#2f6e2a', '#3a7d31', '#2a6326']);
  return [
    { geo: new THREE.CylinderGeometry(0.18, 0.24, 0.9, 7).translate(0, 0.45, 0), colors: TRUNK },
    ...[0, 1, 2].map((i) => ({
      geo: new THREE.ConeGeometry(1.15 - i * 0.28, 1.3, 9).translate(0, 1.25 + i * 0.75, 0),
      colors: winter && i === 2 ? colors(['#eef3f6']) : greens,
      flat: true,
    })),
  ];
}

function roundParts(): TreePart[] {
  return [
    { geo: new THREE.CylinderGeometry(0.14, 0.22, 1.5, 7).translate(0, 0.75, 0), colors: TRUNK },
    {
      geo: merge([
        new THREE.IcosahedronGeometry(1.05, 0).translate(0, 2.05, 0),
        new THREE.IcosahedronGeometry(0.75, 0).translate(0.55, 2.55, 0.25),
        new THREE.IcosahedronGeometry(0.7, 0).translate(-0.5, 2.4, -0.3),
      ]),
      colors: colors(['#4f8f3a', '#5a9a41', '#447f34', '#6a9f3c']),
      flat: true,
    },
  ];
}

function broadleafParts(): TreePart[] {
  return [
    {
      geo: merge([
        new THREE.CylinderGeometry(0.12, 0.24, 2.7, 7).translate(0, 1.35, 0),
        // Buttress roots.
        ...[0, 1, 2, 3].map((k) =>
          new THREE.BoxGeometry(0.08, 0.5, 0.45)
            .translate(0, 0.25, 0.28)
            .rotateY((k * Math.PI) / 2 + 0.4),
        ),
      ]),
      colors: colors(['#5a4632', '#6b5640']),
    },
    {
      // A tall, layered canopy: rainforest rather than savanna.
      geo: merge([
        new THREE.IcosahedronGeometry(1.15, 1).scale(1.2, 0.85, 1.15).translate(0, 3.1, 0),
        new THREE.IcosahedronGeometry(0.9, 1).scale(1.1, 0.8, 1.05).translate(0.85, 2.55, -0.4),
        new THREE.IcosahedronGeometry(0.85, 1).scale(1.05, 0.8, 1.1).translate(-0.8, 2.65, 0.45),
        new THREE.IcosahedronGeometry(0.7, 1).scale(1, 0.85, 1).translate(0.15, 3.85, 0.2),
      ]),
      colors: colors(['#1f5a2a', '#2b6b2f', '#235f36', '#2f7a33']),
      flat: true,
    },
    {
      // Hanging vines.
      geo: merge(
        [0.6, -0.5, 0.1].map((x, k) => new THREE.CylinderGeometry(0.025, 0.025, 1.1, 4).translate(x, 2.1, k === 2 ? 0.9 : -0.4)),
      ),
      colors: colors(['#3d6b2a']),
    },
  ];
}

function palmParts(): TreePart[] {
  // A gently curved trunk out of short segments, leaning toward +x.
  const segs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const lean = 0.06 * i * i;
    segs.push(
      new THREE.CylinderGeometry(0.1, 0.13, 0.62, 6)
        .rotateZ(-0.08 * i)
        .translate(lean, 0.31 + i * 0.58, 0),
    );
  }
  const top = new THREE.Vector3(0.06 * 16 + 0.05, 0.31 + 5 * 0.58, 0);
  const fronds: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    fronds.push(
      new THREE.ConeGeometry(0.26, 1.7, 4)
        .scale(1, 1, 0.25)
        .rotateZ(-Math.PI / 2)
        .translate(0.85, 0, 0)
        .rotateZ(-0.45 - (k % 2) * 0.2)
        .rotateY((k / 7) * Math.PI * 2)
        .translate(top.x, top.y, top.z),
    );
  }
  return [
    { geo: merge(segs), colors: colors(['#8a6a45', '#7d5f3d']) },
    { geo: merge(fronds), colors: colors(['#3e8a2e', '#4a9a34', '#367d2a']), flat: true },
    { geo: new THREE.SphereGeometry(0.16, 6, 4).translate(top.x, top.y - 0.12, top.z), colors: colors(['#5b4026']) },
  ];
}

function cactusParts(): TreePart[] {
  return [
    {
      geo: merge([
        new THREE.CylinderGeometry(0.22, 0.26, 2.4, 8).translate(0, 1.2, 0),
        new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.4, 0),
        new THREE.CylinderGeometry(0.13, 0.13, 0.55, 7).rotateZ(Math.PI / 2).translate(0.42, 1.15, 0),
        new THREE.CylinderGeometry(0.14, 0.14, 0.95, 7).translate(0.66, 1.55, 0),
        new THREE.SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.66, 2.02, 0),
        new THREE.CylinderGeometry(0.12, 0.12, 0.45, 7).rotateZ(Math.PI / 2).translate(-0.36, 0.85, 0),
        new THREE.CylinderGeometry(0.13, 0.13, 0.75, 7).translate(-0.56, 1.15, 0),
        new THREE.SphereGeometry(0.13, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.56, 1.52, 0),
      ]),
      colors: colors(['#4f7f38', '#5a8a3e', '#477533']),
    },
  ];
}

function bushParts(): TreePart[] {
  return [
    {
      geo: merge([
        new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.65, 1).translate(0, 0.4, 0),
        new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.7, 1).translate(0.55, 0.32, 0.2),
        new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.7, 1).translate(-0.45, 0.3, -0.3),
      ]),
      colors: colors(['#2f6b2c', '#3a7a31', '#2a5f2a']),
      flat: true,
    },
  ];
}

function treeParts(style: TreeStyle, winter: boolean): TreePart[] {
  switch (style) {
    case 'pine':
      return pineParts(winter);
    case 'round':
      return roundParts();
    case 'broadleaf':
      return broadleafParts();
    case 'palm':
      return palmParts();
    case 'cactus':
      return cactusParts();
    case 'bush':
      return bushParts();
  }
}

export interface TreeSpot {
  x: number;
  y: number;
  r: number;
  /** Ground height. */
  h?: number;
  style: TreeStyle;
}

/** All trees as instanced meshes: one draw call per style part. */
export function buildForest(spots: TreeSpot[], winter = false): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3(1, 0, 0);
  const styles = [...new Set(spots.map((s) => s.style))];
  for (const style of styles) {
    const mine = spots.filter((s) => s.style === style);
    for (const part of treeParts(style, winter)) {
      const mesh = new THREE.InstancedMesh(part.geo, std('#ffffff', { flatShading: !!part.flat }), mine.length);
      mine.forEach((t, i) => {
        q.setFromAxisAngle(up, (t.x * 0.37 + t.y * 0.71 + i * 1.7) % (Math.PI * 2));
        // Palms lean a little, each its own way.
        if (style === 'palm') q.multiply(tilt.setFromAxisAngle(side, 0.1));
        m.compose(new THREE.Vector3(t.x, t.h ?? 0, t.y), q, new THREE.Vector3(t.r, t.r, t.r));
        mesh.setMatrixAt(i, m);
        const n = part.colors.length;
        mesh.setColorAt(i, part.colors[(((i * 7 + Math.round(t.x)) % n) + n) % n]);
      });
      g.add(mesh);
    }
  }
  return shadowed(g);
}

/** Boulders: squashed dodecahedra, turned at random. */
export function buildRocks(spots: { x: number; y: number; r: number; h: number }[], color: string): THREE.Group {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std(color, { flatShading: true, roughness: 0.95 }), spots.length);
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const base = new THREE.Color(color);
  spots.forEach((s, i) => {
    e.set(((s.x * 13) % 7) * 0.3, ((s.y * 7) % 11) * 0.5, ((s.x + s.y) % 5) * 0.2);
    m.compose(new THREE.Vector3(s.x, s.h + s.r * 0.35, s.y), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(s.r * 1.1, s.r * 0.75, s.r));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, base.clone().offsetHSL(0, 0, ((i % 3) - 1) * 0.04));
  });
  g.add(mesh);
  return shadowed(g);
}

/** Round hay bales lying on their side. */
export function buildHayBales(spots: { x: number; y: number; r: number; h: number }[]): THREE.Group {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const geo = new THREE.CylinderGeometry(1, 1, 1.5, 16).rotateZ(Math.PI / 2).translate(0, 1, 0);
  const side = new THREE.InstancedMesh(geo, std('#d9b448', { roughness: 1 }), spots.length);
  const caps = new THREE.InstancedMesh(
    merge([
      new THREE.CircleGeometry(0.92, 16).rotateY(Math.PI / 2).translate(0.76, 1, 0),
      new THREE.CircleGeometry(0.92, 16).rotateY(-Math.PI / 2).translate(-0.76, 1, 0),
    ]),
    std('#c49a35', { roughness: 1 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (s.x * 0.13 + s.y * 0.29) % Math.PI);
    m.compose(new THREE.Vector3(s.x, s.h, s.y), q, new THREE.Vector3(s.r, s.r, s.r));
    side.setMatrixAt(i, m);
    caps.setMatrixAt(i, m);
  });
  g.add(side, caps);
  return shadowed(g);
}

/** Barrier lines in the map's style. */
export function buildBarriers(track: Track, style: BarrierStyle): THREE.Group {
  const g = new THREE.Group();
  const segs = track.def.barriers ?? [];
  if (!segs.length) return g;
  if (style === 'tyrewall') {
    // Rows of tyres three high, black and white.
    const spots: { x: number; z: number; h: number }[] = [];
    for (const b of segs) {
      const len = Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y);
      const n = Math.max(1, Math.round(len / (BARRIER_HALF * 2)));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = b.a.x + (b.b.x - b.a.x) * t;
        const z = b.a.y + (b.b.y - b.a.y) * t;
        spots.push({ x, z, h: terrainHeightAt(track, x, z) });
      }
    }
    const geo = new THREE.TorusGeometry(BARRIER_HALF * 0.72, BARRIER_HALF * 0.3, 6, 12).rotateX(Math.PI / 2);
    const rings = new THREE.InstancedMesh(geo, std('#ffffff', { roughness: 0.9 }), spots.length * 3);
    const m = new THREE.Matrix4();
    const black = new THREE.Color('#1c1c1c');
    const white = new THREE.Color('#e8e8e8');
    const red = new THREE.Color('#c9372c');
    spots.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        m.makeTranslation(s.x, s.h + BARRIER_HALF * 0.3 + k * BARRIER_HALF * 0.58, s.z);
        rings.setMatrixAt(i * 3 + k, m);
        rings.setColorAt(i * 3 + k, k === 1 ? (Math.floor(i / 2) % 2 ? red : white) : black);
      }
    });
    g.add(rings);
    return shadowed(g);
  }
  const red = std('#c9372c', { roughness: 0.8 });
  const white = std('#e9e6df', { roughness: 0.85 });
  const grey = std('#b3b0a8', { roughness: 0.9 });
  const ads = ['#2a6fd6', '#f0b323', '#d6342a', '#1f9a5a'].map((c) => std(c, { roughness: 0.6 }));
  const wood = std('#8a6038', { roughness: 0.95 });
  const log = std('#6e4b2c', { roughness: 0.95 });
  const block = 22;
  for (const b of segs) {
    const dx = b.b.x - b.a.x;
    const dy = b.b.y - b.a.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / block));
    const angle = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = b.a.x + dx * t;
      const z = b.a.y + dy * t;
      const ground = terrainHeightAt(track, x, z);
      const piece = new THREE.Group();
      const l = (len / n) * 0.98;
      if (style === 'redwhite') {
        piece.add(new THREE.Mesh(new THREE.BoxGeometry(l * 0.98, 9, BARRIER_HALF * 2), i % 2 ? white : red).translateY(4));
      } else if (style === 'concrete') {
        piece.add(new THREE.Mesh(new THREE.BoxGeometry(l, 11, BARRIER_HALF * 2), grey).translateY(5));
        // An advert panel on both faces every few blocks.
        if (i % 3 === 1) {
          const ad = ads[(i + Math.round(b.a.x)) % ads.length];
          piece.add(new THREE.Mesh(new THREE.BoxGeometry(l * 0.9, 6, BARRIER_HALF * 2 + 0.6), ad).translateY(5.5));
        }
      } else if (style === 'fence') {
        piece.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 12, 2.2), wood).translateY(6).translateX(-l / 2));
        for (const y of [4.5, 9.5]) piece.add(new THREE.Mesh(new THREE.BoxGeometry(l, 1.6, 1.2), wood).translateY(y));
      } else {
        for (const [y, zz] of [
          [BARRIER_HALF * 0.55, -BARRIER_HALF * 0.45],
          [BARRIER_HALF * 0.55, BARRIER_HALF * 0.45],
          [BARRIER_HALF * 1.35, 0],
        ]) {
          piece.add(new THREE.Mesh(new THREE.CylinderGeometry(BARRIER_HALF * 0.5, BARRIER_HALF * 0.55, l * 0.99, 7).rotateZ(Math.PI / 2), log).translateY(y).translateZ(zz));
        }
      }
      piece.position.set(x, ground, z);
      piece.rotation.y = -angle;
      g.add(piece);
    }
  }
  return shadowed(g);
}

/** Windows on a facade, drawn once and shared. */
let windowTex: THREE.CanvasTexture | null = null;
function windowTexture(): THREE.CanvasTexture | null {
  if (windowTex) return windowTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#5a6e82';
  for (let y = 6; y < 64; y += 16) for (let x = 6; x < 64; x += 16) ctx.fillRect(x, y, 9, 9);
  windowTex = new THREE.CanvasTexture(c);
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  windowTex.colorSpace = THREE.SRGBColorSpace;
  return windowTex;
}

const FACADES = ['#d8c7a8', '#c9b29a', '#e3dccf', '#b8a48e', '#d9b9a0', '#c4ccd4'];
const ROOFS = ['#8a3b2e', '#6e4a3a', '#5b5f66', '#7a2f2a'];

function gable(w: number, d: number, h: number, mat: THREE.Material): THREE.Mesh {
  // A triangular prism roof along x.
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 2, 0), new THREE.Vector2(d / 2 + 2, 0), new THREE.Vector2(0, h)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 4, bevelEnabled: false }).translate(0, 0, -(w + 4) / 2).rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

function boxAt(size: [number, number, number], pos: [number, number, number], mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos);
  return m;
}

function decorMesh(d: Decor, seed: number): THREE.Group {
  const g = new THREE.Group();
  const { w, d: depth } = d;
  switch (d.kind) {
    case 'grandstand': {
      const h = d.h ?? 34;
      const steps = 5;
      const concrete = std('#c9c6bf');
      const seats = ['#2a6fd6', '#d6342a', '#f0b323'].map((c) => std(c, { roughness: 0.6 }));
      for (let i = 0; i < steps; i++) {
        const sd = depth / steps;
        g.add(boxAt([w, (h * 0.7 * (i + 1)) / steps, sd], [0, (h * 0.7 * (i + 1)) / steps / 2, -depth / 2 + sd * (i + 0.5)], concrete));
        g.add(boxAt([w * 0.98, 1.2, sd * 0.5], [0, (h * 0.7 * (i + 1)) / steps + 0.6, -depth / 2 + sd * (i + 0.35)], seats[i % seats.length]));
      }
      // Crowd: little coloured blocks along the tiers.
      const people = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 3.6, 2.4), std('#ffffff'), Math.floor(w / 5) * steps);
      const m = new THREE.Matrix4();
      const shirts = colors(['#e8443a', '#3a8ee8', '#f2c230', '#ffffff', '#3fbf5f', '#222222', '#ff8a3d']);
      let k = 0;
      for (let i = 0; i < steps; i++) {
        for (let j = 0; j < Math.floor(w / 5); j++) {
          if ((i * 31 + j * 17 + seed) % 5 === 0) continue;
          m.makeTranslation(-w / 2 + 2.5 + j * 5, (h * 0.7 * (i + 1)) / steps + 2.4, -depth / 2 + (depth / steps) * (i + 0.55));
          people.setMatrixAt(k, m);
          people.setColorAt(k, shirts[(i * 5 + j * 3 + seed) % shirts.length]);
          k++;
        }
      }
      people.count = k;
      g.add(people);
      // Tiers rise toward +z: the back wall is there, and a roof shades the upper rows only.
      const roof = std('#d8dde3', { roughness: 0.5 });
      g.add(boxAt([w + 4, 1.5, depth * 0.5 + 4], [0, h, depth / 4 + 2], roof));
      for (let x = -w / 2 + 2; x <= w / 2 - 2; x += Math.max(40, w / 8)) g.add(boxAt([1.6, h * 0.35, 1.6], [x, h * 0.83, 0], concrete));
      g.add(boxAt([w, h, 1.5], [0, h / 2, depth / 2 + 0.75], concrete));
      break;
    }
    case 'building': {
      const h = d.h ?? 70;
      const tex = windowTexture();
      const facade = new THREE.MeshStandardMaterial({ color: FACADES[seed % FACADES.length], roughness: 0.9, map: tex ?? undefined });
      if (tex) {
        facade.map = tex.clone();
        facade.map.repeat.set(Math.max(1, Math.round(w / 16)), Math.max(1, Math.round(h / 16)));
        facade.map.needsUpdate = true;
      }
      g.add(boxAt([w, h, depth], [0, h / 2, 0], facade));
      g.add(boxAt([w + 2, 2, depth + 2], [0, h + 1, 0], std('#7d7f84')));
      g.add(boxAt([w * 0.25, 6, depth * 0.25], [w * 0.15, h + 5, -depth * 0.1], std('#9a9ca0')));
      break;
    }
    case 'house': {
      const h = d.h ?? 26;
      g.add(boxAt([w, h, depth], [0, h / 2, 0], std(FACADES[seed % FACADES.length])));
      const roof = gable(w, depth, depth * 0.45, std(ROOFS[seed % ROOFS.length], { flatShading: true }));
      roof.position.y = h;
      g.add(roof);
      g.add(boxAt([6, 11, 1], [w * 0.2, 5.5, depth / 2 + 0.5], std('#5b3d26')));
      for (const x of [-w * 0.25, w * 0.4]) g.add(boxAt([6, 6, 1], [x, h * 0.6, depth / 2 + 0.5], std('#5a6e82')));
      break;
    }
    case 'barn': {
      const h = d.h ?? 30;
      const red = std('#9e2f25');
      g.add(boxAt([w, h, depth], [0, h / 2, 0], red));
      const roof = gable(w, depth, depth * 0.5, std('#4a4a4f', { flatShading: true }));
      roof.position.y = h;
      g.add(roof);
      const trim = std('#f1ece2');
      g.add(boxAt([depth * 0.45, h * 0.7, 1], [w / 2 + 0.5, h * 0.35, 0], trim).rotateY(Math.PI / 2));
      g.add(boxAt([depth * 0.4, h * 0.62, 1.2], [w / 2 + 0.6, h * 0.33, 0], std('#7d241c')).rotateY(Math.PI / 2));
      break;
    }
    case 'hut': {
      const h = d.h ?? 14;
      const bamboo = std('#b08a50');
      for (const [x, z] of [
        [-w / 2 + 2, -depth / 2 + 2],
        [w / 2 - 2, -depth / 2 + 2],
        [-w / 2 + 2, depth / 2 - 2],
        [w / 2 - 2, depth / 2 - 2],
      ])
        g.add(boxAt([2, h, 2], [x, h / 2, z], bamboo));
      g.add(boxAt([w, 2, depth], [0, h, 0], bamboo));
      g.add(boxAt([w * 0.9, 12, depth * 0.9], [0, h + 7, 0], std('#c8a468')));
      const thatch = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, depth) * 0.78, 16, 8), std('#a8894a', { flatShading: true }));
      thatch.position.y = h + 13 + 8;
      g.add(thatch);
      break;
    }
    case 'ruin': {
      // A stepped temple with a stair and broken columns, mossy stone.
      const h = d.h ?? 46;
      const stone = std('#8f8f7a', { flatShading: true });
      const moss = std('#5f7a45', { flatShading: true });
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const s = 1 - i * 0.2;
        g.add(boxAt([w * s, h / tiers, depth * s], [0, (h / tiers) * (i + 0.5), 0], i % 2 ? moss : stone));
      }
      g.add(boxAt([w * 0.22, h * 0.9, depth * 0.6], [0, h * 0.45, depth * 0.45], stone).rotateX(-0.6));
      g.add(boxAt([w * 0.3, h * 0.25, depth * 0.3], [0, h + h * 0.12, 0], stone));
      for (const [x, z, hh] of [
        [-w * 0.75, depth * 0.6, 22],
        [w * 0.75, depth * 0.6, 14],
        [-w * 0.75, -depth * 0.55, 9],
        [w * 0.8, -depth * 0.6, 18],
      ]) {
        g.add(boxAt([5, hh, 5], [x, hh / 2, z], stone));
      }
      g.add(boxAt([12, 4, 5], [w * 0.55, 2, depth * 0.85], moss).rotateY(0.5));
      break;
    }
    case 'billboard': {
      const h = d.h ?? 22;
      const post = std('#555a60');
      for (const x of [-w * 0.35, w * 0.35]) g.add(boxAt([1.6, h, 1.6], [x, h / 2, 0], post));
      const board = boxAt([w, h * 0.55, 1.4], [0, h * 0.78, 0], std(['#2a6fd6', '#f0b323', '#d6342a', '#1f9a5a'][seed % 4], { roughness: 0.5 }));
      g.add(board);
      g.add(boxAt([w * 0.7, h * 0.18, 1.6], [0, h * 0.8, 0], std('#ffffff', { roughness: 0.5 })));
      break;
    }
    case 'mesa': {
      // Layered sandstone, each band a little narrower and turned.
      const h = d.h ?? 120;
      const bands = ['#b0603a', '#c27447', '#a5552f', '#c98a57'];
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const s = 1 - i * 0.12;
        const geo = new THREE.CylinderGeometry(0.5 * s * 0.92, 0.5 * s, h / layers, 7).scale(w, 1, depth);
        const mesh = new THREE.Mesh(geo, std(bands[i % bands.length], { flatShading: true, roughness: 1 }));
        mesh.position.y = (h / layers) * (i + 0.5);
        mesh.rotation.y = i * 0.4 + seed;
        g.add(mesh);
      }
      break;
    }
    case 'tent': {
      const h = d.h ?? 16;
      const white = std('#f3f1ec');
      g.add(boxAt([w, h * 0.55, depth], [0, h * 0.275, 0], white));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, depth) / 2, h * 0.5, 4).rotateY(Math.PI / 4).scale(w / Math.hypot(w, depth) * 1.41, 1, depth / Math.hypot(w, depth) * 1.41), std('#e2dfd8', { flatShading: true }));
      roof.position.y = h * 0.55 + h * 0.25;
      g.add(roof);
      g.add(boxAt([w * 0.98, 2.2, 0.6], [0, h * 0.45, depth / 2 + 0.3], std(['#d6342a', '#2a6fd6', '#1f9a5a'][seed % 3])));
      break;
    }
  }
  g.rotation.y = -(d.angle ?? 0);
  return g;
}

export function buildDecor(track: Track): THREE.Group {
  const g = new THREE.Group();
  (track.def.decor ?? []).forEach((d, i) => {
    const mesh = decorMesh(d, i);
    mesh.position.set(d.x, terrainHeightAt(track, d.x, d.y), d.y);
    g.add(mesh);
  });
  return shadowed(g);
}

/** City blocks outside the wall, as one instanced mesh of plain boxes. */
export function buildSkyline(spots: { x: number; y: number; r: number; h: number }[]): THREE.Group {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const tex = windowTexture();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map: tex ?? undefined }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((s, i) => {
    const tall = 40 + ((s.x * 7 + s.y * 3) % 90);
    m.compose(new THREE.Vector3(s.x, s.h, s.y), new THREE.Quaternion(), new THREE.Vector3(s.r * 3, tall, s.r * 2.4));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color(FACADES[i % FACADES.length]));
  });
  g.add(mesh);
  return shadowed(g);
}

/** Desert mesas outside the wall. */
export function buildOutsideMesas(spots: { x: number; y: number; r: number; h: number }[]): THREE.Group {
  const g = new THREE.Group();
  spots.forEach((s, i) => {
    const mesh = decorMesh({ kind: 'mesa', x: 0, y: 0, w: s.r * 6, d: s.r * 5, h: 60 + (i % 4) * 30 }, i);
    mesh.position.set(s.x, s.h, s.y);
    g.add(mesh);
  });
  return shadowed(g);
}
