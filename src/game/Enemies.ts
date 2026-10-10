import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TextLabel, labelSprite } from '../render/Label';
import { TRACK_HALF } from './Track';

/**
 * Everything on the track that has a health number. The last four are obstacles ("props"):
 * they don't move, but they block the way, take bullets, and cost members if you run into them.
 */
export type EnemyKind = 'grunt' | 'brute' | 'dasher' | 'bearer' | 'boss' | 'barrel' | 'tyres' | 'crate' | 'barrier' | 'skitter';
// New kinds go at the end: co-op snapshots send the index.
export const ENEMY_KINDS: EnemyKind[] = ['grunt', 'brute', 'dasher', 'bearer', 'boss', 'barrel', 'tyres', 'crate', 'barrier', 'skitter'];

interface KindSpec {
  radius: number;
  height: number;
  speed: number; // walking speed towards the squad
  color: number;
  /** Gem pickups dropped on death: `chance` of dropping `count`. */
  drop: { chance: number; count: number };
  labelW: number;
  /** Strides per second of the walk cycle. */
  stride: number;
  /** Obstacles: stand still, no limbs. */
  prop?: boolean;
  /** Half-width for hits, when wider than `radius` (barriers). */
  halfW?: number;
}

export const ENEMY_SPECS: Record<EnemyKind, KindSpec> = {
  grunt: { radius: 0.55, height: 1.35, speed: 2.5, color: 0xff3b4e, drop: { chance: 0.06, count: 1 }, labelW: 1.6, stride: 9 },
  brute: { radius: 0.95, height: 2.2, speed: 1.8, color: 0xff7a1a, drop: { chance: 0.3, count: 1 }, labelW: 2.0, stride: 6 },
  dasher: { radius: 0.45, height: 1.0, speed: 6.5, color: 0xb45cff, drop: { chance: 0.05, count: 1 }, labelW: 1.3, stride: 0 },
  bearer: { radius: 0.85, height: 2.0, speed: 1.6, color: 0x4d7cff, drop: { chance: 0.5, count: 1 }, labelW: 1.8, stride: 5 },
  boss: { radius: 2.0, height: 4.2, speed: 2.2, color: 0xff2b8a, drop: { chance: 0, count: 0 }, labelW: 3.2, stride: 3.2 },
  barrel: { radius: 0.55, height: 1.15, speed: 0, color: 0xff4a1f, drop: { chance: 0, count: 0 }, labelW: 1.4, stride: 0, prop: true },
  tyres: { radius: 0.7, height: 1.05, speed: 0, color: 0x2a2d38, drop: { chance: 0, count: 0 }, labelW: 1.5, stride: 0, prop: true },
  crate: { radius: 0.65, height: 1.2, speed: 0, color: 0x8a4dff, drop: { chance: 0.4, count: 1 }, labelW: 1.5, stride: 0, prop: true },
  barrier: { radius: 0.5, height: 1.3, speed: 0, color: 0x5d6478, drop: { chance: 0, count: 0 }, labelW: 1.8, stride: 0, prop: true, halfW: 1.9 },
  // Small, quick and weak: they come in big swarms. Built from just two meshes so hordes stay cheap to draw.
  skitter: { radius: 0.36, height: 0.7, speed: 3.6, color: 0xff4f9a, drop: { chance: 0.02, count: 1 }, labelW: 1.0, stride: 0 },
};

/** Half-width used for bullet hits and running into it. */
export function hitHalfW(kind: EnemyKind): number {
  const s = ENEMY_SPECS[kind];
  return s.halfW ?? s.radius;
}

/** Barrels blow up when destroyed, hurting everything within this radius. */
export const BARREL_BLAST = 2.8;

/** Compact numbers for labels: 12345 → "12.3K". */
export function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return String(n);
}

/** Shield bearers carry a wall in front of them that soaks up bullets until it breaks. */
export const SHIELD = { halfW: 1.15, height: 1.8, depth: 0.25, ahead: 1.05 };
export const SHIELD_COLOR = 0x4d9cff;

