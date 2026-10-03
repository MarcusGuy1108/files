import type { EnemyKind } from './Enemies';
import type { GateDef } from './Gates';
import { POWER_KINDS, type PowerKind } from './Powerups';
import { TRACK_HALF } from './Track';
import type { LevelEventKind } from './events';

export interface WaveEnemy {
  kind: EnemyKind;
  x: number;
  dz: number;
  hp: number;
  shield: number;
}

export type LevelEvent =
  | { at: number; type: 'wave'; enemies: WaveEnemy[] }
  | { at: number; type: 'gates'; gates: GateDef[] }
  | { at: number; type: 'gems'; gems: { x: number; dz: number }[] }
  | { at: number; type: 'power'; kind: PowerKind; x: number }
  /** A mid-level event that lasts `span` distance (0 = one-off). */
  | { at: number; type: 'event'; kind: LevelEventKind; span: number };

export interface LevelPlan {
  level: number;
  coop: boolean;
  /** Distance to the boss arena. */
  length: number;
  speed: number;
  bossHp: number;
  /** Gate points (one full volley = gun power) needed to raise a gate by one. */
  gateCost: number;
  /** Enemy health multiplier for this level (events and boss summons use it). */
  hpScale: number;
  /** Gems each player gets for beating the boss, and for clearing the level. */
  bossReward: number;
  clearBonus: number;
  events: LevelEvent[];
}

