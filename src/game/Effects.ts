import * as THREE from 'three';

const MAX = 400;
const GRAVITY = 18;

/** Pooled debris particles for hits, kills and pickups. */
export class Effects {
  private n = 0;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private colors: THREE.Color[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.colors.push(new THREE.Color());
      this.mesh.setColorAt(i, this.colors[i]);
    }
    parent.add(this.mesh);
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed = 6, size = 0.16): void {
    this.tmpColor.setHex(color);
    for (let k = 0; k < count && this.n < MAX; k++) {
      const i = this.n++;
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * s, up * s, Math.sin(a) * s], i * 3);
      this.maxLife[i] = this.life[i] = 0.45 + Math.random() * 0.35;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.colors[i].copy(this.tmpColor);
    }
  }

  /** `dz` is the world scroll this step, so debris stays put on the ground. */
  update(dt: number, dz: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      const p = i * 3;
      this.vel[p + 1] -= GRAVITY * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] = Math.max(0.05, this.pos[p + 1] + this.vel[p + 1] * dt);
      this.pos[p + 2] += this.vel[p + 2] * dt + dz;
    }
  }

  clear(): void {
    this.n = 0;
  }

  sync(): void {
    for (let i = 0; i < this.n; i++) {
      const p = i * 3;
      const s = this.size[i] * (this.life[i] / this.maxLife[i]);
      this.dummy.position.set(this.pos[p], this.pos[p + 1], this.pos[p + 2]);
      this.dummy.scale.setScalar(s);
      this.dummy.rotation.set(this.life[i] * 9, this.life[i] * 7, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private removeAt(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.colors[i].copy(this.colors[last]);
  }
}