const DESPAWN_Z = 4;
const FLASH_TIME = 0.07;
/** Dashers steer towards the nearest squad at this sideways speed. */
const DASHER_STEER = 2.4;
/** Enemies that appear this close drop in from the sky instead of popping into view. */
const DROP_IN_Z = -50;
const DROP_TIME = 0.55;
const KNOCKBACK = 0.025;
/** Beyond this distance enemies drop their small details (limbs, horns, eyes) to save draw calls. */
const DETAIL_Z = -40;
/** Brutes wind up, then charge, once they get this close. */
const BRUTE_TRIGGER_Z = -26;
const WINDUP = 0.7;
const CHARGE = 1.2;
const CHARGE_MULT = 3.2;
/** Seconds between boss roars (each one summons minions and hurls rocks). */
const BOSS_ROAR_EVERY = 3.4;

type Mode = 'walk' | 'windup' | 'charge' | 'spent';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Group;
  rig: Rig;
  /** Small parts hidden at a distance. */
  detail: THREE.Object3D[];
  far: boolean;
  mat: THREE.MeshLambertMaterial;
  label: TextLabel;
  hp: number;
  maxHp: number;
  shieldHp: number;
  shield: THREE.Group | null;
  shieldLabel: TextLabel | null;
  flash: number;
  /** When false the enemy holds its ground (the boss before the arena). */
  walking: boolean;
  // Animation and behaviour state
  phase: number;
  age: number;
  drop: number;
  mode: Mode;
  modeT: number;
  hopIn: number;
  hopT: number;
  lastX: number;
}

/** The moving parts of a body, for the walk cycle and gestures. */
interface Rig {
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  head: THREE.Object3D | null;
  spin: THREE.Object3D | null;
  /** Parts that can be hidden at a distance without changing the silhouette much. */
  detail: THREE.Object3D[];
}

export class Enemies {
  readonly active: Enemy[] = [];
  /** Every enemy ever created (pooled), so a colour theme can repaint them all. */
  private all: Enemy[] = [];
  private theme: Partial<Record<EnemyKind, number>> = {};
  private free: Record<EnemyKind, Enemy[]> = {
    grunt: [],
    brute: [],
    dasher: [],
    bearer: [],
    boss: [],
    barrel: [],
    tyres: [],
    crate: [],
    barrier: [],
    skitter: [],
  };
  private nextId = 1;

  constructor(private parent: THREE.Object3D) {
    const prewarm: [EnemyKind, number][] = [
      ['grunt', 60],
      ['brute', 10],
      ['dasher', 16],
      ['bearer', 6],
      ['boss', 1],
      ['barrel', 10],
      ['tyres', 8],
      ['crate', 6],
      ['barrier', 6],
      ['skitter', 60],
    ];
    for (const [kind, n] of prewarm) for (let i = 0; i < n; i++) this.free[kind].push(this.create(kind));
  }

  /** `id` is only passed by the co-op guest, mirroring the host's ids. */
  spawn(kind: EnemyKind, x: number, z: number, hp: number, shieldHp = 0, id?: number): Enemy {
    const e = this.free[kind].pop() ?? this.create(kind);
    e.id = id ?? this.nextId++;
    e.hp = e.maxHp = hp;
    e.shieldHp = shieldHp;
    e.flash = 0;
    e.walking = kind !== 'boss' && !ENEMY_SPECS[kind].prop;
    e.phase = Math.random() * Math.PI * 2;
    e.age = 0;
    e.drop = z > DROP_IN_Z && kind !== 'boss' && !ENEMY_SPECS[kind].prop ? DROP_TIME : 0;
    e.mode = 'walk';
    e.modeT = 0;
    e.hopIn = 1.5 + Math.random() * 2.5;
    e.hopT = 0;
    e.lastX = x;
    this.setFar(e, z < DETAIL_Z);
    e.group.position.set(x, 0, z);
    e.group.scale.setScalar(1);
    e.group.visible = true;
    e.label.set(fmtCount(Math.ceil(hp)));
    if (e.shield) e.shield.visible = shieldHp > 0;
    e.shieldLabel?.set(String(Math.ceil(shieldHp)));
    this.active.push(e);
    return e;
  }

