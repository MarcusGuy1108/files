import { BARREL_BLAST, ENEMY_SPECS, SHIELD, hitHalfW, type Enemy } from './Enemies';
import { POWER_KINDS, POWER_SPECS } from './Powerups';
import { noPowers, type Player, type World } from './World';
import type { LevelPlan } from './Level';
import { METEOR_RADIUS } from './Hazards';
import { TRACK_HALF } from './Track';
import type { LevelEventKind } from './events';
import type { GameEvent } from './events';

/** run: scrolling. arena: stopped, boss walks in. won: boss down. lost: every squad wiped. */
export type Phase = 'run' | 'arena' | 'won' | 'lost';
export const PHASES: Phase[] = ['run', 'arena', 'won', 'lost'];

/** How far ahead level content is placed into the world. */
const SPAWN_AHEAD = 95;
const BOSS_GAP = 26;
export const MAX_STREAMS = 8;
const WIN_DELAY = 1.3;
const LOSE_DELAY = 1.1;

/**
 * The authoritative game rules: scrolling, spawning, firing, collisions, rewards.
 * Runs in solo play and on the co-op host. Reports everything through `emit`.
 */
export class Sim {
  plan!: LevelPlan;
  phase: Phase = 'run';
  phaseTime = 0;
  distance = 0;
  boss: Enemy | null = null;
  /** Set once the end-of-level pause is over. */
  result: 'won' | 'lost' | null = null;
  private eventIdx = 0;
  private gatePerBullet = [1, 1];
  /** Mid-level events waiting for the squad to reach them. */
  private scheduled: { at: number; kind: LevelEventKind; span: number }[] = [];
  private meteorUntil = 0;
  private meteorTimer = 0;
  private meteors: { x: number; z: number; t: number }[] = [];
  private bossRoaring = false;
  /** Overdrive event: faster scrolling and firing until this distance. */
  private overdriveUntil = 0;
  /** Called once per volley, for the shot sound. */
  onVolley: ((player: number) => void) | null = null;

  constructor(
    private w: World,
    private emit: (e: GameEvent) => void,
  ) {}

  get players(): Player[] {
    return this.w.players.filter((p) => p.active);
  }

  get overdrive(): boolean {
    return this.phase === 'run' && this.distance < this.overdriveUntil;
  }

  get speed(): number {
    return this.phase === 'run' ? this.plan.speed * (this.overdrive ? 1.45 : 1) : 0;
  }

  start(plan: LevelPlan): void {
    this.plan = plan;
    this.distance = 0;
    this.eventIdx = 0;
    this.scheduled = [];
    this.meteors = [];
    this.meteorUntil = 0;
    this.bossRoaring = false;
    this.overdriveUntil = 0;
    this.boss = null;
    this.result = null;
    this.setPhase('run');
    this.w.clear();
    for (const p of this.players) {
      p.squad.reset(p.stats.start);
      p.fireTimer = 0;
      p.pw = noPowers();
      p.wiped = false;
    }
    this.spawnEvents();
  }

