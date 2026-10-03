import * as THREE from 'three';

export const METEOR_RADIUS = 1.4;
const MAX = 16;
const FALL_HEIGHT = 26;

interface Hazard {
  x: number;
  z: number;
  /** Seconds until impact, and the total. */
  t: number;
  total: number;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  rock: THREE.Group;
  core: THREE.Mesh;
}

/**
 * Meteor strikes: a red ring marks the spot, a rock falls onto it. Purely visual; the
 * simulation decides who gets hit, so both co-op screens can draw these from events.
 */
export class Hazards {
  private active: Hazard[] = [];
  private free: Hazard[] = [];

  constructor(private parent: THREE.Object3D) {
    for (let i = 0; i < MAX; i++) this.free.push(this.create());
  }

  spawn(x: number, z: number, t: number): void {
    const h = this.free.pop();
    if (!h) return;
    h.x = x;
    h.z = z;
    h.t = h.total = t;
    h.ring.visible = h.rock.visible = true;
    this.active.push(h);
  }

  update(dt: number, dz: number, time: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const h = this.active[i];
      h.t -= dt;
      h.z += dz;
      if (h.t <= 0) {
        h.ring.visible = h.rock.visible = false;
        this.active.splice(i, 1);
        this.free.push(h);
        continue;
      }
      const u = 1 - h.t / h.total; // 0 → 1 as it falls
      const s = METEOR_RADIUS * (0.4 + 0.6 * u);
      h.ring.position.set(h.x, 0.04, h.z);
      h.ring.scale.set(s, s, 1);
      h.ringMat.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * (8 + u * 20)));
      // Falls along a slanted path so it reads as coming from the sky ahead.
      const k = 1 - u;
      h.rock.position.set(h.x + k * 6, k * k * FALL_HEIGHT + 0.4, h.z - k * 18);
      h.core.rotation.set(time * 4, time * 3, 0);
    }
  }

  clear(): void {
    for (const h of this.active) {
      h.ring.visible = h.rock.visible = false;
      this.free.push(h);
    }
    this.active.length = 0;
  }

  private create(): Hazard {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2a3a,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0xff3300, flatShading: true }),
    );
    // Glowing tail pointing back up the fall path.
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 3.2, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb03f, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    tail.position.set(0.5, 1.7, -1.5);
    tail.rotation.set(-1.2, 0, -0.3);
    const holder = new THREE.Group();
    holder.add(core, tail);
    ring.visible = holder.visible = false;
    this.parent.add(ring, holder);
    return { x: 0, z: 0, t: 0, total: 1, ring, ringMat, rock: holder, core };
  }
}