  byId(id: number): Enemy | undefined {
    return this.active.find((e) => e.id === id);
  }

  /** Returns true when the hit killed the enemy. Hits stagger enemies back a little. */
  damage(e: Enemy, amount: number): boolean {
    this.setHp(e, e.hp - amount);
    e.flash = FLASH_TIME;
    if (e.kind !== 'boss' && e.mode !== 'charge') e.group.position.z -= KNOCKBACK;
    return e.hp <= 0;
  }

  /** Returns true when the hit broke the shield. */
  damageShield(e: Enemy, amount: number): boolean {
    this.setShield(e, e.shieldHp - amount);
    e.flash = FLASH_TIME;
    return e.shieldHp <= 0;
  }

  setHp(e: Enemy, hp: number): void {
    e.hp = hp;
    e.label.set(fmtCount(Math.max(0, Math.ceil(hp))));
  }

  setShield(e: Enemy, hp: number): void {
    e.shieldHp = Math.max(0, hp);
    e.shieldLabel?.set(String(Math.ceil(e.shieldHp)));
    if (e.shield) e.shield.visible = e.shieldHp > 0;
  }

  /** z of the front face of an enemy's shield. */
  shieldZ(e: Enemy): number {
    return e.group.position.z + SHIELD.ahead;
  }

  /** The colour an enemy kind is drawn in (after the player's chosen theme). */
  colorOf(kind: EnemyKind): number {
    return this.theme[kind] ?? ENEMY_SPECS[kind].color;
  }

  /** Repaint enemies with a colour theme (kinds missing from it keep their usual colour). */
  setTheme(theme: Partial<Record<EnemyKind, number>>): void {
    this.theme = theme;
    for (const e of this.all) this.paint(e);
  }

  private paint(e: Enemy): void {
    const c = this.colorOf(e.kind);
    e.mat.color.setHex(c);
    e.mat.emissive.setHex(c).multiplyScalar(0.25);
  }

  private setFar(e: Enemy, far: boolean): void {
    e.far = far;
    for (const o of e.detail) o.visible = !far;
  }

  /** Is this boss mid-roar? (Sim uses the roar to time its summons.) */
  roaring(e: Enemy): boolean {
    return e.kind === 'boss' && e.mode === 'windup';
  }

  /**
   * Move and animate everyone. `squadXs` are the squads' x positions, for homing and
   * facing. The co-op guest passes `despawn: false` and lets snapshots decide who leaves.
   */
  update(dt: number, dz: number, time: number, squadXs: number[], despawn = true): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      const p = e.group.position;
      const spec = ENEMY_SPECS[e.kind];
      e.age += dt;
      e.modeT += dt;

      // Nearest squad, for homing and for turning to face it.
      let tx = p.x;
      if (squadXs.length) {
        tx = squadXs[0];
        for (const x of squadXs) if (Math.abs(x - p.x) < Math.abs(tx - p.x)) tx = x;
      }

      this.think(e, dt);
      const pace = e.mode === 'windup' ? 0 : e.mode === 'charge' ? CHARGE_MULT : 1;
      const landed = e.drop <= 0;
      p.z += dz + (e.walking && landed ? spec.speed * pace * dt : 0);

