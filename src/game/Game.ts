import * as THREE from 'three';
import { GameScene } from '../render/Scene';
import { Input, type Action } from '../input/Input';
import { UI } from '../ui/UI';
import { loadSave, persist, upgradeCost, upgradeValue, UPGRADES, type UpgradeId } from './Progress';
import { Track, TRACK_HALF } from './Track';
import { Squad } from './Squad';
import { Bullets } from './Bullets';
import { Enemies, ENEMY_SPECS, type Enemy } from './Enemies';
import { Gates, GATE_BAD, GATE_GOOD } from './Gates';
import { Gems, GEM_COLOR } from './Gems';
import { Effects } from './Effects';
import { buildLevel, type LevelPlan } from './Level';

type State = 'menu' | 'shop' | 'playing' | 'paused' | 'dying' | 'result';
/** run: scrolling through the level. arena: stopped, boss walks in. won: boss down. */
type Phase = 'run' | 'arena' | 'won';

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const MENU_SPEED = 8;
/** How far ahead level content is placed into the world. */
const SPAWN_AHEAD = 95;
const BOSS_GAP = 26;
const MAX_STREAMS = 8;
const KEY_STEER_SPEED = 11;
const DYING_TIME = 1.1;
const WIN_DELAY = 1.3;
const RESULT_INPUT_LOCK = 0.5;

export class Game {
  private gs: GameScene;
  private world = new THREE.Group();
  private track: Track;
  private squad: Squad;
  private bullets: Bullets;
  private enemies: Enemies;
  private gates: Gates;
  private gems: Gems;
  private fx: Effects;
  private ui: UI;
  private input: Input;

  private save = loadSave();
  private plan: LevelPlan = buildLevel(1);
  private state: State = 'menu';
  private phase: Phase = 'run';
  private stateTime = 0;
  private phaseTime = 0;
  private time = 0;
  private distance = 0;
  private eventIdx = 0;
  private runGems = 0;
  private fireTimer = 0;
  private boss: Enemy | null = null;
  private shake = 0;
  /** How much one bullet raises a gate: a full volley adds `power`, whatever the squad size. */
  private gatePerBullet = 1;

  private acc = 0;
  private lastFrame = 0;
  private frameEma = 16;
  private perfTimer = 0;
  private tmpV = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.gs = new GameScene(canvas);
    this.gs.scene.add(this.world);

    this.track = new Track(this.world);
    this.gates = new Gates(this.world);
    this.enemies = new Enemies(this.world);
    this.gems = new Gems(this.world);
    this.squad = new Squad(this.world);
    this.bullets = new Bullets(this.world);
    this.fx = new Effects(this.world);

    this.ui = new UI({
      play: () => this.startRun(),
      next: () => this.startRun(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      menu: () => this.toMenu(),
      shop: () => this.openShop(),
      buy: (id) => this.buy(id),
    });
    this.input = new Input((a) => this.onAction(a));

    window.addEventListener('resize', () => this.gs.resize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.pause();
      persist(this.save);
    });

    this.toMenu();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------- State transitions ----------

  private clearWorld(): void {
    this.enemies.reset();
    this.gates.reset();
    this.gems.clear();
    this.bullets.clear();
    this.fx.clear();
    this.ui.clearPops();
    this.boss = null;
  }

  private toMenu(): void {
    persist(this.save);
    this.clearWorld();
    this.squad.reset(upgradeValue(this.save, 'squad'));
    this.ui.setMenu(this.save);
    this.setState('menu');
    this.ui.show('menu');
  }

  private openShop(): void {
    if (this.state !== 'shop') {
      this.clearWorld();
      this.squad.reset(upgradeValue(this.save, 'squad'));
    }
    this.ui.renderShop(this.save);
    this.setState('shop');
    this.ui.show('shop');
  }

