import { ENEMY_KINDS, ENEMY_SPECS, SHIELD } from './Enemies';
import { POWER_KINDS } from './Powerups';
import { PHASES, MAX_STREAMS, type Phase } from './Sim';
import type { World, Player } from './World';
import type { GameEvent } from './events';
import { decodeEvent, type Snap } from '../net/protocol';

const BLEND = 10; // how quickly drawn positions catch up with the host's

interface Target {
  x: number;
  z: number;
  /** World speed (scroll + walking) used to extrapolate between snapshots. */
  vz: number;
}

/**
 * The co-op guest's view of the world. The host runs the real simulation; this mirrors
 * its snapshots, moves everything smoothly in between, steers the guest's own squad
 * instantly, and fires cosmetic bullets so both squads look alive.
 */
export class Replica {
  distance = 0;
  phase: Phase = 'run';
  speed = 0;
  boss: { hp: number; max: number } | null = null;
  private lastSeq = 0;
  private snapAge = 0;
  private enemyT = new Map<number, Target>();
  private gateT = new Map<number, number>();
  private powerT = new Map<number, Target>();
  private partnerX = 0;
  private hostDistance = 0;
  /** Called once per volley, for the shot sound. */
  onVolley: ((player: number) => void) | null = null;

  constructor(
    private w: World,
    private localIdx: number,
    private emit: (e: GameEvent) => void,
  ) {}

  /** Start of a new level: wipe the mirror. Event numbering carries on across levels. */
  reset(): void {
    this.w.clear();
    this.enemyT.clear();
    this.gateT.clear();
    this.powerT.clear();
    this.distance = 0;
    this.phase = 'run';
    this.boss = null;
    for (const p of this.w.players) {
      p.wiped = false;
      p.fireTimer = 0;
    }
  }

  apply(s: Snap): void {
    const w = this.w;
    this.snapAge = 0;

    for (const raw of s.ev) {
      const seq = Number(raw[0]);
      if (!(seq > this.lastSeq)) continue;
      this.lastSeq = seq;
      const ev = decodeEvent(raw.slice(1));
      if (ev) this.emit(ev);
    }

    this.phase = PHASES[s.ph] ?? 'run';
    this.speed = s.sp;
    this.hostDistance = s.d;
    if (Math.abs(s.d - this.distance) > 8) this.distance = s.d;
    this.boss = s.b.length ? { hp: s.b[0], max: s.b[1] } : null;

    s.p.forEach((row, i) => {
      const p = w.players[i];
      if (!p) return;
      const [x, count, rapid, damage, shield, wiped, rate] = row;
      if (i !== this.localIdx) this.partnerX = x;
      p.squad.count = count;
      p.pw.rapid = rapid;
      p.pw.damage = damage;
      p.pw.shield = shield;
      p.wiped = wiped === 1;
      p.stats.rate = rate;
    });

    // Enemies: spawn new ids, update known ones, drop the ones the host no longer has.
    const seen = new Set<number>();
    for (let i = 0; i + 6 < s.e.length; i += 7) {
      const [id, k, x, z, hp, sh, walking] = s.e.slice(i, i + 7);
      const kind = ENEMY_KINDS[k] ?? 'grunt';
      seen.add(id);
      let e = w.enemies.byId(id);
      if (!e) e = w.enemies.spawn(kind, x, z, hp, sh, id);
      if (Math.ceil(e.hp) !== hp) {
        if (hp < e.hp) e.flash = 0.07;
        w.enemies.setHp(e, hp);
      }
      if (Math.ceil(e.shieldHp) !== sh) w.enemies.setShield(e, sh);
      e.walking = walking === 1;
      this.enemyT.set(id, { x, z, vz: this.speed + (e.walking ? ENEMY_SPECS[kind].speed : 0) });
    }
    for (const e of [...w.enemies.active]) {
      if (!seen.has(e.id)) {
        w.enemies.release(e);
        this.enemyT.delete(e.id);
      }
    }

    // Gates
    const pairs = new Map<number, { x0: number; x1: number; value: number }[]>();
    const pairZ = new Map<number, number>();
    for (let i = 0; i + 4 < s.g.length; i += 5) {
      const [id, x0, x1, z, value] = s.g.slice(i, i + 5);
      if (!pairs.has(id)) pairs.set(id, []);
      pairs.get(id)!.push({ x0, x1, value });
      pairZ.set(id, z);
    }
    for (const [id, defs] of pairs) {
      const pair = w.gates.byId(id);
      if (!pair) w.gates.spawnPair(defs, pairZ.get(id)!, id);
      else pair.gates.forEach((g, j) => defs[j] && g.value !== defs[j].value && w.gates.setValue(g, defs[j].value));
      this.gateT.set(id, pairZ.get(id)!);
    }
    for (const pair of [...w.gates.pairs]) {
      if (!pairs.has(pair.id)) {
        w.gates.removePair(pair);
        this.gateT.delete(pair.id);
      }
    }

    // Gems are cheap: rebuild the list.
    w.gems.clear();
    for (let i = 0; i + 1 < s.m.length; i += 2) w.gems.spawn(s.m[i], s.m[i + 1]);

    // Power-ups
    const seenU = new Set<number>();
    for (let i = 0; i + 3 < s.u.length; i += 4) {
      const [id, k, x, z] = s.u.slice(i, i + 4);
      seenU.add(id);
      if (!w.powerups.active.some((p) => p.id === id)) w.powerups.spawn(POWER_KINDS[k] ?? 'rapid', x, z, id);
      this.powerT.set(id, { x, z, vz: this.speed });
    }
    for (const pu of [...w.powerups.active]) {
      if (!seenU.has(pu.id)) {
        w.powerups.release(pu);
        this.powerT.delete(pu.id);
      }
    }
  }