  step(dt: number, time: number): void {
    const w = this.w;
    this.phaseTime += dt;

    let dz = 0;
    if (this.phase === 'run') {
      dz = this.speed * dt;
      if (this.distance + dz >= this.plan.length) {
        // Arrived at the arena: stop scrolling and let the boss come to us.
        dz = this.plan.length - this.distance;
        this.setPhase('arena');
        if (this.boss) this.boss.walking = true;
        this.emit({ k: 'arena' });
      }
    }
    this.distance += dz;

    const alive = this.players.filter((p) => !p.wiped);
    w.track.update(dz);
    w.gates.update(dz);
    w.gems.update(dz);
    w.powerups.update(dz, time);
    w.enemies.update(
      dt,
      dz,
      time,
      alive.map((p) => p.squad.x),
    );
    w.fx.update(dt, dz);
    w.hazards.update(dt, dz, time);
    this.spawnEvents();
    if (this.phase === 'run') this.runLevelEvents(dt, dz);
    this.bossSummons();

    const fighting = this.phase === 'run' || this.phase === 'arena';
    for (const p of this.players) {
      p.squad.update(dt, time, this.phase === 'run' && !p.wiped);
      for (const k of Object.keys(p.pw) as (keyof Player['pw'])[]) p.pw[k] = Math.max(0, p.pw[k] - dt);
      p.squad.setShield(p.pw.shield > 0 && !p.wiped);
      if (fighting && !p.wiped) this.fire(p, dt);
    }

    w.bullets.advance(dt);
    if (fighting) {
      this.resolveBullets();
      this.resolveContacts();
      this.checkWipes();
    }

    if (this.phase === 'won' && this.phaseTime > WIN_DELAY && !this.result) {
      for (const p of this.players) this.emit({ k: 'reward', p: p.idx, n: this.plan.clearBonus });
      this.result = 'won';
    } else if (this.phase === 'lost' && this.phaseTime > LOSE_DELAY && !this.result) {
      this.result = 'lost';
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  /** Place level content into the world as it comes within range. */
  private spawnEvents(): void {
    const w = this.w;
    const { events } = this.plan;
    while (this.eventIdx < events.length && events[this.eventIdx].at - this.distance < SPAWN_AHEAD) {
      const ev = events[this.eventIdx++];
      const z = -(ev.at - this.distance);
      if (ev.type === 'wave') {
        for (const e of ev.enemies) w.enemies.spawn(e.kind, e.x, z + e.dz, e.hp, e.shield);
      } else if (ev.type === 'gates') {
        w.gates.spawnPair(ev.gates, z);
      } else if (ev.type === 'gems') {
        for (const g of ev.gems) w.gems.spawn(g.x, z + g.dz);
      } else if (ev.type === 'event') {
        this.scheduled.push(ev);
      } else {
        w.powerups.spawn(ev.kind, ev.x, z);
      }
    }
    const bossAt = this.plan.length + BOSS_GAP;
    if (!this.boss && this.phase === 'run' && bossAt - this.distance < SPAWN_AHEAD) {
      this.boss = w.enemies.spawn('boss', 0, -(bossAt - this.distance), this.plan.bossHp);
      this.emit({ k: 'boss' });
    }
  }

  /** Start scheduled events when the squad reaches them, and run any in progress. */
  private runLevelEvents(dt: number, dz: number): void {
    while (this.scheduled.length && this.distance >= this.scheduled[0].at) {
      const ev = this.scheduled.shift()!;
      this.emit({ k: 'event', kind: ev.kind });
      if (ev.kind === 'meteors') {
        this.meteorUntil = this.distance + ev.span;
        this.meteorTimer = 0.6;
      } else if (ev.kind === 'ambush') {
        this.ambush();
      } else if (ev.kind === 'stampede') {
        this.stampede();
      } else if (ev.kind === 'overdrive') {
        this.overdriveUntil = this.distance + ev.span;
      } else if (ev.kind === 'doubleup') {
        // One side doubles the squad; the other takes a bite out of it.
        const left = Math.random() < 0.5;
        const bad = -(3 + this.plan.level * 2);
        this.w.gates.spawnPair(
          [
            { x0: -TRACK_HALF, x1: -0.08, value: left ? 0 : bad, mul: left ? 2 : 0 },
            { x0: 0.08, x1: TRACK_HALF, value: left ? bad : 0, mul: left ? 0 : 2 },
          ],
          -45,
        );
      } else if (ev.kind === 'blackout') {
        // Purely visual: the screens dim (see Game).
      } else {
        // Gem rush: a snaking trail of gems just ahead.
        for (let i = 0; i < 14; i++) this.w.gems.spawn(Math.sin(i * 0.6) * (TRACK_HALF - 1), -28 - i * 2.2);
      }
    }

    const alive = this.players.filter((p) => !p.wiped);
    if (this.distance < this.meteorUntil && alive.length) {
      this.meteorTimer -= dt;
      if (this.meteorTimer <= 0) {
        this.meteorTimer = Math.max(0.42, 0.75 - 0.03 * this.plan.level);
        // Aim near a squad so standing still isn't safe.
        const target = alive[Math.floor(Math.random() * alive.length)].squad;
        const lim = TRACK_HALF - 0.6;
        const x = Math.max(-lim, Math.min(lim, target.x + (Math.random() - 0.5) * 2.6));
        const t = 1.5;
        const z = -this.plan.speed * t; // scrolls to the squad's line as it lands
        this.meteors.push({ x, z, t });
        this.w.hazards.spawn(x, z, t);
        this.emit({ k: 'meteor', x, z, t });
      }
    }

    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t -= dt;
      m.z += dz;
      if (m.t > 0) continue;
      this.meteors.splice(i, 1);
      const hit = alive.find(
        (p) => Math.abs(p.squad.x - m.x) < METEOR_RADIUS + p.squad.radius * 0.4 && Math.abs(m.z) < 1.5 + p.squad.radius * 0.5,
      );
      let loss = 0;
      if (hit && hit.pw.shield <= 0) {
        loss = Math.min(hit.squad.count, 2 + this.plan.level);
        hit.squad.add(-loss);
      }
      this.emit({ k: 'boom', x: m.x, z: m.z, p: hit ? hit.idx : -1, loss });
    }
  }

  /** Enemies drop out of the sky right in front of the squads. */
  private ambush(): void {
    const L = this.plan.level;
    const n = Math.min(8, 4 + Math.floor(L / 2));
    for (let i = 0; i < n; i++) {
      const dasher = L >= 3 && Math.random() < 0.4;
      const x = -TRACK_HALF + 0.6 + Math.random() * (TRACK_HALF * 2 - 1.2);
      const z = -16 - Math.random() * 10;
      const hp = Math.round((dasher ? 2 + Math.random() * 2 : 3 + Math.random() * 4) * this.plan.hpScale);
      this.w.enemies.spawn(dasher ? 'dasher' : 'grunt', x, z, hp);
    }
  }

  /** A wide, dense charge of weak grunts. */
  private stampede(): void {
    const n = Math.min(24, 12 + this.plan.level);
    for (let i = 0; i < n; i++) {
      const x = -TRACK_HALF + 0.5 + Math.random() * (TRACK_HALF * 2 - 1);
      const z = -38 - Math.floor(i / 4) * 2.4 - Math.random();
      this.w.enemies.spawn('grunt', x, z, Math.round((1.5 + Math.random() * 2) * this.plan.hpScale));
    }
  }

  /** Each boss roar calls in minions: two at first, more on later levels. */
  private bossSummons(): void {
    const b = this.boss;
    if (!b) return;
    const roaring = this.w.enemies.roaring(b);
    if (roaring && !this.bossRoaring) {
      const p = b.group.position;
      const n = Math.min(6, 2 + Math.floor(this.plan.level / 5));
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * (5.2 / Math.max(1, n - 1));
        const x = Math.max(-TRACK_HALF + 0.6, Math.min(TRACK_HALF - 0.6, p.x + off));
        this.w.enemies.spawn('grunt', x, p.z + 2.5, Math.round(5 * this.plan.hpScale));
      }
      this.emit({ k: 'summon', x: p.x, z: p.z });
    }
    this.bossRoaring = roaring;
  }