  private buy(id: UpgradeId): void {
    const lv = this.save.upgrades[id];
    const cost = upgradeCost(id, lv);
    if (lv >= UPGRADES[id].max || this.save.gems < cost) return;
    this.save.gems -= cost;
    this.save.upgrades[id] = lv + 1;
    persist(this.save);
    // Show the bigger squad straight away.
    if (id === 'squad') this.squad.count = upgradeValue(this.save, 'squad');
    this.ui.renderShop(this.save);
  }

  private startRun(): void {
    this.clearWorld();
    this.plan = buildLevel(this.save.level);
    this.squad.reset(upgradeValue(this.save, 'squad'));
    this.distance = 0;
    this.eventIdx = 0;
    this.runGems = 0;
    this.fireTimer = 0;
    this.shake = 0;
    this.setPhase('run');
    this.ui.startRun(this.plan.level);
    this.ui.setGems(this.save.gems);
    this.spawnEvents();
    this.setState('playing');
    this.ui.show('playing');
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.ui.show('paused');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.ui.show('playing');
  }

  private finish(won: boolean): void {
    if (won) {
      const bonus = 15 + 5 * this.plan.level;
      this.addGems(bonus);
      this.save.level = this.plan.level + 1;
    }
    persist(this.save);
    this.ui.setMenu(this.save);
    this.ui.setBoss(null);
    this.setState('result');
    this.ui.showResult(won, this.plan.level, this.distance / this.plan.length, this.runGems);
  }

  private setState(s: State): void {
    this.state = s;
    this.stateTime = 0;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  private onAction(a: Action): void {
    switch (this.state) {
      case 'menu':
        if (a === 'confirm') this.startRun();
        break;
      case 'shop':
        if (a === 'pause') this.toMenu();
        break;
      case 'playing':
        if (a === 'pause') this.pause();
        break;
      case 'paused':
        this.resume();
        break;
      case 'result':
        if (a === 'confirm' && this.stateTime > RESULT_INPUT_LOCK) this.startRun();
        break;
    }
  }

  // ---------- Loop ----------

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(MAX_FRAME, (now - this.lastFrame) / 1000) : STEP;
    this.lastFrame = now;
    this.trackPerformance(dt);

    const drag = this.input.consumeDrag();
    if (this.state === 'playing') {
      // Dragging ~80% of a phone-width screen sweeps the whole track.
      const worldPerPx = (TRACK_HALF * 2) / Math.min(window.innerWidth * 0.8, 560);
      this.squad.steer(drag * worldPerPx);
    }

    // Fixed-step simulation keeps gameplay identical at 30, 60 or 120 Hz.
    this.acc += dt;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }

