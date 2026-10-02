import { ENEMY_SPECS, SHIELD, type Enemy } from './Enemies';
import { POWER_SPECS } from './Powerups';
import { noPowers, type Player, type World } from './World';
import type { LevelPlan } from './Level';
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
  /** Called once per volley, for the shot sound. */
  onVolley: ((player: number) => void) | null = null;

  constructor(
    private w: World,
    private emit: (e: GameEvent) => void,
  ) {}

  get players(): Player[] {
    return this.w.players.filter((p) => p.active);
  }

  get speed(): number {
    return this.phase === 'run' ? this.plan.speed : 0;
  }

  start(plan: LevelPlan): void {
    this.plan = plan;
    this.distance = 0;
    this.eventIdx = 0;
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
      dz = this.plan.speed * dt;
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
    this.spawnEvents();

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

  private fire(p: Player, dt: number): void {
    if (p.squad.count <= 0) return;
    const rate = p.stats.rate * (p.pw.rapid > 0 ? 2 : 1);
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
        if (Math.abs(x - p.x) < r && Math.abs(z - p.z) < r + 0.2) {
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
        p.squad.add(g.value);
        this.emit({ k: 'gate', p: p.idx, v: g.value });
      }
      w.gates.removePair(pair);
    }

    // Enemies that reach a squad take members equal to their remaining health (and shield).
    for (let i = w.enemies.active.length - 1; i >= 0; i--) {
      const e = w.enemies.active[i];
      const pos = e.group.position;
      const er = ENEMY_SPECS[e.kind].radius;
      const hitP = alive.find(
        (p) => pos.z >= -(er + p.squad.radius * 0.6) && Math.abs(pos.x - p.squad.x) <= p.squad.radius + er,
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