  private fire(p: Player, dt: number): void {
    if (p.squad.count <= 0) return;
    const rate = p.stats.rate * (p.pw.rapid > 0 ? 2 : 1) * (this.overdrive ? 1.5 : 1);
    const interval = 1 / rate;
    p.fireTimer += dt;
    while (p.fireTimer >= interval) {
      p.fireTimer -= interval;
      this.volley(p);
    }
  }

  /** Every member fires; past MAX_STREAMS bullets the extra firepower goes into damage. */
  private volley(p: Player): void {
    const sq = p.squad;
    const vis = sq.visible;
    const streams = Math.min(vis, MAX_STREAMS);
    const power = p.stats.power * (p.pw.damage > 0 ? 2 : 1);
    const dmg = (power * sq.count) / streams;
    // A full volley raises a gate by `power`, whatever the squad size.
    this.gatePerBullet[p.idx] = power / streams;
    for (let k = 0; k < streams; k++) {
      const i = Math.floor(((k + 0.5) * vis) / streams);
      this.w.bullets.spawn(sq.memberX(i), sq.memberZ(i) - 0.4, dmg, p.idx);
    }
    this.onVolley?.(p.idx);
  }

  private resolveBullets(): void {
    const { bullets: b, gates, enemies } = this.w;
    outer: for (let i = b.n - 1; i >= 0; i--) {
      const x = b.x[i];
      const z = b.z[i];

      const gate = gates.bulletHit(x, z);
      if (gate) {
        gates.hit(gate, this.gatePerBullet[b.owner[i]] ?? 1, this.plan.gateCost);
        b.remove(i);
        continue;
      }

      // Shields sit in front of their bearers, so they are checked first.
      for (const e of enemies.active) {
        if (e.shieldHp <= 0) continue;
        const p = e.group.position;
        if (Math.abs(x - p.x) < SHIELD.halfW && Math.abs(z - enemies.shieldZ(e)) < SHIELD.depth + 0.25) {
          const dmg = b.dmg[i];
          b.remove(i);
          if (enemies.damageShield(e, dmg)) this.emit({ k: 'shieldbreak', x: p.x, z: enemies.shieldZ(e) });
          continue outer;
        }
      }

      for (const e of enemies.active) {
        const p = e.group.position;
        const r = ENEMY_SPECS[e.kind].radius;
        if (Math.abs(x - p.x) < hitHalfW(e.kind) && Math.abs(z - p.z) < r + 0.2) {
          const dmg = b.dmg[i];
          b.remove(i);
          if (enemies.damage(e, dmg)) this.kill(e);
          continue outer;
        }
      }
    }
  }