    this.bullets.sync();
    this.gems.sync(this.time);
    this.fx.sync();
    this.updateCamera(dt);
    this.gs.render();
  };

  private step(dt: number): void {
    this.stateTime += dt;
    switch (this.state) {
      case 'menu':
      case 'shop':
        this.time += dt;
        this.track.update(MENU_SPEED * dt);
        this.squad.update(dt, this.time, true);
        break;
      case 'playing':
        this.time += dt;
        this.stepPlaying(dt);
        break;
      case 'dying':
      case 'result':
        this.time += dt;
        this.fx.update(dt, 0);
        this.squad.update(dt, this.time, false);
        if (this.state === 'dying' && this.stateTime > DYING_TIME) this.finish(false);
        break;
    }
  }

  private stepPlaying(dt: number): void {
    const plan = this.plan;
    this.phaseTime += dt;

    let dz = 0;
    if (this.phase === 'run') {
      dz = plan.speed * dt;
      if (this.distance + dz >= plan.length) {
        // Arrived at the arena: stop scrolling and let the boss come to us.
        dz = plan.length - this.distance;
        this.setPhase('arena');
        if (this.boss) this.boss.walking = true;
      }
    }
    this.distance += dz;

    this.squad.steer(this.input.keyAxis * KEY_STEER_SPEED * dt);
    this.track.update(dz);
    this.gates.update(dz);
    this.gems.update(dz);
    this.enemies.update(dt, dz, this.time);
    this.fx.update(dt, dz);
    this.spawnEvents();
    this.squad.update(dt, this.time, this.phase === 'run');

    if (this.phase !== 'won') this.fire(dt);
    this.bullets.advance(dt);
    this.resolveBullets();
    this.resolveContacts();

    this.ui.setProgress(this.distance / plan.length);
    if (this.boss) this.ui.setBoss(this.boss.hp / this.boss.maxHp);

    if (this.phase === 'won' && this.phaseTime > WIN_DELAY) {
      this.finish(true);
    } else if (this.squad.count <= 0) {
      this.die();
    }
  }

  /** Place level content into the world as it comes within range. */
  private spawnEvents(): void {
    const { events } = this.plan;
    while (this.eventIdx < events.length && events[this.eventIdx].at - this.distance < SPAWN_AHEAD) {
      const ev = events[this.eventIdx++];
      const z = -(ev.at - this.distance);
      if (ev.type === 'wave') {
        for (const e of ev.enemies) this.enemies.spawn(e.kind, e.x, z + e.dz, e.hp);
      } else if (ev.type === 'gates') {
        this.gates.spawnPair(ev.gates, z);
      } else {
        for (const g of ev.gems) this.gems.spawn(g.x, z + g.dz);
      }
    }
    const bossAt = this.plan.length + BOSS_GAP;
    if (!this.boss && this.phase === 'run' && bossAt - this.distance < SPAWN_AHEAD) {
      this.boss = this.enemies.spawn('boss', 0, -(bossAt - this.distance), this.plan.bossHp);
      this.ui.setBoss(1);
    }
  }

  private fire(dt: number): void {
    if (this.squad.count <= 0) return;
    const interval = 1 / upgradeValue(this.save, 'rate');
    this.fireTimer += dt;
    while (this.fireTimer >= interval) {
      this.fireTimer -= interval;
      this.volley();
    }
  }

  /** Every member fires; past MAX_STREAMS bullets the extra firepower goes into damage. */
  private volley(): void {
    const vis = this.squad.visible;
    const streams = Math.min(vis, MAX_STREAMS);
    const power = upgradeValue(this.save, 'power');
    const dmg = (power * this.squad.count) / streams;
    this.gatePerBullet = power / streams;
    for (let k = 0; k < streams; k++) {
      const i = Math.floor(((k + 0.5) * vis) / streams);
      this.bullets.spawn(this.squad.memberX(i), this.squad.memberZ(i) - 0.4, dmg);
    }
  }

  private resolveBullets(): void {
    const b = this.bullets;
    for (let i = b.n - 1; i >= 0; i--) {
      const x = b.x[i];
      const z = b.z[i];

      const gate = this.gates.bulletHit(x, z);
      if (gate) {
        if (this.gates.hit(gate, this.gatePerBullet, this.plan.gateCost) > 0) {
          this.fx.burst(x, 1.2, z + 0.2, gate.value > 0 ? GATE_GOOD : GATE_BAD, 3, 3, 0.12);
        }
        b.remove(i);
        continue;
      }

      for (const e of this.enemies.active) {
        const p = e.group.position;
        const r = ENEMY_SPECS[e.kind].radius;
        if (Math.abs(x - p.x) < r && Math.abs(z - p.z) < r + 0.2) {
          const dmg = b.dmg[i];
          b.remove(i);
          if (this.enemies.damage(e, dmg)) this.kill(e);
          break;
        }
      }
    }
  }

  private kill(e: Enemy): void {
    const p = e.group.position;
    const spec = ENEMY_SPECS[e.kind];
    this.fx.burst(p.x, spec.height * 0.5, p.z, spec.color, e.kind === 'boss' ? 60 : 14, e.kind === 'boss' ? 12 : 6);
    this.enemies.release(e);
    if (e === this.boss) {
      this.boss = null;
      this.ui.setBoss(0);
      this.setPhase('won');
      const reward = 10 + 5 * this.plan.level;
      this.addGems(reward);
      this.popAt(`+${reward}`, p.x, spec.height, p.z, 'gem');
      return;
    }
    this.addGems(spec.gems);
    this.fx.burst(p.x, 0.8, p.z, GEM_COLOR, 4, 4, 0.12);
    this.popAt(`+${spec.gems}`, p.x, spec.height, p.z, 'gem');
  }

  private resolveContacts(): void {
    const sx = this.squad.x;
    const r = this.squad.radius;

    // Gates: the one the squad's centre walks through applies its number.
    for (let i = this.gates.pairs.length - 1; i >= 0; i--) {
      const pair = this.gates.pairs[i];
      if (pair.z < -0.2) continue;
      const g = this.gates.gateAt(pair, sx);
      if (g) {
        this.squad.add(g.value);
        this.popAt(g.value > 0 ? `+${g.value}` : `−${-g.value}`, sx, 1.8, 0, g.value > 0 ? 'good' : 'bad');
        this.fx.burst(sx, 1, 0, g.value > 0 ? GATE_GOOD : GATE_BAD, 16, 6);
        if (g.value < 0) this.shake = 0.25;
      }
      this.gates.removePair(pair);
    }

    // Enemies that reach the squad take members equal to their remaining health.
    for (let i = this.enemies.active.length - 1; i >= 0; i--) {
      const e = this.enemies.active[i];
      const p = e.group.position;
      const er = ENEMY_SPECS[e.kind].radius;
      if (p.z < -(er + r * 0.6)) continue;
      if (Math.abs(p.x - sx) > r + er) continue;
      const loss = Math.ceil(e.hp);
      this.squad.add(-loss);
      this.popAt(`−${loss}`, sx, 1.8, 0, 'bad');
      this.shake = 0.35;
      if (e === this.boss && this.squad.count > 0) {
        // Enough members left to overwhelm the boss.
        this.kill(e);
      } else {
        this.fx.burst(p.x, 0.8, p.z, ENEMY_SPECS[e.kind].color, 12, 6);
        if (e === this.boss) this.boss = null;
        this.enemies.release(e);
      }
    }

    // Gem pickups
    const gems = this.gems;
    for (let i = gems.n - 1; i >= 0; i--) {
      if (Math.abs(gems.z[i]) < 0.9 && Math.abs(gems.x[i] - sx) < r + 0.3) {
        this.fx.burst(gems.x[i], 0.6, gems.z[i], GEM_COLOR, 5, 4, 0.1);
        gems.remove(i);
        this.addGems(1);
      }
    }
  }

  private die(): void {
    this.fx.burst(this.squad.x, 0.6, 0, 0x29f0ff, 30, 8);
    this.shake = 0.5;
    this.setState('dying');
  }

  private addGems(n: number): void {
    this.save.gems += n;
    this.runGems += n;
    this.ui.setGems(this.save.gems);
  }

  private popAt(text: string, x: number, y: number, z: number, kind: 'good' | 'bad' | 'gem'): void {
    const v = this.tmpV.set(x, y, z).project(this.gs.camera);
    if (v.z > 1) return;
    this.ui.pop(text, ((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, kind);
  }

  private updateCamera(dt: number): void {
    const cam = this.gs.camera;
    const sx = this.squad.x;
    cam.position.set(sx * 0.35, 6.8, 8.6);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const k = this.shake * 0.6;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
    }
    cam.lookAt(sx * 0.25, 0, -14);
  }

  /** Drop bloom, then resolution, if frames are consistently slow while playing. */
  private trackPerformance(dt: number): void {
    if (this.state !== 'playing') return;
    this.frameEma += (dt * 1000 - this.frameEma) * 0.05;
    this.perfTimer += dt;
    if (this.perfTimer > 2.5) {
      if (this.frameEma > 22) this.gs.degrade();
      this.perfTimer = 0;
    }
  }
}
