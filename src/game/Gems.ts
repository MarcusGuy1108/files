import * as THREE from 'three';

const MAX = 160;
const DESPAWN_Z = 6;
export const GEM_COLOR = 0x3dffa8;

/** Gem pickups lying on the track. Rendered as one InstancedMesh. */
export class Gems {
  n = 0;
  readonly x = new Float32Array(MAX);
  readonly z = new Float32Array(MAX);
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.OctahedronGeometry(0.26, 0);
    geo.scale(1, 1.4, 1);
    const mat = new THREE.MeshLambertMaterial({ color: GEM_COLOR, emissive: 0x0d7a48, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  spawn(x: number, z: number): void {
    if (this.n >= MAX) return;
    this.x[this.n] = x;
    this.z[this.n] = z;
    this.n++;
  }

  update(dz: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.z[i] += dz;
      if (this.z[i] > DESPAWN_Z) this.remove(i);
    }
  }

  remove(i: number): void {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.z[i] = this.z[last];
  }

  clear(): void {
    this.n = 0;
  }

  sync(time: number): void {
    for (let i = 0; i < this.n; i++) {
      this.dummy.position.set(this.x[i], 0.55 + Math.sin(time * 4 + this.z[i] * 0.4) * 0.1, this.z[i]);
      this.dummy.rotation.set(0, time * 2.5 + i, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
