import * as THREE from 'three';
import { COLORS } from '../render/Scene';
import { TextLabel, labelSprite } from '../render/Label';
import { TRACK_HALF } from './Track';

/** Members drawn individually; bigger squads still count (and fire) in full. */
export const MAX_VISIBLE = 80;
const SPACING = 0.34;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const STEER_SMOOTHING = 22;

/** The player's crowd: a formation of members that moves left and right as one. */
export class Squad {
  count = 0;
  x = 0;
  private targetX = 0;
  private shown = 0;

  private bodies: THREE.InstancedMesh;
  private guns: THREE.InstancedMesh;
  /** Current formation offsets (x, z) per member; they ease towards the target slots. */
  private offsets = new Float32Array(MAX_VISIBLE * 2);
  private dummy = new THREE.Object3D();
  private label = new TextLabel(256, 128, { bg: 'rgba(8, 20, 40, 0.85)', border: '#29f0ff' });
  private labelSprite: THREE.Sprite;

  constructor(parent: THREE.Object3D) {
    const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.36, 3, 8);
    bodyGeo.translate(0, 0.34, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3fd2ff, emissive: 0x062a38 });
    this.bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_VISIBLE);

    const gunGeo = new THREE.BoxGeometry(0.07, 0.07, 0.34);
    gunGeo.translate(0.13, 0.42, -0.18);
    this.guns = new THREE.InstancedMesh(gunGeo, new THREE.MeshBasicMaterial({ color: COLORS.yellow }), MAX_VISIBLE);

    for (const m of [this.bodies, this.guns]) {
      m.count = 0;
      m.frustumCulled = false;
      parent.add(m);
    }

    this.labelSprite = labelSprite(this.label, 1.5, 0.75);
    parent.add(this.labelSprite);
  }

  get visible(): number {
    return Math.min(this.count, MAX_VISIBLE);
  }

  /** Approximate footprint radius of the formation. */
  get radius(): number {
    return SPACING * Math.sqrt(Math.max(1, this.visible)) + 0.2;
  }

  reset(count: number): void {
    this.count = count;
    this.x = this.targetX = 0;
    this.shown = 0;
    this.offsets.fill(0);
    this.update(0, 0, false);
  }

  add(n: number): void {
    this.count = Math.max(0, Math.round(this.count + n));
  }

  steer(dx: number): void {
    const lim = TRACK_HALF - 0.5;
    this.targetX = THREE.MathUtils.clamp(this.targetX + dx, -lim, lim);
  }

  /** World position of member `i`, used as a muzzle for bullets. */
  memberX(i: number): number {
    return this.memberWorldX(this.offsets[i * 2]);
  }

  memberZ(i: number): number {
    return this.offsets[i * 2 + 1];
  }

  update(dt: number, time: number, running: boolean): void {
    this.x += (this.targetX - this.x) * Math.min(1, dt * STEER_SMOOTHING);

    const n = this.visible;
    // New members appear in the middle and spread out to their slot.
    for (let i = this.shown; i < n; i++) {
      this.offsets[i * 2] = 0;
      this.offsets[i * 2 + 1] = 0;
    }
    this.shown = n;

    const ease = Math.min(1, dt * 8);
    for (let i = 0; i < n; i++) {
      const r = SPACING * Math.sqrt(i);
      const a = i * GOLDEN_ANGLE;
      const tx = Math.cos(a) * r;
      const tz = Math.sin(a) * r * 0.8;
      const ox = (this.offsets[i * 2] += (tx - this.offsets[i * 2]) * ease);
      const oz = (this.offsets[i * 2 + 1] += (tz - this.offsets[i * 2 + 1]) * ease);

      const bob = running ? Math.abs(Math.sin(time * 13 + i * 1.7)) * 0.07 : 0;
      this.dummy.position.set(this.memberWorldX(ox), bob, oz);
      this.dummy.rotation.set(0, 0, running ? Math.sin(time * 13 + i * 1.7) * 0.08 : 0);
      this.dummy.updateMatrix();
      this.bodies.setMatrixAt(i, this.dummy.matrix);
      this.guns.setMatrixAt(i, this.dummy.matrix);
    }
    this.bodies.count = this.guns.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.guns.instanceMatrix.needsUpdate = true;

    this.label.set(String(this.count));
    this.labelSprite.visible = this.count > 0;
    this.labelSprite.position.set(this.x, 1.5, -this.radius * 0.6);
  }

  private memberWorldX(offset: number): number {
    const lim = TRACK_HALF + 0.2;
    return THREE.MathUtils.clamp(this.x + offset, -lim, lim);
  }
}
