import * as THREE from 'three';
import { TextLabel, labelSprite } from '../render/Label';

export type EnemyKind = 'grunt' | 'brute' | 'dasher' | 'bearer' | 'boss';
export const ENEMY_KINDS: EnemyKind[] = ['grunt', 'brute', 'dasher', 'bearer', 'boss'];

interface KindSpec {
  radius: number;
  height: number;
  speed: number; // walking speed towards the squad
  color: number;
  /** Gem pickups dropped on death: `chance` of dropping `count`. */
  drop: { chance: number; count: number };
  labelW: number;
}

export const ENEMY_SPECS: Record<EnemyKind, KindSpec> = {
  grunt: { radius: 0.55, height: 1.35, speed: 2.5, color: 0xff3b4e, drop: { chance: 0.3, count: 1 }, labelW: 1.6 },
  brute: { radius: 0.95, height: 2.2, speed: 1.8, color: 0xff7a1a, drop: { chance: 1, count: 2 }, labelW: 2.0 },
  dasher: { radius: 0.45, height: 1.0, speed: 6.5, color: 0xb45cff, drop: { chance: 0.25, count: 1 }, labelW: 1.3 },
  bearer: { radius: 0.85, height: 2.0, speed: 1.6, color: 0x4d7cff, drop: { chance: 1, count: 2 }, labelW: 1.8 },
  boss: { radius: 2.0, height: 4.2, speed: 1.6, color: 0xff2b8a, drop: { chance: 0, count: 0 }, labelW: 3.2 },
};

/** Shield bearers carry a wall in front of them that soaks up bullets until it breaks. */
export const SHIELD = { halfW: 1.15, height: 1.8, depth: 0.25, ahead: 1.05 };
export const SHIELD_COLOR = 0x4d9cff;

const DESPAWN_Z = 4;
const FLASH_TIME = 0.07;
/** Dashers steer towards the nearest squad at this sideways speed. */
const DASHER_STEER = 2.4;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Object3D;
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
}

export class Enemies {
  readonly active: Enemy[] = [];
  private free: Record<EnemyKind, Enemy[]> = { grunt: [], brute: [], dasher: [], bearer: [], boss: [] };
  private nextId = 1;

  constructor(private parent: THREE.Object3D) {
    const prewarm: [EnemyKind, number][] = [
      ['grunt', 30],
      ['brute', 10],
      ['dasher', 12],
      ['bearer', 6],
      ['boss', 1],
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
    e.walking = kind !== 'boss';
    e.group.position.set(x, 0, z);
    e.group.visible = true;
    e.label.set(String(Math.ceil(hp)));
    if (e.shield) e.shield.visible = shieldHp > 0;
    e.shieldLabel?.set(String(Math.ceil(shieldHp)));
    this.active.push(e);
    return e;
  }

  byId(id: number): Enemy | undefined {
    return this.active.find((e) => e.id === id);
  }

  /** Returns true when the hit killed the enemy. */
  damage(e: Enemy, amount: number): boolean {
    this.setHp(e, e.hp - amount);
    e.flash = FLASH_TIME;
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
    e.label.set(String(Math.max(0, Math.ceil(hp))));
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

  /**
   * Move everyone. `squadXs` are the squads' x positions, for dashers to home in on.
   * The co-op guest passes `despawn: false` and lets snapshots decide who leaves.
   */
  update(dt: number, dz: number, time: number, squadXs: number[], despawn = true): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      const p = e.group.position;
      const spec = ENEMY_SPECS[e.kind];
      p.z += dz + (e.walking ? spec.speed * dt : 0);
      if (e.kind === 'dasher' && p.z > -45 && squadXs.length) {
        let tx = squadXs[0];
        for (const x of squadXs) if (Math.abs(x - p.x) < Math.abs(tx - p.x)) tx = x;
        const step = DASHER_STEER * dt;
        p.x += Math.max(-step, Math.min(step, tx - p.x));
      }
      if (despawn && p.z > DESPAWN_Z) {
        this.release(e);
        continue;
      }
      // Waddle, plus a quick flash and squash when hit.
      e.flash = Math.max(0, e.flash - dt);
      const hit = e.flash > 0 ? 1 : 0;
      e.mat.emissiveIntensity = hit ? 2.5 : 1;
      e.body.scale.set(1 + hit * 0.12, 1 - hit * 0.08, 1 + hit * 0.12);
      const wobble = e.kind === 'dasher' ? 18 : 9;
      e.body.rotation.z = e.walking ? Math.sin(time * wobble + p.x * 3) * 0.12 : 0;
    }
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
    const body = buildBody(kind, spec, mat);
    group.add(body);

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
    return {
      id: 0,
      kind,
      group,
      body,
      mat,
      label,
      hp: 0,
      maxHp: 0,
      shieldHp: 0,
      shield,
      shieldLabel,
      flash: 0,
      walking: true,
    };
  }
}

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff26b });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a0a1e });

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

function buildBody(kind: EnemyKind, spec: KindSpec, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const r = spec.radius;
  const h = spec.height;

  if (kind === 'dasher') {
    // Low, pointed and leaning forward: reads as "fast" at a glance.
    const hull = new THREE.Mesh(new THREE.ConeGeometry(r, h * 1.1, 5), mat);
    hull.rotation.x = Math.PI / 2.6;
    hull.position.y = h * 0.45;
    g.add(hull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.14, 0.05), eyeMat);
      eye.position.set(s * r * 0.3, h * 0.62, r * 0.75);
      g.add(eye);
    }
    return g;
  }

  // Chunky low-poly torso.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h * 0.75, 6), mat);
  torso.position.y = h * 0.375;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.62, 0), mat);
  head.position.y = h * 0.82;
  g.add(head);

  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.6, 4), darkMat);
    horn.position.set(s * r * 0.42, h * 0.98, 0);
    horn.rotation.z = -s * 0.5;
    g.add(horn);
  }

  // Glowing eyes facing the squad (+z).
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(r * 0.22, r * 0.12, 0.05), eyeMat);
    eye.position.set(s * r * 0.24, h * 0.85, r * 0.56);
    g.add(eye);
  }

  if (kind === 'brute' || kind === 'boss' || kind === 'bearer') {
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.35, r * 0.7), darkMat);
      pad.position.set(s * r * 0.85, h * 0.68, 0);
      g.add(pad);
    }
  }
  if (kind === 'boss') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.45, r * 0.3, 6, 1, true), eyeMat);
    crown.position.y = h * 1.06;
    g.add(crown);
  }
  return g;
}