  private kill(e: Enemy): void {
    const w = this.w;
    const p = e.group.position;
    const spec = ENEMY_SPECS[e.kind];
    this.emit({ k: 'kill', kind: e.kind, x: p.x, z: p.z });
    w.enemies.release(e);
    if (e === this.boss) {
      this.boss = null;
      this.setPhase('won');
      this.emit({ k: 'bossdown', x: p.x, z: p.z });
      for (const pl of this.players) this.emit({ k: 'reward', p: pl.idx, n: this.plan.bossReward });
      return;
    }
    // Gems drop where the enemy fell; you still have to walk over them.
    if (Math.random() < spec.drop.chance) {
      for (let k = 0; k < spec.drop.count; k++) w.gems.spawn(p.x + (k - (spec.drop.count - 1) / 2) * 0.7, p.z);
    }
    // Crates sometimes hold a power-up.
    if (e.kind === 'crate' && Math.random() < 0.3) {
      w.powerups.spawn(POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)], p.x, p.z - 1.5);
    }
    // Barrels explode, hurting everything around them (and setting off other barrels).
    if (e.kind === 'barrel') {
      const x = p.x;
      const z = p.z;
      this.emit({ k: 'boom', x, z, p: -1, loss: 0 });
      const blast = Math.round(30 * this.plan.hpScale);
      const near = w.enemies.active.filter(
        (o) => o !== this.boss && Math.hypot(o.group.position.x - x, o.group.position.z - z) < BARREL_BLAST + ENEMY_SPECS[o.kind].radius,
      );
      for (const o of near) {
        if (!w.enemies.active.includes(o)) continue; // already taken out by a chain reaction
        if (o.shieldHp > 0) w.enemies.setShield(o, 0);
        if (w.enemies.damage(o, blast)) this.kill(o);
      }
    }
  }

  private resolveContacts(): void {
    const w = this.w;
    const alive = this.players.filter((p) => !p.wiped);

    // Gates: each squad's centre decides which gate of a pair it walks through.
    for (let i = w.gates.pairs.length - 1; i >= 0; i--) {
      const pair = w.gates.pairs[i];
      if (pair.z < -0.2) continue;
      for (const p of alive) {
        const g = w.gates.gateAt(pair, p.squad.x);
        if (!g) continue;
        const v = g.mul ? p.squad.count * (g.mul - 1) : g.value;
        p.squad.add(v);
        this.emit({ k: 'gate', p: p.idx, v });
      }
      w.gates.removePair(pair);
    }

    // Enemies that reach a squad take members equal to their remaining health (and shield).
    for (let i = w.enemies.active.length - 1; i >= 0; i--) {
      const e = w.enemies.active[i];
      const pos = e.group.position;
      const er = ENEMY_SPECS[e.kind].radius;
      const ew = hitHalfW(e.kind);
      const hitP = alive.find(
        (p) => pos.z >= -(er + p.squad.radius * 0.6) && Math.abs(pos.x - p.squad.x) <= p.squad.radius + ew,
      );
      if (!hitP) continue;
      const sq = hitP.squad;

      if (e === this.boss) {
        // Squad and boss trade members for health; if the boss survives it keeps coming.
        const loss = Math.ceil(e.hp);
        const dealt = sq.count;
        sq.add(-loss);
        this.emit({ k: 'hurt', p: hitP.idx, loss: Math.min(loss, dealt), x: pos.x, z: pos.z, kind: e.kind });
        if (w.enemies.damage(e, dealt)) this.kill(e);
        continue;
      }

      if (hitP.pw.shield > 0) {
        this.emit({ k: 'block', p: hitP.idx, x: pos.x, z: pos.z });
      } else {
        const loss = Math.ceil(e.hp + e.shieldHp);
        sq.add(-loss);
        this.emit({ k: 'hurt', p: hitP.idx, loss, x: pos.x, z: pos.z, kind: e.kind });
      }
      w.enemies.release(e);
    }

    // Gem and power-up pickups
    const gems = w.gems;
    for (const p of alive) {
      const sx = p.squad.x;
      const r = p.squad.radius;
      for (let i = gems.n - 1; i >= 0; i--) {
        if (Math.abs(gems.z[i]) < 0.9 && Math.abs(gems.x[i] - sx) < r + 0.3) {
          this.emit({ k: 'gem', p: p.idx, x: gems.x[i], z: gems.z[i] });
          gems.remove(i);
        }
      }
      for (let i = w.powerups.active.length - 1; i >= 0; i--) {
        const pu = w.powerups.active[i];
        const pp = pu.group.position;
        if (Math.abs(pp.z) < 1.2 && Math.abs(pp.x - sx) < r + 0.6) {
          p.pw[pu.kind] = POWER_SPECS[pu.kind].duration;
          this.emit({ k: 'power', p: p.idx, kind: pu.kind });
          w.powerups.release(pu);
        }
      }
    }
  }

  private checkWipes(): void {
    for (const p of this.players) {
      if (!p.wiped && p.squad.count <= 0) {
        p.wiped = true;
        p.pw = noPowers();
        p.squad.setShield(false);
        this.emit({ k: 'wipe', p: p.idx });
      }
    }
    if (this.players.every((p) => p.wiped)) this.setPhase('lost');
  }
}
