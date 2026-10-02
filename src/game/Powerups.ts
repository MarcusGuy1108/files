import * as THREE from 'three';
import { TextLabel, labelSprite } from '../render/Label';

export type PowerKind = 'rapid' | 'damage' | 'shield';
export const POWER_KINDS: PowerKind[] = ['rapid', 'damage', 'shield'];

export const POWER_SPECS: Record<PowerKind, { name: string; short: string; color: number; css: string; duration: number }> = {
  rapid: { name: 'RAPID FIRE', short: 'RAPID', color: 0xffd23f, css: '#ffd23f', duration: 6 },
  damage: { name: 'DOUBLE DAMAGE', short: '×2 DMG', color: 0xff6a2b, css: '#ff6a2b', duration: 6 },
  shield: { name: 'SHIELD', short: 'SHIELD', color: 0x4d9cff, css: '#4d9cff', duration: 8 },
};

const DESPAWN_Z = 6;

export interface Powerup {
  id: number;
  kind: PowerKind;
  group: THREE.Group;
}

/** Floating power-up pickups: a spinning ring with a coloured core and a name tag. */
export class Powerups {
  readonly active: Powerup[] = [];
  private free: Record<PowerKind, Powerup[]> = { rapid: [], damage: [], shield: [] };
  private nextId = 1;

  constructor(private parent: THREE.Object3D) {
    for (const k of POWER_KINDS) for (let i = 0; i < 3; i++) this.free[k].push(this.create(k));
  }

  spawn(kind: PowerKind, x: number, z: number, id?: number): Powerup {
    const p = this.free[kind].pop() ?? this.create(kind);
    p.id = id ?? this.nextId++;
    p.group.position.set(x, 0.9, z);
    p.group.visible = true;
    this.active.push(p);
    return p;
  }

  update(dz: number, time: number, despawn = true): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.group.position.z += dz;
      p.group.position.y = 0.9 + Math.sin(time * 3 + p.id) * 0.15;
      p.group.children[0].rotation.y = time * 2.5;
      if (despawn && p.group.position.z > DESPAWN_Z) this.release(p);
    }
  }

  release(p: Powerup): void {
    const i = this.active.indexOf(p);
    if (i < 0) return;
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    p.group.visible = false;
    this.free[p.kind].push(p);
  }

  reset(): void {
    while (this.active.length) this.release(this.active[this.active.length - 1]);
  }

  private create(kind: PowerKind): Powerup {
    const spec = POWER_SPECS[kind];
    const group = new THREE.Group();
    const spin = new THREE.Group();
    const glow = new THREE.MeshBasicMaterial({ color: spec.color });
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 28), glow));
    const core =
      kind === 'rapid'
        ? new THREE.ConeGeometry(0.22, 0.6, 4)
        : kind === 'damage'
          ? new THREE.OctahedronGeometry(0.32, 0)
          : new THREE.IcosahedronGeometry(0.3, 0);
    spin.add(
      new THREE.Mesh(
        core,
        new THREE.MeshLambertMaterial({ color: spec.color, emissive: new THREE.Color(spec.color).multiplyScalar(0.4) }),
      ),
    );
    group.add(spin);

    const label = new TextLabel(256, 80, { color: spec.css });
    label.set(spec.short);
    const tag = labelSprite(label, 1.9, 0.6);
    tag.position.y = 1.0;
    group.add(tag);

    group.visible = false;
    this.parent.add(group);
    return { id: 0, kind, group };
  }
}
