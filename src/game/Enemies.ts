import * as THREE from 'three';
import { TextLabel, labelSprite } from '../render/Label';

export type EnemyKind = 'grunt' | 'brute' | 'boss';

interface KindSpec {
  radius: number;
  height: number;
  speed: number; // walking speed towards the squad
  color: number;
  gems: number;
  labelW: number;
}

export const ENEMY_SPECS: Record<EnemyKind, KindSpec> = {
  grunt: { radius: 0.55, height: 1.35, speed: 2.5, color: 0xff3b4e, gems: 1, labelW: 1.6 },
  brute: { radius: 0.95, height: 2.2, speed: 1.8, color: 0xff7a1a, gems: 3, labelW: 2.0 },
  boss: { radius: 2.0, height: 4.2, speed: 1.6, color: 0xff2b8a, gems: 0, labelW: 3.2 },
};

const DESPAWN_Z = 4;
const FLASH_TIME = 0.07;

export interface Enemy {
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Object3D;
  mat: THREE.MeshLambertMaterial;
  label: TextLabel;
  hp: number;
  maxHp: number;
  flash: number;
  /** When false the enemy holds its ground (the boss before the arena). */
  walking: boolean;
}

export class Enemies {
  readonly active: Enemy[] = [];
  private free: Record<EnemyKind, Enemy[]> = { grunt: [], brute: [], boss: [] };

  constructor(private parent: THREE.Object3D) {
    for (let i = 0; i < 30; i++) this.free.grunt.push(this.create('grunt'));
    for (let i = 0; i < 10; i++) this.free.brute.push(this.create('brute'));
    this.free.boss.push(this.create('boss'));
  }

  spawn(kind: EnemyKind, x: number, z: number, hp: number): Enemy {
    const e = this.free[kind].pop() ?? this.create(kind);
    e.hp = e.maxHp = hp;
    e.flash = 0;
    e.walking = kind !== 'boss';
    e.group.position.set(x, 0, z);
    e.group.visible = true;
    e.label.set(String(Math.ceil(hp)));
    this.active.push(e);
    return e;
  }

  /** Returns true when the hit killed the enemy. */
  damage(e: Enemy, amount: number): boolean {
    e.hp -= amount;
    e.flash = FLASH_TIME;
    e.label.set(String(Math.max(0, Math.ceil(e.hp))));
    return e.hp <= 0;
  }

  update(dt: number, dz: number, time: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      const p = e.group.position;
      p.z += dz + (e.walking ? ENEMY_SPECS[e.kind].speed * dt : 0);
      if (p.z > DESPAWN_Z) {
        this.release(e);
        continue;
      }
      // Waddle, plus a quick white flash and squash when hit.
      e.flash = Math.max(0, e.flash - dt);
      const hit = e.flash > 0 ? 1 : 0;
      e.mat.emissiveIntensity = hit ? 2.5 : 1;
      e.body.scale.set(1 + hit * 0.12, 1 - hit * 0.08, 1 + hit * 0.12);
      e.body.rotation.z = e.walking ? Math.sin(time * 9 + p.x * 3) * 0.12 : 0;
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

    group.visible = false;
    this.parent.add(group);
    return { kind, group, body, mat, label, hp: 0, maxHp: 0, flash: 0, walking: true };
  }
}

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff26b });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a0a1e });

function buildBody(kind: EnemyKind, spec: KindSpec, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const r = spec.radius;
  const h = spec.height;

  // Chunky low-poly torso.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h * 0.75, 6), mat);
  torso.position.y = h * 0.375;
  g.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.62, 0), mat);
  head.position.y = h * 0.82;
  g.add(head);

  // Horns
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

  if (kind !== 'grunt') {
    // Shoulder plates for the bigger ones.
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
