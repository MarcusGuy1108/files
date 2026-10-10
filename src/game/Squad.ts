import * as THREE from 'three';
import { COLORS } from '../render/Scene';
import { TextLabel, labelSprite } from '../render/Label';
import { TRACK_HALF } from './Track';
import { fmtCount } from './Enemies';

/** Members drawn individually; bigger squads still count (and fire) in full. */
export const MAX_VISIBLE = 80;
const SPACING = 0.34;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const STEER_SMOOTHING = 22;
/** How far a squad can move forward (negative z) and back from the line. */
export const Z_FORWARD = -6;
export const Z_BACK = 1.5;

/** The player's crowd: a formation of members that moves left and right as one. */
export interface SquadLook {
  body: number;
  emissive: number;
  border: string;
}

export const LOOK_SELF: SquadLook = { body: 0x3fd2ff, emissive: 0x062a38, border: '#29f0ff' };
export const LOOK_PARTNER: SquadLook = { body: 0xc58bff, emissive: 0x2a0c40, border: '#c58bff' };

export class Squad {
  count = 0;
  x = 0;
  targetX = 0;
  /** Forward/back position (negative = further up the track). */
  z = 0;
  targetZ = 0;
  private shown = 0;
  private group = new THREE.Group();
  private bodyMat: THREE.MeshLambertMaterial;
  private bubble: THREE.Mesh;

  private bodies: THREE.InstancedMesh;
  private guns: THREE.InstancedMesh;
  /** A player-drawn character, shown instead of the standard body when set. */
  private skin: THREE.InstancedMesh | null = null;
  /** Current formation offsets (x, z) per member; they ease towards the target slots. */
  private offsets = new Float32Array(MAX_VISIBLE * 2);
  private dummy = new THREE.Object3D();
  private label: TextLabel;
  private labelSprite: THREE.Sprite;
  private nameLabel: TextLabel;
  private nameSprite: THREE.Sprite;

  constructor(parent: THREE.Object3D, look: SquadLook = LOOK_SELF) {
    const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.36, 3, 8);
    bodyGeo.translate(0, 0.34, 0);
    this.bodyMat = new THREE.MeshLambertMaterial({ color: look.body, emissive: look.emissive });
    this.bodies = new THREE.InstancedMesh(bodyGeo, this.bodyMat, MAX_VISIBLE);

    const gunGeo = new THREE.BoxGeometry(0.07, 0.07, 0.34);
    gunGeo.translate(0.13, 0.42, -0.18);
    this.guns = new THREE.InstancedMesh(gunGeo, new THREE.MeshBasicMaterial({ color: COLORS.yellow }), MAX_VISIBLE);

    for (const m of [this.bodies, this.guns]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }

    // Shield power-up: a translucent dome over the formation.
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4d9cff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.bubble.visible = false;
    this.group.add(this.bubble);

    this.label = new TextLabel(256, 128, { bg: 'rgba(8, 20, 40, 0.85)', border: look.border });
    this.labelSprite = labelSprite(this.label, 1.5, 0.75);
    this.group.add(this.labelSprite);
    // Player name (co-op), above the count.
    this.nameLabel = new TextLabel(320, 80, { color: look.border });
    this.nameSprite = labelSprite(this.nameLabel, 2.4, 0.6);
    this.nameSprite.visible = false;
    this.group.add(this.nameSprite);
    parent.add(this.group);
  }

  /** Draw members as the player's own drawing (a texture), or the standard figure with null. */
  setSkin(tex: THREE.Texture | null): void {
    if (tex && !this.skin) {
      // Upright card leaning back a little towards the camera, feet on the ground.
      const geo = new THREE.PlaneGeometry(0.7, 0.7);
      geo.rotateX(-0.25);
      geo.translate(0, 0.36, 0);
      // Slightly dimmed so the glow effect doesn't wash the player's colours out.
      const mat = new THREE.MeshBasicMaterial({ color: 0xb0b0b0, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
      this.skin = new THREE.InstancedMesh(geo, mat, MAX_VISIBLE);
      this.skin.count = 0;
      this.skin.frustumCulled = false;
      this.group.add(this.skin);
    }
    if (this.skin) {
      const mat = this.skin.material as THREE.MeshBasicMaterial;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      this.skin.visible = !!tex;
    }
    this.bodies.visible = this.guns.visible = !tex;
  }

  setLook(look: SquadLook): void {
    this.bodyMat.color.setHex(look.body);
    this.bodyMat.emissive.setHex(look.emissive);
    this.label.setBorder(look.border);
    this.nameLabel.set(this.name, look.border);
  }

  private name = '';

  /** Show a player name over the squad (co-op), or hide it with null. */
  setName(name: string | null): void {
    this.name = name ?? '';
    this.nameLabel.set(this.name);
    this.nameSprite.visible = !!name;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  setShield(on: boolean): void {
    this.bubble.visible = on;
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
    this.z = this.targetZ = 0;
    this.shown = 0;
    this.offsets.fill(0);
    this.update(0, 0, false);
  }

  add(n: number): void {
    this.count = Math.max(0, Math.round(this.count + n));
  }

  steer(dx: number): void {
    this.setTarget(this.targetX + dx);
  }

  setTarget(x: number): void {
    const lim = TRACK_HALF - 0.5;
    this.targetX = THREE.MathUtils.clamp(x, -lim, lim);
  }

  steerZ(dz: number): void {
    this.setTargetZ(this.targetZ + dz);
  }

  setTargetZ(z: number): void {
    this.targetZ = THREE.MathUtils.clamp(z, Z_FORWARD, Z_BACK);
  }

  /** World position of member `i`, used as a muzzle for bullets. */
  memberX(i: number): number {
    return this.memberWorldX(this.offsets[i * 2]);
  }

  memberZ(i: number): number {
    return this.offsets[i * 2 + 1] + this.z;
  }

  update(dt: number, time: number, running: boolean): void {
    this.x += (this.targetX - this.x) * Math.min(1, dt * STEER_SMOOTHING);
    this.z += (this.targetZ - this.z) * Math.min(1, dt * STEER_SMOOTHING * 0.6);
    this.group.position.z = this.z;

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
      this.skin?.setMatrixAt(i, this.dummy.matrix);
    }
    this.bodies.count = this.guns.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.guns.instanceMatrix.needsUpdate = true;
    if (this.skin) {
      this.skin.count = n;
      this.skin.instanceMatrix.needsUpdate = true;
    }

    this.label.set(fmtCount(this.count));
    this.labelSprite.visible = this.count > 0;
    this.labelSprite.position.set(this.x, 1.5, -this.radius * 0.6);
    this.nameSprite.position.set(this.x, 2.2, -this.radius * 0.6);
    this.nameSprite.visible = !!this.name && this.count > 0;
    if (this.bubble.visible) {
      const r = this.radius + 0.5;
      this.bubble.position.set(this.x, 0, 0);
      this.bubble.scale.set(r, r * 0.8, r);
    }
  }

  private memberWorldX(offset: number): number {
    const lim = TRACK_HALF + 0.2;
    return THREE.MathUtils.clamp(this.x + offset, -lim, lim);
  }
}
