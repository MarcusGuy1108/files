import * as THREE from 'three';
import { COLORS } from '../render/Scene';

const MAX = 700;
export const BULLET_SPEED = 55;
const MAX_TRAVEL = 75;
const Y = 0.45;

/**
 * Bullets as flat arrays plus one InstancedMesh. Active bullets are kept packed at the
 * front of the arrays (swap-remove), so rendering is a single draw call.
 */
export class Bullets {
  n = 0;
  readonly x = new Float32Array(MAX);
  readonly z = new Float32Array(MAX);
  readonly dmg = new Float32Array(MAX);
  private travel = new Float32Array(MAX);
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.7);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: COLORS.yellow }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  spawn(x: number, z: number, dmg: number): void {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.x[i] = x;
    this.z[i] = z;
    this.dmg[i] = dmg;
    this.travel[i] = 0;
  }

  /** Move every bullet forward and drop the ones that flew out of range. */
  advance(dt: number): void {
    const d = BULLET_SPEED * dt;
    for (let i = this.n - 1; i >= 0; i--) {
      this.z[i] -= d;
      this.travel[i] += d;
      if (this.travel[i] > MAX_TRAVEL) this.remove(i);
    }
  }

  remove(i: number): void {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.z[i] = this.z[last];
    this.dmg[i] = this.dmg[last];
    this.travel[i] = this.travel[last];
  }

  clear(): void {
    this.n = 0;
  }

  sync(): void {
    for (let i = 0; i < this.n; i++) {
      this.dummy.position.set(this.x[i], Y, this.z[i]);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