/** Small seeded RNG so a level is laid out the same way every time you replay it. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLevel(level: number, coop = false): LevelPlan {
  const rnd = mulberry32(level * 9973 + 17);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const int = (a: number, b: number) => Math.floor(range(a, b + 1));

  const L = level - 1;
  // Two squads means twice the firepower, so enemies get tougher in co-op.
  const hpScale = (1 + 0.3 * L) * (coop ? 1.5 : 1);
  const gateScale = 1 + 0.35 * L;
  const length = Math.min(900, 420 + 45 * L);
  const events: LevelEvent[] = [];
  const spread = (TRACK_HALF - 0.8) * 2;

  const wave = (at: number, size: number, opener = false) => {
    const enemies: WaveEnemy[] = [];
    const cols = Math.min(4, size);
    const bruteChance = opener ? 0 : level === 1 ? 0.05 : Math.min(0.5, 0.06 + 0.06 * L);
    for (let i = 0; i < size; i++) {
      const brute = rnd() < bruteChance;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cols === 1 ? range(-1.5, 1.5) : -spread / 2 + (spread * col) / (cols - 1) + range(-0.4, 0.4);
      enemies.push({
        kind: brute ? 'brute' : 'grunt',
        x,
        dz: -row * 2.6 - range(0, 0.8),
        hp: Math.round((brute ? range(14, 22) : range(3, 7)) * hpScale),
        shield: 0,
      });
    }
    // From level 4 a shield bearer leads some waves, protecting the ranks behind it.
    if (level >= 4 && rnd() < Math.min(0.6, 0.2 + 0.08 * (level - 4))) {
      enemies.push({
        kind: 'bearer',
        x: range(-1.8, 1.8),
        dz: 2.2,
        hp: Math.round(range(10, 16) * hpScale),
        shield: Math.round(range(18, 28) * hpScale),
      });
    }
    events.push({ at, type: 'wave', enemies });
  };

  // From level 3: a fast pack of dashers that homes in on your squad.
  const rush = (at: number) => {
    const n = Math.min(7, 3 + Math.floor(L / 2));
    const enemies: WaveEnemy[] = [];
    for (let i = 0; i < n; i++) {
      enemies.push({
        kind: 'dasher',
        x: range(-TRACK_HALF + 0.6, TRACK_HALF - 0.6),
        dz: -i * 3.5,
        hp: Math.round(range(2, 4) * hpScale),
        shield: 0,
      });
    }
    events.push({ at, type: 'wave', enemies });
  };

  const gates = (at: number, first = false) => {
    const roll = rnd();
    const plus = () => Math.max(1, Math.round(range(3, 9) * gateScale));
    const minus = () => -Math.max(1, Math.round(range(2, 8) * gateScale));
    let defs: GateDef[];
    if (!first && level > 2 && roll < 0.2) {
      // A full-width negative gate: shoot it up before you reach it.
      defs = [{ x0: -TRACK_HALF, x1: TRACK_HALF, value: -Math.round(range(3, 6) * gateScale) }];
    } else {
      const both = roll > 0.85;
      const a = plus();
      const b = both ? Math.max(1, Math.round(a * range(0.3, 0.7))) : minus();
      const goodLeft = rnd() < 0.5;
      defs = [
        { x0: -TRACK_HALF, x1: -0.08, value: goodLeft ? a : b },
        { x0: 0.08, x1: TRACK_HALF, value: goodLeft ? b : a },
      ];
    }
    events.push({ at, type: 'gates', gates: defs });
  };

  const gems = (at: number, n: number) => {
    const x0 = range(-TRACK_HALF + 0.8, TRACK_HALF - 0.8);
    const drift = range(-0.3, 0.3);
    const list = [];
    for (let i = 0; i < n; i++) {
      const x = Math.max(-TRACK_HALF + 0.5, Math.min(TRACK_HALF - 0.5, x0 + drift * i));
      list.push({ x, dz: -i * 1.6 });
    }
    events.push({ at, type: 'gems', gems: list });
  };

  const power = (at: number) => {
    const kind = POWER_KINDS[int(0, POWER_KINDS.length - 1)];
    events.push({ at, type: 'power', kind, x: range(-TRACK_HALF + 1, TRACK_HALF - 1) });
  };

  // Something to shoot straight away, then a gate to show how they work.
  wave(22, 3, true);
  gems(36, 3);
  gates(55, true);

  let pos = 85;
  let nextPower = 100;
  let last: 'wave' | 'gates' | 'gems' = 'gates';
  while (pos < length - 45) {
    if (pos >= nextPower) {
      power(pos);
      pos += 10;
      nextPower = pos + range(110, 160);
    }
    const r = rnd();
    const pick: 'wave' | 'gates' | 'gems' = last !== 'gates' && r < 0.38 ? 'gates' : r < 0.88 ? 'wave' : 'gems';
    if (pick === 'wave') {
      if (level >= 3 && rnd() < 0.3) rush(pos);
      else wave(pos, Math.min(10, 3 + Math.floor(level / 2) + int(0, 2)));
      if (rnd() < 0.25) gems(pos + 14, 3);
      pos += range(30, 38);
    } else if (pick === 'gates') {
      gates(pos);
      pos += 32; // leave room so enemies aren't hidden right behind the gates
    } else {
      gems(pos, int(3, 5));
      pos += 16;
    }
    last = pick;
  }

  // Mid-level events: a gentle gem rush on level 1, then one or two surprises per level.
  const SPANS: Record<LevelEventKind, number> = { meteors: 75, ambush: 0, gemrush: 45 };
  const pool: LevelEventKind[] = level === 1 ? ['gemrush'] : level === 2 ? ['ambush', 'gemrush'] : ['meteors', 'ambush', 'gemrush'];
  const slots = level === 1 ? [0.55] : level < 4 ? [0.5] : [0.3, 0.65];
  for (const f of slots) {
    const kind = pool.splice(int(0, pool.length - 1), 1)[0];
    events.push({ at: Math.round(length * f), type: 'event', kind, span: SPANS[kind] });
  }
  events.sort((a, b) => a.at - b.at);

  return {
    level,
    coop,
    length,
    speed: Math.min(15, 11 + 0.3 * L),
    bossHp: Math.round(600 * (1 + 0.6 * L) * (coop ? 1.7 : 1)),
    gateCost: 1 + 0.08 * L,
    hpScale,
    bossReward: 6 + 2 * L,
    clearBonus: 8 + 3 * L,
    events,
  };
}