      if (e.kind === 'dasher' && p.z > -45 && squadXs.length && landed) {
        const step = DASHER_STEER * dt;
        p.x += Math.max(-step, Math.min(step, tx - p.x));
      } else if (e.kind === 'skitter' && e.walking && landed && p.z > -60) {
        // Skitters zig-zag quickly.
        p.x += Math.cos(e.age * 3.4 + e.phase) * 1.8 * dt;
        p.x = Math.max(-TRACK_HALF + 0.3, Math.min(TRACK_HALF - 0.3, p.x));
      } else if (e.kind === 'grunt' && e.walking && p.z > -60) {
        // Grunts weave as they come, so they don't march in a straight line.
        p.x += Math.cos(e.age * 1.7 + e.phase) * 0.9 * dt;
        p.x = Math.max(-TRACK_HALF + 0.4, Math.min(TRACK_HALF - 0.4, p.x));
      }

      if (despawn && p.z > DESPAWN_Z) {
        this.release(e);
        continue;
      }
      if (e.far !== p.z < DETAIL_Z) this.setFar(e, p.z < DETAIL_Z);
      this.animate(e, dt, time, tx);
    }
  }

  /** Per-kind behaviour: brute charges, grunt hops, boss roars. */
  private think(e: Enemy, dt: number): void {
    const z = e.group.position.z;
    if (e.drop > 0) {
      e.drop = Math.max(0, e.drop - dt);
      return;
    }
    switch (e.kind) {
      case 'brute':
        if (e.mode === 'walk' && z > BRUTE_TRIGGER_Z) this.setMode(e, 'windup');
        else if (e.mode === 'windup' && e.modeT > WINDUP) this.setMode(e, 'charge');
        else if (e.mode === 'charge' && e.modeT > CHARGE) this.setMode(e, 'spent');
        break;
      case 'grunt':
        if (e.hopT > 0) e.hopT = Math.max(0, e.hopT - dt);
        else if (z > -35 && z < -5 && (e.hopIn -= dt) <= 0) {
          e.hopT = 0.45;
          e.hopIn = 2 + Math.random() * 3;
        }
        break;
      case 'boss':
        // A roar every few seconds once it is on the move.
        if (e.walking && e.mode === 'walk' && e.modeT > BOSS_ROAR_EVERY) this.setMode(e, 'windup');
        else if (e.mode === 'windup' && e.modeT > 0.8) this.setMode(e, 'walk');
        break;
    }
  }

  private setMode(e: Enemy, m: Mode): void {
    e.mode = m;
    e.modeT = 0;
  }

  private animate(e: Enemy, dt: number, time: number, tx: number): void {
    const spec = ENEMY_SPECS[e.kind];
    const { body, rig } = e;
    const p = e.group.position;
    const h = spec.height;

    // Hit flash and squash.
    e.flash = Math.max(0, e.flash - dt);
    const hit = e.flash > 0 ? 1 : 0;
    if (spec.prop) {
      // Obstacles just shudder when hit (and barrels flicker like they're about to go).
      e.mat.emissiveIntensity = hit ? 2.5 : e.kind === 'barrel' ? 1 + 0.6 * Math.max(0, Math.sin(time * 6 + e.phase)) : 1;
      body.rotation.z = hit ? (Math.random() - 0.5) * 0.12 : 0;
      body.scale.setScalar(1 + hit * 0.05);
      p.y = 0;
      return;
    }
    const windup = e.mode === 'windup';
    const pulse = windup ? 0.5 + 0.5 * Math.sin(e.modeT * 30) : 0;
    e.mat.emissiveIntensity = hit ? 2.5 : 1 + pulse * 2;

    const moving = e.walking && e.drop <= 0 && !windup;
    const cyc = e.age * spec.stride * (e.mode === 'charge' ? 1.8 : 1) + e.phase;
    const swing = moving ? Math.sin(cyc) : 0;

    // Legs and arms swing in opposition; arms go up for a wind-up or roar.
    rig.legs.forEach((l, k) => (l.rotation.x = swing * 0.7 * (k ? -1 : 1)));
    rig.arms.forEach((a, k) => {
      if (windup) a.rotation.x = -2.5 + Math.sin(e.modeT * 18 + k) * 0.2;
      else if (e.kind === 'bearer') a.rotation.x = -1.2; // holding the shield up
      else a.rotation.x = -swing * 0.6 * (k ? -1 : 1);
      a.rotation.z = windup ? (k ? -0.5 : 0.5) : 0;
    });
    if (rig.head) rig.head.rotation.x = windup ? -0.45 : Math.sin(cyc * 2) * 0.05;
    if (rig.spin) rig.spin.rotation.y += dt * 9;

    // Body: a step bob, a forward lean when charging, and turning to face its target.
    let y = moving ? Math.abs(Math.sin(cyc)) * h * 0.06 : Math.sin(time * 2 + e.phase) * h * 0.01;
    let lean = e.mode === 'charge' ? 0.35 : moving ? 0.08 : 0;
    if (e.kind === 'dasher') {
      y = 0.35 + Math.sin(e.age * 6 + e.phase) * 0.12;
      const vx = (p.x - e.lastX) / Math.max(dt, 1e-4);
      body.rotation.z = THREE.MathUtils.clamp(-vx * 0.12, -0.6, 0.6);
      lean = 0.25;
    } else {
      body.rotation.z = moving ? Math.sin(cyc) * 0.06 : 0;
    }
    if (e.kind === 'grunt' && e.hopT > 0) y += Math.sin((1 - e.hopT / 0.45) * Math.PI) * 0.9;
    if (e.kind === 'skitter') {
      y = moving ? Math.abs(Math.sin(e.age * 16 + e.phase)) * 0.12 : 0;
      body.rotation.z = moving ? Math.sin(e.age * 16 + e.phase) * 0.15 : 0;
    }
    body.position.y = y;
    body.rotation.x = lean;
    const face = Math.atan2(tx - p.x, Math.max(2, -p.z));
    body.rotation.y += (THREE.MathUtils.clamp(face, -0.6, 0.6) - body.rotation.y) * Math.min(1, dt * 5);

    const swell = e.kind === 'boss' && windup ? 1 + Math.sin(Math.min(1, e.modeT / 0.8) * Math.PI) * 0.1 : 1;
    body.scale.set((1 + hit * 0.12) * swell, (1 - hit * 0.08) * swell, (1 + hit * 0.12) * swell);

    // Dropping in from the sky.
    const d = e.drop / DROP_TIME;
    p.y = d > 0 ? 12 * d * d : 0;
    e.lastX = p.x;
  }

  release(e: Enemy): void {
    const i = this.active.indexOf(e);
    if (i < 0) return;
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    e.group.visible = false;
    this.free[e.kind].push(e);
  }

  reset(): void {
    while (this.active.length) this.release(this.active[this.active.length - 1]);
  }

  private create(kind: EnemyKind): Enemy {
    const spec = ENEMY_SPECS[kind];
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.color).multiplyScalar(0.25),
      flatShading: true,
    });
    const { body, rig } = buildBody(kind, spec, mat);
    group.add(body);
    const detail = kind === 'boss' ? [] : rig.detail;

    const label = new TextLabel(160, 80, { color: '#ffffff' });
    const sprite = labelSprite(label, spec.labelW, spec.labelW / 2);
    sprite.position.y = spec.height + spec.labelW * 0.3;
    group.add(sprite);

    let shield: THREE.Group | null = null;
    let shieldLabel: TextLabel | null = null;
    if (kind === 'bearer') {
      shield = buildShield();
      shieldLabel = new TextLabel(160, 80, { color: '#d8e8ff' });
      const s = labelSprite(shieldLabel, 1.4, 0.7);
      s.position.set(0, SHIELD.height * 0.55, SHIELD.ahead + 0.2);
      shield.add(s);
      group.add(shield);
    }

    group.visible = false;
    this.parent.add(group);
    const e: Enemy = {
      id: 0,
      kind,
      group,
      body,
      rig,
      detail,
      far: false,
      mat,
      label,
      hp: 0,
      maxHp: 0,
      shieldHp: 0,
      shield,
      shieldLabel,
      flash: 0,
      walking: true,
      phase: 0,
      age: 0,
      drop: 0,
      mode: 'walk',
      modeT: 0,
      hopIn: 0,
      hopT: 0,
      lastX: 0,
    };
    this.all.push(e);
    this.paint(e);
    return e;
  }
}

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff26b });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a0a1e, flatShading: true });

