import * as THREE from 'three';
import { COLORS } from '../render/Scene';
import { type AABB, setAABB } from './Collision';

const SIZE = 0.6;
const DESPAWN_Z = 8;
const POOL_SIZE = 40;

/** Glowing orbs that add bonus score. */
export class Pickups {
  readonly active: THREE.Object3D[] = [];
  private free: THREE.Object3D[] = [];
  private coreGeo = new THREE.OctahedronGeometry(0.22, 0);
  private shellGeo = new THREE.IcosahedronGeometry(0.34, 0);
  private coreMat = new THREE.MeshBasicMaterial({ color: COLORS.yellow });
  private shellMat = new THREE.MeshBasicMaterial({ color: COLORS.pink, wireframe: true });

  constructor(private parent: THREE.Object3D) {
    for (let i = 0; i < POOL_SIZE; i++) this.free.push(this.create());
  }

  spawn(x: number, y: number, z: number): void {
    const p = this.free.pop() ?? this.create();
    p.position.set(x, y, z);
    p.userData.baseY = y;
    p.visible = true;
    this.active.push(p);
  }

  update(dz: number, time: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.position.z += dz;
      p.position.y = p.userData.baseY + Math.sin(time * 4 + p.position.z * 0.3) * 0.12;
      p.rotation.y = time * 3;
      if (p.position.z > DESPAWN_Z) this.release(i);
    }
  }

  getBox(p: THREE.Object3D, out: AABB): AABB {
    return setAABB(out, p.position.x, p.position.y - SIZE / 2, p.position.z, SIZE, SIZE, SIZE);
  }

  release(i: number): void {
    const p = this.active[i];
    p.visible = false;
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    this.free.push(p);
  }

  reset(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(i);
  }

  private create(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.coreGeo, this.coreMat));
    g.add(new THREE.Mesh(this.shellGeo, this.shellMat));
    g.visible = false;
    this.parent.add(g);
    return g;
  }
}
