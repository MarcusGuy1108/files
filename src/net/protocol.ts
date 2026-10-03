import { ENEMY_KINDS } from '../game/Enemies';
import { POWER_KINDS } from '../game/Powerups';
import { PHASES, type Sim } from '../game/Sim';
import type { World } from '../game/World';
import { LEVEL_EVENT_KINDS, type GameEvent } from '../game/events';

/**
 * What the host and guest send each other, ~20 times a second. Snapshots are flat
 * number arrays with values rounded to centimetres, which keeps a busy scene well under
 * the 4 KiB a claude.ai room allows per update.
 */

export interface HostMsg {
  r: 'h';
  /** Where the host is: setting up, in a level, or on the results screen. */
  s: 'lobby' | 'play' | 'result';
  lv: number;
  /** Increments every time the host starts a level, so the guest knows to reset. */
  run: number;
  won?: 0 | 1;
  snap?: Snap;
}

export interface GuestMsg {
  r: 'g';
  /** Where the guest wants its squad. */
  x: number;
  /** The guest's own upgrades: [start count, power, rate]. */
  st: [number, number, number];
}

export interface Snap {
  /** Distance travelled, phase index, scroll speed. */
  d: number;
  ph: number;
  sp: number;
  /** Per player: [x, count, rapid, damage, shield, wiped, rate]. */
  p: number[][];
  /** Enemies, 7 numbers each: id, kind, x, z, hp, shield hp, walking. */
  e: number[];
  /** Gates, 6 numbers each: pair id, x0, x1, z, value, multiplier (0 = none). */
  g: number[];
  /** Gem pickups: x, z. */
  m: number[];
  /** Power-ups, 4 numbers each: id, kind, x, z. */
  u: number[];
  /** Boss [hp, max], or empty. */
  b: number[];
  /** Recent events, [seq, ...encoded]; re-sent for a while so none are missed. */
  ev: (number | string)[][];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const MAX_BYTES = 3600;

export function encodeSnap(sim: Sim, w: World, recent: (number | string)[][]): Snap {
  const snap: Snap = {
    d: r2(sim.distance),
    ph: PHASES.indexOf(sim.phase),
    sp: sim.speed,
    p: w.players.map((p) => [
      r2(p.squad.x),
      p.squad.count,
      r2(p.pw.rapid),
      r2(p.pw.damage),
      r2(p.pw.shield),
      p.wiped ? 1 : 0,
      r2(p.stats.rate),
    ]),
    e: [],
    g: [],
    m: [],
    u: [],
    b: sim.boss ? [Math.ceil(sim.boss.hp), sim.boss.maxHp] : [],
    ev: recent,
  };
  // Nearest first, so trimming (below) drops the far-away ones.
  const enemies = [...w.enemies.active].sort((a, b) => b.group.position.z - a.group.position.z);
  for (const e of enemies) {
    const p = e.group.position;
    snap.e.push(e.id, ENEMY_KINDS.indexOf(e.kind), r2(p.x), r2(p.z), Math.ceil(e.hp), Math.ceil(e.shieldHp), e.walking ? 1 : 0);
  }
  for (const pair of w.gates.pairs) {
    for (const g of pair.gates) snap.g.push(pair.id, r2(g.x0), r2(g.x1), r2(pair.z), g.value, g.mul);
  }
  for (let i = 0; i < w.gems.n; i++) snap.m.push(r2(w.gems.x[i]), r2(w.gems.z[i]));
  for (const pu of w.powerups.active) {
    const p = pu.group.position;
    snap.u.push(pu.id, POWER_KINDS.indexOf(pu.kind), r2(p.x), r2(p.z));
  }

  // Stay inside the room's size limit on a very busy screen.
  while (JSON.stringify(snap).length > MAX_BYTES) {
    if (snap.m.length > 20) snap.m.length -= 10;
    else if (snap.e.length > 70) snap.e.length -= 7;
    else if (snap.ev.length > 6) snap.ev.shift();
    else break;
  }
  return snap;
}

// ---------- Events ----------

export function encodeEvent(e: GameEvent): (number | string)[] {
  switch (e.k) {
    case 'kill':
      return ['k', ENEMY_KINDS.indexOf(e.kind), r2(e.x), r2(e.z)];
    case 'gate':
      return ['g', e.p, e.v];
    case 'hurt':
      return ['h', e.p, e.loss, r2(e.x), r2(e.z), ENEMY_KINDS.indexOf(e.kind)];
    case 'block':
      return ['b', e.p, r2(e.x), r2(e.z)];
    case 'gem':
      return ['m', e.p, r2(e.x), r2(e.z)];
    case 'power':
      return ['u', e.p, POWER_KINDS.indexOf(e.kind)];
    case 'shieldbreak':
      return ['s', r2(e.x), r2(e.z)];
    case 'boss':
      return ['B'];
    case 'arena':
      return ['A'];
    case 'bossdown':
      return ['D', r2(e.x), r2(e.z)];
    case 'wipe':
      return ['w', e.p];
    case 'reward':
      return ['r', e.p, e.n];
    case 'event':
      return ['E', LEVEL_EVENT_KINDS.indexOf(e.kind)];
    case 'meteor':
      return ['M', r2(e.x), r2(e.z), r2(e.t)];
    case 'boom':
      return ['X', r2(e.x), r2(e.z), e.p, e.loss];
    case 'summon':
      return ['S', r2(e.x), r2(e.z)];
  }
}

export function decodeEvent(a: (number | string)[]): GameEvent | null {
  const n = (i: number) => Number(a[i]) || 0;
  switch (a[0]) {
    case 'k':
      return { k: 'kill', kind: ENEMY_KINDS[n(1)] ?? 'grunt', x: n(2), z: n(3) };
    case 'g':
      return { k: 'gate', p: n(1), v: n(2) };
    case 'h':
      return { k: 'hurt', p: n(1), loss: n(2), x: n(3), z: n(4), kind: ENEMY_KINDS[n(5)] ?? 'grunt' };
    case 'b':
      return { k: 'block', p: n(1), x: n(2), z: n(3) };
    case 'm':
      return { k: 'gem', p: n(1), x: n(2), z: n(3) };
    case 'u':
      return { k: 'power', p: n(1), kind: POWER_KINDS[n(2)] ?? 'rapid' };
    case 's':
      return { k: 'shieldbreak', x: n(1), z: n(2) };
    case 'B':
      return { k: 'boss' };
    case 'A':
      return { k: 'arena' };
    case 'D':
      return { k: 'bossdown', x: n(1), z: n(2) };
    case 'w':
      return { k: 'wipe', p: n(1) };
    case 'r':
      return { k: 'reward', p: n(1), n: n(2) };
    case 'E':
      return { k: 'event', kind: LEVEL_EVENT_KINDS[n(1)] ?? 'ambush' };
    case 'M':
      return { k: 'meteor', x: n(1), z: n(2), t: n(3) };
    case 'X':
      return { k: 'boom', x: n(1), z: n(2), p: n(3), loss: n(4) };
    case 'S':
      return { k: 'summon', x: n(1), z: n(2) };
  }
  return null;
}