function buildShield(): THREE.Group {
  const g = new THREE.Group();
  const w = SHIELD.halfW * 2;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, SHIELD.height, 0.12),
    new THREE.MeshBasicMaterial({ color: SHIELD_COLOR, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  panel.position.set(0, SHIELD.height / 2, SHIELD.ahead);
  g.add(panel);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x9cc8ff });
  for (const y of [0.04, SHIELD.height - 0.04]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.08, 0.16), rimMat);
    bar.position.set(0, y, SHIELD.ahead);
    g.add(bar);
  }
  for (const x of [-SHIELD.halfW, SHIELD.halfW]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, SHIELD.height, 0.16), rimMat);
    post.position.set(x, SHIELD.height / 2, SHIELD.ahead);
    g.add(post);
  }
  return g;
}

/** A limb that swings from a pivot at its top. */
function limb(w: number, len: number, mat: THREE.Material, x: number, y: number): THREE.Object3D {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
  m.position.y = -len / 2;
  pivot.add(m);
  return pivot;
}

const hazardMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
const tyreRimMat = new THREE.MeshBasicMaterial({ color: 0x29f0ff });
const crateEdgeMat = new THREE.LineBasicMaterial({ color: 0xd6b8ff });
const warnLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });

/** Obstacles: barrels, tyre stacks, crates and concrete barriers. */
function buildProp(kind: EnemyKind, spec: KindSpec, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const r = spec.radius;
  const h = spec.height;
  if (kind === 'barrel') {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, h, 14), mat);
    drum.position.y = h / 2;
    g.add(drum);
    for (const y of [0.22, 0.78]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.88, h * 0.08, 14), darkMat);
      band.position.y = h * y;
      g.add(band);
    }
    // Hazard stripe so it reads as "explosive".
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.87, r * 0.87, h * 0.12, 14), hazardMat);
    stripe.position.y = h * 0.5;
    g.add(stripe);
  } else if (kind === 'tyres') {
    const tyreGeo = new THREE.TorusGeometry(r * 0.66, r * 0.3, 8, 18);
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(tyreGeo, mat);
      t.rotation.x = Math.PI / 2;
      t.position.set((i % 2) * 0.06, r * 0.3 + i * r * 0.55, 0);
      g.add(t);
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.66, 0.035, 6, 24), tyreRimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = r * 0.3 + 2 * r * 0.55 + r * 0.31;
    g.add(rim);
  } else if (kind === 'crate') {
    const geo = new THREE.BoxGeometry(r * 1.6, h, r * 1.6);
    const box = new THREE.Mesh(geo, mat);
    box.position.y = h / 2;
    box.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), crateEdgeMat));
    g.add(box);
    // A gem emblem on the front: crates hold gems.
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.32, 0), new THREE.MeshBasicMaterial({ color: 0x3dffa8 }));
    gem.position.set(0, h / 2, r * 0.82);
    gem.scale.z = 0.3;
    g.add(gem);
  } else {
    const w = (spec.halfW ?? r) * 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7), mat);
    slab.position.y = h / 2;
    g.add(slab);
    // Black-and-yellow chevrons along the face.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w / n - 0.06, h * 0.22, 0.04), i % 2 ? darkMat : hazardMat);
      c.position.set(-w / 2 + (i + 0.5) * (w / n), h * 0.62, 0.37);
      g.add(c);
    }
    for (const s of [-1, 1]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), warnLightMat);
      light.position.set((s * w) / 2.6, h + 0.08, 0);
      g.add(light);
    }
  }
  return g;
}

