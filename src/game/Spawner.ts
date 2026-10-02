import { LANES } from './Player';
import type { ObstacleKind, Obstacles } from './Obstacles';
import type { Pickups } from './Pickups';

export const SPAWN_Z = -140;
/** Distance at which difficulty reaches its maximum. */
const MAX_DIFFICULTY_DISTANCE = 4000;
const FIRST_ROW_DISTANCE = 60;

type Cell = ObstacleKind | null;

/**
 * Spawns obstacles in rows across the three lanes. Every row leaves at least one lane
 * that isn't a solid block, so there is always a way through.
 */
export class Spawner {
  private untilNext = FIRST_ROW_DISTANCE;
  private row: Cell[] = [null, null, null];

  constructor(
    private obstacles: Obstacles,
    private pickups: Pickups,
  ) {}

  reset(): void {
    this.untilNext = FIRST_ROW_DISTANCE;
  }

  update(dz: number, speed: number, distance: number): void {
    this.untilNext -= dz;
    if (this.untilNext > 0) return;

    const difficulty = Math.min(1, distance / MAX_DIFFICULTY_DISTANCE);
    this.spawnRow(difficulty);

    // Keep rows far enough apart in *time* that a full jump fits between them.
    const minGap = Math.max(speed * 0.8, 18);
    this.untilNext += minGap * lerp(1.7, 1.0, difficulty) * (0.9 + Math.random() * 0.3);
  }

  private spawnRow(difficulty: number): void {
    const row = this.row;
    const fillChance = lerp(0.4, 0.8, difficulty);
    const maxFilled = difficulty < 0.15 ? 2 : 3;

    let filled = 0;
    for (let i = 0; i < 3; i++) {
      row[i] = filled < maxFilled && Math.random() < fillChance ? pickKind() : null;
      if (row[i]) filled++;
    }

    // Guarantee a way through: never three solid blocks.
    if (row[0] === 'block' && row[1] === 'block' && row[2] === 'block') {
      row[(Math.random() * 3) | 0] = Math.random() < 0.5 ? null : 'barrier';
    }

    for (let i = 0; i < 3; i++) {
      const kind = row[i];
      if (kind) this.obstacles.spawn(kind, LANES[i], SPAWN_Z);
    }

    if (Math.random() < 0.55) this.spawnOrbs(row);
  }

  private spawnOrbs(row: Cell[]): void {
    const candidates: number[] = [];
    for (let i = 0; i < 3; i++) if (row[i] === null || row[i] === 'barrier') candidates.push(i);
    if (candidates.length === 0) return;
    const lane = candidates[(Math.random() * candidates.length) | 0];
    const x = LANES[lane];

    if (row[lane] === 'barrier') {
      // Arc over the barrier along the jump path.
      for (let i = 0; i < 5; i++) {
        const t = (i - 2) / 2;
        this.pickups.spawn(x, 1.1 + (1 - t * t) * 0.8, SPAWN_Z + (i - 2) * 2.4);
      }
    } else {
      for (let i = 0; i < 5; i++) this.pickups.spawn(x, 0.9, SPAWN_Z - 3 - i * 2.5);
    }
  }
}

function pickKind(): ObstacleKind {
  const r = Math.random();
  if (r < 0.38) return 'barrier';
  if (r < 0.68) return 'bar';
  return 'block';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
