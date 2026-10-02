import * as THREE from 'three';
import { COLORS } from '../render/Scene';
import { type AABB, setAABB } from './Collision';

/**
 * barrier: low wall, jump over it.
 * bar:     overhead beam, slide under it.
 * block:   tall wall, change lanes.
 */
export type ObstacleKind = 'barrier' | 'bar' | 'block';

interface Spec {
  w: number;
  h: number;
  d: number;
  y: number; // bottom of the collision box
  color: number;
}

export const SPECS: Record<ObstacleKind, Spec> = {
  barrier: { w: 1.8, h: 0.9, d: 0.4, y: 0, color: COLORS.pink },
  bar: { w: 1.8, h: 0.4, d: 0.4, y: 1.05, color: COLORS.yellow },
  block: { w: 1.8, h: 2.6, d: 2.2, y: 0, color: COLORS.cyan },
};

const KINDS: ObstacleKind[] = ['barrier', 'bar', 'block'];
const DESPAWN_Z = 12;

export interface Obstacle {
  kind: ObstacleKind;
  mesh: THREE.Object3D;
}

export class Obstacles {
  readonly active: Obstacle[] = [];
  private free: Record<ObstacleKind, Obstacle[]> = { barrier: [], bar: [], block: [] };
  private builders: Record<ObstacleKind, () => THREE.Object3D>;

  constructor(private parent: THREE.Object3D) {
    this.builders = {
      barrier: () => buildBarrier(),
      bar: () => buildBar(),
      block: () => buildBlock(),
    };
    // Pre-warm pools so nothing is allocated mid-run.
    for (const kind of KINDS) {
      for (let i = 0; i < 12; i++) this.free[kind].push(this.create(kind));
    }
  }

  spawn(kind: ObstacleKind, x: number, z: number): void {
    const o = this.free[kind].pop() ?? this.create(kind);
    o.mesh.position.set(x, 0, z);
    o.mesh.visible = true;
    this.active.push(o);
  }

  update(dz: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      o.mesh.position.z += dz;
      if (o.mesh.position.z > DESPAWN_Z) this.release(i);
    }
  }

  reset(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(i);
  }

  getBox(o: Obstacle, out: AABB): AABB {
    const s = SPECS[o.kind];
    const p = o.mesh.position;
    return setAABB(out, p.x, s.y, p.z, s.w, s.h, s.d);
  }

  private create(kind: ObstacleKind): Obstacle {
    const mesh = this.builders[kind]();
    mesh.visible = false;
    this.parent.add(mesh);
    return { kind, mesh };
  }

  private release(i: number): void {
    const o = this.active[i];
    o.mesh.visible = false;
    // Swap-remove keeps this O(1).
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    this.free[o.kind].push(o);
  }
}

// ---------- Mesh builders (geometry/materials shared across pool instances) ----------

const shared = new Map<string, THREE.BufferGeometry | THREE.Material>();
function cached<T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T {
  let v = shared.get(key);
  if (!v) {
    v = make();
    shared.set(key, v);
  }
  return v as T;
}

function neonBox(key: string, w: number, h: number, d: number, color: number, fillTint = 0.12): THREE.Mesh {
  const geo = cached(`geo:${key}`, () => new THREE.BoxGeometry(w, h, d));
  const fill = cached(
    `fill:${color}:${fillTint}`,
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(fillTint) }),
  );
  const edgeGeo = cached(`edge:${key}`, () => new THREE.EdgesGeometry(geo));
  const edgeMat = cached(`line:${color}`, () => new THREE.LineBasicMaterial({ color }));
  const mesh = new THREE.Mesh(geo, fill);
  mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
  return mesh;
}

function glow(key: string, w: number, h: number, d: number, color: number): THREE.Mesh {
  const geo = cached(`geo:${key}`, () => new THREE.BoxGeometry(w, h, d));
  const mat = cached(`glow:${color}`, () => new THREE.MeshBasicMaterial({ color }));
  return new THREE.Mesh(geo, mat);
}

function buildBarrier(): THREE.Object3D {
  const s = SPECS.barrier;
  const g = new THREE.Group();
  const wall = neonBox('barrier', s.w, s.h, s.d, s.color, 0.25);
  wall.position.y = s.h / 2;
  g.add(wall);
  for (const y of [s.h - 0.05, s.h * 0.45]) {
    const stripe = glow('barrier-stripe', s.w + 0.02, 0.1, s.d + 0.02, s.color);
    stripe.position.y = y;
    g.add(stripe);
  }
  return g;
}

function buildBar(): THREE.Object3D {
  const s = SPECS.bar;
  const g = new THREE.Group();
  const beam = neonBox('bar', s.w, s.h, s.d, s.color, 0.25);
  beam.position.y = s.y + s.h / 2;
  g.add(beam);
  const stripe = glow('bar-stripe', s.w + 0.02, 0.08, s.d + 0.02, s.color);
  stripe.position.y = s.y + s.h / 2;
  g.add(stripe);
  // Decorative posts at the lane edges (not part of the collision box).
  for (const side of [-1, 1]) {
    const post = glow('bar-post', 0.08, s.y + s.h, 0.08, s.color);
    post.position.set(side * (s.w / 2 + 0.04), (s.y + s.h) / 2, 0);
    g.add(post);
  }
  return g;
}

function buildBlock(): THREE.Object3D {
  const s = SPECS.block;
  const g = new THREE.Group();
  const box = neonBox('block', s.w, s.h, s.d, s.color, 0.1);
  box.position.y = s.h / 2;
  g.add(box);
  for (const y of [0.6, 1.3, 2.0]) {
    const band = glow('block-band', s.w + 0.02, 0.07, s.d + 0.02, COLORS.pink);
    band.position.y = y;
    g.add(band);
  }
  return g;
}
