import * as THREE from 'three';
import { TextLabel } from '../render/Label';

const HEIGHT = 2.4;
const DEPTH = 0.3; // half-depth used for bullet hits
const DESPAWN_Z = 4;
const MAX_VALUE = 999;

export const GATE_GOOD = 0x22ff88;
export const GATE_BAD = 0xff3355;

export interface Gate {
  group: THREE.Group;
  panelMat: THREE.MeshBasicMaterial;
  frameMat: THREE.MeshBasicMaterial;
  panel: THREE.Mesh;
  posts: THREE.Mesh[];
  top: THREE.Mesh;
  text: TextLabel;
  value: number;
  /** Points absorbed towards the next +1. */
  progress: number;
  x0: number;
  x1: number;
  pair: GatePair | null;
}

export interface GatePair {
  gates: Gate[];
  z: number;
}

export interface GateDef {
  x0: number;
  x1: number;
  value: number;
}

/** +N / −N gates. Walking through one changes the squad size; shooting one raises its number. */
export class Gates {
  readonly pairs: GatePair[] = [];
  private free: Gate[] = [];
  private postGeo = new THREE.BoxGeometry(0.2, HEIGHT + 0.3, 0.2);
  private barGeo = new THREE.BoxGeometry(1, 0.2, 0.2);
  private panelGeo = new THREE.PlaneGeometry(1, HEIGHT);
  private textGeo = new THREE.PlaneGeometry(2.6, 1.3);

  constructor(private parent: THREE.Object3D) {
    for (let i = 0; i < 8; i++) this.free.push(this.create());
  }

  spawnPair(defs: GateDef[], z: number): void {
    const pair: GatePair = { gates: [], z };
    for (const d of defs) {
      const g = this.free.pop() ?? this.create();
      const w = d.x1 - d.x0;
      g.x0 = d.x0;
      g.x1 = d.x1;
      g.progress = 0;
      g.pair = pair;
      g.group.position.set((d.x0 + d.x1) / 2, 0, z);
      g.panel.scale.x = w;
      g.top.scale.x = w + 0.2;
      g.posts[0].position.x = -w / 2;
      g.posts[1].position.x = w / 2;
      g.group.visible = true;
      this.setValue(g, d.value);
      pair.gates.push(g);
    }
    this.pairs.push(pair);
  }

  /** Bullet hit: every `cost` points absorbed raises the gate by one. Returns the gain. */
  hit(g: Gate, points: number, cost: number): number {
    g.progress += points;
    const gain = Math.floor(g.progress / cost);
    if (gain > 0) {
      g.progress -= gain * cost;
      this.setValue(g, Math.min(MAX_VALUE, g.value + gain));
    }
    return gain;
  }

  /** Gate at world x within `pair`, if any. */
  gateAt(pair: GatePair, x: number): Gate | null {
    for (const g of pair.gates) if (x >= g.x0 && x <= g.x1) return g;
    // Between two half-gates: take the closer one so the squad never slips through a gap.
    let best: Gate | null = null;
    let bestD = Infinity;
    for (const g of pair.gates) {
      const d = Math.min(Math.abs(x - g.x0), Math.abs(x - g.x1));
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  }

  /** Does a bullet at (x, z) hit a gate? */
  bulletHit(x: number, z: number): Gate | null {
    for (const pair of this.pairs) {
      if (Math.abs(z - pair.z) > DEPTH) continue;
      for (const g of pair.gates) if (x >= g.x0 && x <= g.x1) return g;
    }
    return null;
  }

  update(dz: number): void {
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const pair = this.pairs[i];
      pair.z += dz;
      for (const g of pair.gates) g.group.position.z = pair.z;
      if (pair.z > DESPAWN_Z) this.removePair(pair);
    }
  }

  removePair(pair: GatePair): void {
    const i = this.pairs.indexOf(pair);
    if (i >= 0) this.pairs.splice(i, 1);
    for (const g of pair.gates) {
      g.group.visible = false;
      g.pair = null;
      this.free.push(g);
    }
    pair.gates.length = 0;
  }

  reset(): void {
    while (this.pairs.length) this.removePair(this.pairs[0]);
  }

  private setValue(g: Gate, v: number): void {
    g.value = v;
    const good = v > 0;
    const color = good ? GATE_GOOD : GATE_BAD;
    g.panelMat.color.setHex(color);
    g.frameMat.color.setHex(color);
    g.text.set(v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
  }

  private create(): Gate {
    const group = new THREE.Group();
    const panelMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshBasicMaterial();

    const panel = new THREE.Mesh(this.panelGeo, panelMat);
    panel.position.y = HEIGHT / 2;
    group.add(panel);

    const posts = [new THREE.Mesh(this.postGeo, frameMat), new THREE.Mesh(this.postGeo, frameMat)];
    for (const p of posts) {
      p.position.y = (HEIGHT + 0.3) / 2;
      group.add(p);
    }
    const top = new THREE.Mesh(this.barGeo, frameMat);
    top.position.y = HEIGHT + 0.2;
    group.add(top);

    const text = new TextLabel(256, 128, { color: '#ffffff' });
    const textMesh = new THREE.Mesh(
      this.textGeo,
      new THREE.MeshBasicMaterial({ map: text.texture, transparent: true, depthWrite: false, fog: false }),
    );
    textMesh.position.set(0, HEIGHT * 0.55, 0.06);
    textMesh.renderOrder = 5;
    group.add(textMesh);

    group.visible = false;
    this.parent.add(group);
    return { group, panelMat, frameMat, panel, posts, top, text, value: 0, progress: 0, x0: 0, x1: 0, pair: null };
  }
}
