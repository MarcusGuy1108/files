import * as THREE from 'three';
import { Track } from './Track';
import { Squad, LOOK_PARTNER, LOOK_SELF } from './Squad';
import { Bullets } from './Bullets';
import { Enemies } from './Enemies';
import { Gates } from './Gates';
import { Gems } from './Gems';
import { Powerups, type PowerKind } from './Powerups';
import { Effects } from './Effects';
import { Hazards } from './Hazards';
import type { PlayerStats } from './Progress';

/** One squad and the numbers that drive it. Index 0 is the host (or solo), 1 the guest. */
export interface Player {
  idx: number;
  squad: Squad;
  stats: PlayerStats;
  /** Taking part in this run (always true for player 0; true for 1 only in co-op). */
  active: boolean;
  fireTimer: number;
  /** Seconds left on each power-up. */
  pw: Record<PowerKind, number>;
  wiped: boolean;
}

export function noPowers(): Record<PowerKind, number> {
  return { rapid: 0, damage: 0, shield: 0 };
}

/** Everything that lives on the track. Owned by the game; driven by Sim or Replica. */
export class World {
  readonly root = new THREE.Group();
  readonly track: Track;
  readonly gates: Gates;
  readonly enemies: Enemies;
  readonly gems: Gems;
  readonly powerups: Powerups;
  readonly bullets: Bullets;
  readonly fx: Effects;
  readonly hazards: Hazards;
  readonly players: Player[];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.track = new Track(this.root);
    this.gates = new Gates(this.root);
    this.enemies = new Enemies(this.root);
    this.gems = new Gems(this.root);
    this.powerups = new Powerups(this.root);
    const squads = [new Squad(this.root, LOOK_SELF), new Squad(this.root, LOOK_PARTNER)];
    this.bullets = new Bullets(this.root);
    this.fx = new Effects(this.root);
    this.hazards = new Hazards(this.root);
    const stats = { start: 5, power: 1, rate: 3 };
    this.players = squads.map((squad, idx) => ({
      idx,
      squad,
      stats: { ...stats },
      active: idx === 0,
      fireTimer: 0,
      pw: noPowers(),
      wiped: false,
    }));
    squads[1].setVisible(false);
  }

  /** Colour each squad from this screen's point of view: yours cyan, your partner's violet. */
  setLocalPlayer(idx: number): void {
    this.players.forEach((p) => p.squad.setLook(p.idx === idx ? LOOK_SELF : LOOK_PARTNER));
  }

  setCoop(on: boolean): void {
    this.players[1].active = on;
    this.players[1].squad.setVisible(on);
  }

  clear(): void {
    this.enemies.reset();
    this.gates.reset();
    this.gems.clear();
    this.powerups.reset();
    this.bullets.clear();
    this.fx.clear();
    this.hazards.clear();
  }

  sync(time: number): void {
    this.bullets.sync();
    this.gems.sync(time);
    this.fx.sync();
  }
}
