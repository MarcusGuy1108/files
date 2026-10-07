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

/**
 * Lays out a level. Pass a fresh `seed` for each attempt so the layout can't be memorised;
 * without one the layout is fixed for the level (handy for tests). The length and
 * difficulty numbers never depend on the seed.
 */
export function buildLevel(level: number, coop = false, seed = level * 9973 + 17): LevelPlan {
  const rnd = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const int = (a: number, b: number) => Math.floor(range(a, b + 1));

  const L = level - 1;
  // Two squads means twice the firepower, so enemies get tougher in co-op.
  const hpScale = (1 + 0.3 * L) * (coop ? 1.5 : 1);
  const gateScale = 1 + 0.32 * L;
  const length = Math.min(900, 420 + 45 * L);
  const events: LevelEvent[] = [];
  const spread = (TRACK_HALF - 0.8) * 2;

  /** `easy` waves (the first few) have no brutes or shield bearers. */
  const wave = (at: number, size: number, easy = false) => {
    const enemies: WaveEnemy[] = [];
    const cols = Math.min(5, size);
    const bruteChance = easy ? 0 : level === 1 ? 0.05 : Math.min(0.4, 0.04 + 0.05 * L);
    for (let i = 0; i < size; i++) {
      const brute = rnd() < bruteChance;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cols === 1 ? range(-1.5, 1.5) : -spread / 2 + (spread * col) / (cols - 1) + range(-0.4, 0.4);
      enemies.push({
        kind: brute ? 'brute' : 'grunt',
        x,
        dz: -row * 2.3 - range(0, 0.8),
        hp: Math.round((brute ? range(10, 16) : range(3, 7)) * hpScale),
        shield: 0,
      });
    }
    // From level 2 a swarm of weak grunts follows the wave: lots to mow down.
    if (!easy && level >= 2) {
      const swarm = Math.min(12, 3 + level);
      const back = -Math.ceil(size / cols) * 2.3 - 2;
      for (let i = 0; i < swarm; i++) {
        enemies.push({
          kind: 'grunt',
          x: range(-spread / 2, spread / 2),
          dz: back - Math.floor(i / 5) * 1.6 - range(0, 0.6),
          hp: Math.max(1, Math.round(range(1, 2.5) * hpScale)),
          shield: 0,
        });
      }
    }
    // From level 4 a shield bearer leads some waves, protecting the ranks behind it.
    if (!easy && level >= 4 && rnd() < Math.min(0.6, 0.2 + 0.08 * (level - 4))) {
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
    const n = Math.min(12, 4 + L);
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
    // From level 2 some losses are percentages, which hurt big squads as much as small ones.
    const pct = () => (level >= 3 && rnd() < Math.min(0.5, 0.2 + 0.04 * L) ? Math.round(range(0.5, 0.75) * 100) / 100 : 0);
    let defs: GateDef[];
    if (!first && level > 2 && roll < 0.2) {
      // A full-width negative gate: shoot it up before you reach it.
      const m = pct();
      defs = [{ x0: -TRACK_HALF, x1: TRACK_HALF, value: m ? 0 : -Math.round(range(3, 6) * gateScale), mul: m }];
    } else {
      const both = roll > 0.9;
      const a = plus();
      const b = both ? Math.max(1, Math.round(a * range(0.3, 0.7))) : minus();
      const bm = both ? 0 : pct();
      const goodLeft = rnd() < 0.5;
      const good = { value: a, mul: 0 };
      const bad = { value: bm ? 0 : b, mul: bm };
      defs = [
        { x0: -TRACK_HALF, x1: -0.08, ...(goodLeft ? good : bad) },
        { x0: 0.08, x1: TRACK_HALF, ...(goodLeft ? bad : good) },
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
  // A gentle opener far enough out that a fresh squad has time to shoot it down.
  const openerAt = events.length;
  wave(42, 3, true);
  const opener = events[openerAt];
  if (opener.type === 'wave') for (const e of opener.enemies) e.hp = Math.max(1, Math.round(e.hp * 0.6));
  gems(56, 2);
  gates(75, true);

  let pos = 105;
  let nextPower = 100;
  // Obstacles: a row of barrels, tyres, crates or a concrete barrier you shoot through or dodge.
  const obstacles = (at: number) => {
    const enemies: WaveEnemy[] = [];
    const slots = [-2.7, 0, 2.7];
    const hp = (base: number) => Math.round(base * hpScale * range(0.85, 1.15));
    if (level >= 2 && rnd() < 0.35) {
      // A barrier across two thirds of the road, with something in the last third.
      const leftWall = rnd() < 0.5;
      enemies.push({ kind: 'barrier', x: leftWall ? -1.35 : 1.35, dz: 0, hp: hp(22), shield: 0 });
      const kind = rnd() < 0.5 ? 'barrel' : 'tyres';
      enemies.push({ kind, x: leftWall ? 2.7 : -2.7, dz: 0, hp: hp(kind === 'barrel' ? 6 : 14), shield: 0 });
    } else {
      const gap = rnd() < 0.4 ? int(0, 2) : -1; // sometimes leave a lane open
      slots.forEach((x, i) => {
        if (i === gap) return;
        const r = rnd();
        const kind = r < 0.4 ? 'barrel' : r < 0.75 ? 'tyres' : 'crate';
        enemies.push({ kind, x: x + range(-0.3, 0.3), dz: range(-0.6, 0.6), hp: hp(kind === 'barrel' ? 6 : kind === 'tyres' ? 14 : 9), shield: 0 });
      });
    }
    events.push({ at, type: 'wave', enemies });
  };

  let last: 'wave' | 'gates' | 'gems' | 'obstacles' = 'gates';
  // The first couple of waves are lighter, while a fresh squad is still small.
  let waves = 0;
  while (pos < length - 45) {
    if (pos >= nextPower) {
      power(pos);
      pos += 10;
      nextPower = pos + range(110, 160);
    }
    const r = rnd();
    let pick: 'wave' | 'gates' | 'gems' | 'obstacles' =
      last !== 'gates' && r < 0.32 ? 'gates' : r < 0.85 ? 'wave' : r < 0.95 ? 'obstacles' : 'gems';
    if (pick === 'obstacles' && last === 'obstacles') pick = 'wave';
    if (pick === 'obstacles') {
      obstacles(pos);
      pos += 24;
    } else if (pick === 'wave') {
      const size = Math.min(18, (level === 1 ? 3 : 3 + level) + int(0, 3));
      if (waves < 2) wave(pos, Math.min(size, 4 + Math.floor(level / 2)), true);
      else if (level >= 3 && rnd() < 0.3) rush(pos);
      else wave(pos, size);
      waves++;
      // Explosive barrels in front of a wave: shoot them as the enemies pass.
      if (level >= 2 && rnd() < 0.25) {
        const x = range(-2.5, 2.5);
        events.push({ at: pos - 2, type: 'wave', enemies: [{ kind: 'barrel', x, dz: 0, hp: Math.round(6 * hpScale), shield: 0 }] });
      }
      if (rnd() < 0.1) gems(pos + 14, 2);
      pos += range(24, 32);
    } else if (pick === 'gates') {
      gates(pos);
      pos += 32; // leave room so enemies aren't hidden right behind the gates
    } else {
      gems(pos, int(2, 3));
      pos += 16;
    }
    last = pick;
  }

  // Mid-level events: each kind unlocks at a level; later levels get more of them.
  const SPANS: Record<LevelEventKind, number> = {
    meteors: 75,
    ambush: 0,
    gemrush: 45,
    stampede: 0,
    overdrive: 80,
    doubleup: 0,
    blackout: 70,
  };
  const UNLOCK: Record<LevelEventKind, number> = {
    gemrush: 1,
    ambush: 2,
    stampede: 2,
    meteors: 3,
    doubleup: 3,
    overdrive: 4,
    blackout: 5,
  };
  const pool = (Object.keys(UNLOCK) as LevelEventKind[]).filter((k) => level >= UNLOCK[k]);
  const slots = level === 1 ? [0.55] : level < 4 ? [0.5] : level < 8 ? [0.3, 0.65] : [0.25, 0.5, 0.75];
  for (const f of slots) {
    if (!pool.length) break;
    const kind = pool.splice(int(0, pool.length - 1), 1)[0];
    events.push({ at: Math.round(length * f), type: 'event', kind, span: SPANS[kind] });
  }
  events.sort((a, b) => a.at - b.at);

  return {
    level,
    coop,
    length,
    speed: Math.min(15, 11 + 0.3 * L),
    bossHp: Math.round(650 * (1 + 0.6 * L) * (coop ? 1.7 : 1)),
    gateCost: 1 + 0.08 * L,
    hpScale,
    bossReward: 3 + L,
    clearBonus: 4 + 2 * L,
    events,
  };
}