function buildBody(kind: EnemyKind, spec: KindSpec, mat: THREE.Material): { body: THREE.Group; rig: Rig } {
  const g = new THREE.Group();
  const rig: Rig = { legs: [], arms: [], head: null, spin: null, detail: [] };
  const r = spec.radius;
  const h = spec.height;
  if (spec.prop) return { body: buildProp(kind, spec, mat), rig };

  if (kind === 'skitter') {
    // A squat, spiky little critter: one body mesh and one mesh for both eyes.
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    shell.scale.set(1.1, 0.75, 1);
    shell.position.y = h * 0.45;
    g.add(shell);
    const eyeL = new THREE.BoxGeometry(r * 0.32, r * 0.18, 0.05).translate(-r * 0.32, h * 0.55, r * 0.86);
    const eyeR = new THREE.BoxGeometry(r * 0.32, r * 0.18, 0.05).translate(r * 0.32, h * 0.55, r * 0.86);
    const eyes = new THREE.Mesh(mergeGeometries([eyeL, eyeR])!, eyeMat);
    g.add(eyes);
    rig.detail.push(eyes);
    return { body: g, rig };
  }

  if (kind === 'dasher') {
    // A hovering, pointed drone with a spinning ring: reads as "fast" at a glance.
    const hull = new THREE.Mesh(new THREE.ConeGeometry(r, h * 1.1, 5), mat);
    hull.rotation.x = Math.PI / 2.6;
    hull.position.y = h * 0.45;
    g.add(hull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.14, 0.05), eyeMat);
      eye.position.set(s * r * 0.3, h * 0.62, r * 0.75);
      g.add(eye);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, 0.05, r * 0.5), darkMat);
      fin.position.set(s * r * 0.8, h * 0.4, -r * 0.2);
      fin.rotation.z = s * 0.3;
      g.add(fin);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.05, 6, 20), eyeMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * 0.15;
    const spin = new THREE.Group();
    spin.add(ring);
    g.add(spin);
    rig.spin = spin;
    return { body: g, rig };
  }

  const hip = h * 0.32;
  // Legs
  for (const s of [-1, 1]) {
    const leg = limb(r * 0.32, hip, darkMat, s * r * 0.38, hip);
    g.add(leg);
    rig.legs.push(leg);
    rig.detail.push(leg);
  }
  // Torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.85, h * 0.45, 6), mat);
  torso.position.y = hip + h * 0.22;
  g.add(torso);
  // Arms
  const shoulder = hip + h * 0.4;
  for (const s of [-1, 1]) {
    const arm = limb(r * 0.26, h * 0.36, mat, s * r * 0.95, shoulder);
    g.add(arm);
    rig.arms.push(arm);
    rig.detail.push(arm);
  }

  // Head with horns and glowing eyes facing the squad (+z).
  const head = new THREE.Group();
  head.position.y = h * 0.82;
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.58, 0), mat);
  head.add(skull);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.6, 4), darkMat);
    horn.position.set(s * r * 0.42, h * 0.16, 0);
    horn.rotation.z = -s * 0.5;
    head.add(horn);
    rig.detail.push(horn);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(r * 0.22, r * 0.12, 0.05), eyeMat);
    eye.position.set(s * r * 0.24, h * 0.03, r * 0.52);
    head.add(eye);
  }
  if (kind === 'boss') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.45, r * 0.3, 6, 1, true), eyeMat);
    crown.position.y = h * 0.24;
    head.add(crown);
  }
  g.add(head);
  rig.head = head;

  if (kind === 'brute' || kind === 'boss' || kind === 'bearer') {
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.35, r * 0.7), darkMat);
      pad.position.set(s * r * 0.85, shoulder + r * 0.1, 0);
      g.add(pad);
      rig.detail.push(pad);
    }
  }
  return { body: g, rig };
}