  step(dt: number, time: number): void {
    const w = this.w;
    this.snapAge += dt;
    const k = Math.min(1, dt * BLEND);
    const age = Math.min(this.snapAge, 0.3); // don't extrapolate far if the host stalls
    // Scroll at the host's pace, nudged towards where the host actually is.
    const before = this.distance;
    this.distance += this.speed * dt;
    this.distance += (this.hostDistance + this.speed * age - this.distance) * k * 0.5;
    const dz = Math.max(0, this.distance - before);

    const squads = w.players.filter((p) => p.active && !p.wiped).map((p) => p.squad.x);
    w.track.update(dz);
    w.gates.update(dz, false);
    for (const pair of w.gates.pairs) {
      const t = this.gateT.get(pair.id);
      if (t !== undefined) w.gates.setZ(pair, pair.z + (t + this.speed * age - pair.z) * k);
    }
    w.enemies.update(dt, dz, time, squads, false);
    for (const e of w.enemies.active) {
      const t = this.enemyT.get(e.id);
      if (!t) continue;
      const p = e.group.position;
      p.x += (t.x - p.x) * k;
      p.z += (t.z + t.vz * age - p.z) * k;
    }
    w.powerups.update(dz, time, false);
    for (const pu of w.powerups.active) {
      const t = this.powerT.get(pu.id);
      if (!t) continue;
      const p = pu.group.position;
      p.x += (t.x - p.x) * k;
      p.z += (t.z + t.vz * age - p.z) * k;
    }
    w.gems.update(dz);
    w.fx.update(dt, dz);

    const fighting = this.phase === 'run' || this.phase === 'arena';
    for (const p of w.players) {
      if (!p.active) continue;
      if (p.idx !== this.localIdx) p.squad.setTarget(this.partnerX);
      p.squad.update(dt, time, this.phase === 'run' && !p.wiped);
      p.squad.setShield(p.pw.shield > 0 && !p.wiped);
      if (fighting && !p.wiped) this.fire(p, dt);
    }
    w.bullets.advance(dt);
    this.stopBullets();
  }

  /** Cosmetic volleys: same rhythm and spread as the host's, no damage. */
  private fire(p: Player, dt: number): void {
    const sq = p.squad;
    if (sq.count <= 0) return;
    const interval = 1 / (p.stats.rate * (p.pw.rapid > 0 ? 2 : 1));
    p.fireTimer += dt;
    while (p.fireTimer >= interval) {
      p.fireTimer -= interval;
      const vis = sq.visible;
      const streams = Math.min(vis, MAX_STREAMS);
      for (let s = 0; s < streams; s++) {
        const i = Math.floor(((s + 0.5) * vis) / streams);
        this.w.bullets.spawn(sq.memberX(i), sq.memberZ(i) - 0.4, 0, p.idx);
      }
      this.onVolley?.(p.idx);
    }
  }

  /** Bullets vanish where they would hit something on the host. */
  private stopBullets(): void {
    const { bullets: b, gates, enemies } = this.w;
    outer: for (let i = b.n - 1; i >= 0; i--) {
      const x = b.x[i];
      const z = b.z[i];
      if (gates.bulletHit(x, z)) {
        b.remove(i);
        continue;
      }
      for (const e of enemies.active) {
        const p = e.group.position;
        const r = ENEMY_SPECS[e.kind].radius;
        const shielded =
          e.shieldHp > 0 && Math.abs(x - p.x) < SHIELD.halfW && Math.abs(z - enemies.shieldZ(e)) < SHIELD.depth + 0.25;
        if (shielded || (Math.abs(x - p.x) < r && Math.abs(z - p.z) < r + 0.2)) {
          b.remove(i);
          continue outer;
        }
      }
    }
  }
}
