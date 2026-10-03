import * as THREE from 'three';
import { GameScene } from '../render/Scene';
import { Input, type Action } from '../input/Input';
import { UI } from '../ui/UI';
import { AudioEngine } from '../audio/Audio';
import { loadSave, persist, statsOf, upgradeCost, UPGRADES, type PlayerStats, type UpgradeId } from './Progress';
import { TRACK_HALF } from './Track';
import { World } from './World';
import { Sim } from './Sim';
import { Replica } from './Replica';
import { ENEMY_SPECS, SHIELD_COLOR } from './Enemies';
import { GATE_BAD, GATE_GOOD } from './Gates';
import { GEM_COLOR } from './Gems';
import { POWER_SPECS } from './Powerups';
import { buildLevel } from './Level';
import type { GameEvent, LevelEventKind } from './events';

/** How each mid-level event is announced and lit. */
const LEVEL_EVENT_INFO: Record<LevelEventKind, { title: string; sub: string; css: string; color: number; seconds: number }> = {
  meteors: { title: 'METEOR SHOWER', sub: 'Keep out of the red circles', css: '#ff3a2a', color: 0xff2a10, seconds: 7 },
  ambush: { title: 'AMBUSH!', sub: 'Enemies dropping in', css: '#ff7a1a', color: 0xff6a10, seconds: 3.5 },
  gemrush: { title: 'GEM RUSH', sub: 'Grab them all', css: '#3dffa8', color: 0x22ff88, seconds: 4.5 },
};
import { STANDALONE_URL, detectVia, makeCode, normalizeCode, openChannel, NetError, type Channel } from '../net/Channel';
import { encodeEvent, encodeSnap, type GuestMsg, type HostMsg } from '../net/protocol';

type State = 'menu' | 'shop' | 'coop' | 'playing' | 'paused' | 'result';
/** solo: just you. host: you run the game for both. guest: you mirror the host's game. */
type Mode = 'solo' | 'host' | 'guest';

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const MENU_SPEED = 8;
const KEY_STEER_SPEED = 11;
const RESULT_INPUT_LOCK = 0.5;
const NET_INTERVAL = 0.05;
/** How long the host keeps re-sending an event, so a dropped update can't lose it. */
const EVENT_RESEND_MS = 1500;

export class Game {
  private gs: GameScene;
  private w: World;
  private sim: Sim;
  private replica: Replica;
  private ui: UI;
  private input: Input;
  private audio = new AudioEngine();

  private save = loadSave();
  private state: State = 'menu';
  private mode: Mode = 'solo';
  /** Which player this screen controls: 0 in solo or as host, 1 as guest. */
  private myIdx = 0;
  private stateTime = 0;
  private time = 0;
  private level = 1;
  private levelLength = 1;
  private runGems = 0;
  private shake = 0;

  // Co-op
  private channel: Channel | null = null;
  private partner = false;
  private run = 0;
  private netTimer = 0;
  private eventSeq = 0;
  private recent: { at: number; a: (number | string)[] }[] = [];
  private guestMsg: GuestMsg | null = null;
  private shopReturn: 'menu' | 'result' = 'menu';

  private acc = 0;
  private lastFrame = 0;
  private frameEma = 16;
  private perfTimer = 0;
  private tmpV = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.gs = new GameScene(canvas);
    this.w = new World(this.gs.scene);
    this.sim = new Sim(this.w, (e) => this.onSimEvent(e));
    this.replica = new Replica(this.w, 1, (e) => this.onEvent(e));
    this.sim.onVolley = this.replica.onVolley = (p) => {
      if (p !== this.myIdx) return;
      this.audio.play('shoot');
      this.gs.fireFlash(this.me.squad.x);
    };

    this.ui = new UI({
      play: () => this.startRun(),
      next: () => this.next(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      menu: () => (this.state === 'shop' ? this.closeShop() : this.toMenu()),
      shop: () => this.openShop(),
      buy: (id) => this.buy(id),
      coop: () => this.openCoop(),
      host: () => void this.hostCoop(),
      join: (code) => void this.joinCoop(code),
      startCoop: () => this.startRun(),
      toggleMusic: () => this.toggle('music'),
      toggleSfx: () => this.toggle('sfx'),
    });
    this.input = new Input((a) => this.onAction(a));

    this.audio.setMusicEnabled(this.save.music);
    this.audio.setSfxEnabled(this.save.sfx);
    // Browsers only start audio after a user gesture.
    // On phones only touchend / pointerup / click count as a gesture that may start audio;
    // pointerdown from a touch does not. Retry on every one: iOS re-suspends audio after
    // calls and app switches.
    const unlock = () => this.audio.unlock();
    for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) {
      window.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    document.getElementById('ui')!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.audio.play('click');
    });

    window.addEventListener('resize', () => this.gs.resize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      if (this.mode === 'solo') this.pause();
      persist(this.save);
    });

    this.toMenu();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private get me() {
    return this.w.players[this.myIdx];
  }

  private get inCoop(): boolean {
    return this.mode !== 'solo';
  }

  // ---------- Menus ----------

  private toMenu(): void {
    this.gs.setMood(null);
    this.ui.hideBanner();
    this.leaveCoop();
    persist(this.save);
    this.w.clear();
    this.ui.clearPops();
    this.me.squad.reset(statsOf(this.save).start);
    this.ui.setMenu(this.save);
    this.setState('menu');
    this.ui.show('menu');
    this.audio.music('menu');
  }

  private openShop(): void {
    this.shopReturn = this.state === 'result' ? 'result' : 'menu';
    if (!this.inCoop && this.state !== 'shop') {
      this.w.clear();
      this.me.squad.reset(statsOf(this.save).start);
    }
    this.ui.renderShop(this.save);
    this.setState('shop');
    this.ui.show('shop');
  }

  private closeShop(): void {
    if (this.shopReturn === 'result') {
      this.setState('result');
      this.ui.show('result');
    } else {
      this.toMenu();
    }
  }

  private buy(id: UpgradeId): void {
    const lv = this.save.upgrades[id];
    const cost = upgradeCost(id, lv);
    if (lv >= UPGRADES[id].max || this.save.gems < cost) return;
    this.save.gems -= cost;
    this.save.upgrades[id] = lv + 1;
    persist(this.save);
    this.audio.play('power', 0.6);
    // Show the bigger squad straight away.
    if (id === 'squad' && !this.inCoop) this.me.squad.count = statsOf(this.save).start;
    this.ui.renderShop(this.save);
  }

  private toggle(which: 'music' | 'sfx'): void {
    this.save[which] = !this.save[which];
    this.audio.setMusicEnabled(this.save.music);
    this.audio.setSfxEnabled(this.save.sfx);
    this.ui.setToggles(this.save.music, this.save.sfx);
    persist(this.save);
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.ui.showPause(this.inCoop);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.ui.show('playing');
  }

  private setState(s: State): void {
    this.state = s;
    this.stateTime = 0;
  }

  private onAction(a: Action): void {
    switch (this.state) {
      case 'menu':
        if (a === 'confirm') this.startRun();
        break;
      case 'shop':
        if (a === 'pause') this.closeShop();
        break;
      case 'coop':
        if (a === 'pause') this.toMenu();
        break;
      case 'playing':
        if (a === 'pause') this.pause();
        break;
      case 'paused':
        this.resume();
        break;
      case 'result':
        if (a === 'confirm' && this.stateTime > RESULT_INPUT_LOCK && this.mode !== 'guest') this.next();
        break;
    }
  }

  // ---------- Runs ----------

  private next(): void {
    if (this.mode === 'guest') return;
    this.startRun();
  }

  /** Solo, or as co-op host: build the level and run the simulation. */
  private startRun(): void {
    if (this.mode === 'guest') return;
    const coop = this.mode === 'host' && this.partner;
    if (this.mode === 'host' && !coop) {
      this.ui.toast('Your friend is not connected, so this level is solo.');
    }
    const plan = buildLevel(this.save.level, coop);
    this.w.setCoop(coop);
    this.w.setLocalPlayer(0);
    this.w.players[0].stats = statsOf(this.save);
    if (coop) this.w.players[1].stats = this.guestStats();
    this.sim.start(plan);
    if (coop) this.run++;

    this.level = plan.level;
    this.levelLength = plan.length;
    this.beginRunUi();
  }

  /** Co-op guest: the host started a level; mirror it. */
  private startGuestRun(level: number, run: number): void {
    this.run = run;
    this.w.setCoop(true);
    this.w.setLocalPlayer(1);
    this.w.players[1].stats = statsOf(this.save);
    this.replica.reset();
    this.w.players[1].squad.reset(statsOf(this.save).start);
    this.w.players[0].squad.reset(0);
    this.level = level;
    this.levelLength = buildLevel(level, true).length;
    this.beginRunUi();
  }

  private beginRunUi(): void {
    this.gs.setMood(null);
    this.ui.hideBanner();
    this.runGems = 0;
    this.shake = 0;
    this.ui.clearPops();
    this.ui.startRun(this.level);
    this.ui.setGems(this.save.gems);
    this.setState('playing');
    this.ui.show('playing');
    this.audio.music('run');
  }

  private finish(won: boolean, progress: number): void {
    if (won && this.mode !== 'guest') this.save.level = this.level + 1;
    persist(this.save);
    if (!won) this.gs.setMood(null);
    this.audio.play(won ? 'win' : 'lose');
    this.audio.music('menu');
    this.ui.setMenu(this.save);
    this.ui.setBoss(null);
    this.ui.setSpectating(false);
    this.setState('result');
    this.ui.showResult(won, this.level, progress, this.runGems, this.mode === 'solo' ? null : this.mode);
  }

  // ---------- Events: effects, sound, rewards ----------

  private onSimEvent(e: GameEvent): void {
    if (this.mode === 'host') this.recent.push({ at: performance.now(), a: [++this.eventSeq, ...encodeEvent(e)] });
    this.onEvent(e);
  }

  private onEvent(e: GameEvent): void {
    const fx = this.w.fx;
    const mine = 'p' in e && e.p === this.myIdx;
    const squadOf = (p: number) => this.w.players[p]?.squad;
    switch (e.k) {
      case 'kill': {
        const spec = ENEMY_SPECS[e.kind];
        const big = e.kind === 'brute' || e.kind === 'bearer';
        fx.burst(e.x, spec.height * 0.5, e.z, spec.color, big ? 20 : 14, big ? 7 : 6);
        this.gs.flash(e.x, 1.2, e.z, spec.color, big ? 40 : 14);
        if (e.kind !== 'boss') this.audio.play(big ? 'bigkill' : 'kill');
        break;
      }
      case 'gate': {
        const sq = squadOf(e.p);
        const good = e.v > 0;
        this.popAt(good ? `+${e.v}` : `−${-e.v}`, sq.x, 1.8, 0, good ? 'good' : 'bad');
        fx.burst(sq.x, 1, 0, good ? GATE_GOOD : GATE_BAD, 16, 6);
        this.gs.flash(sq.x, 2, -0.5, good ? GATE_GOOD : GATE_BAD, 35);
        this.audio.play(good ? 'gateGood' : 'gateBad', mine ? 1 : 0.5);
        if (mine && !good) this.shake = 0.25;
        break;
      }
      case 'hurt': {
        const sq = squadOf(e.p);
        this.popAt(`−${e.loss}`, sq.x, 1.8, 0, 'bad');
        fx.burst(e.x, 0.8, e.z, ENEMY_SPECS[e.kind].color, 12, 6);
        this.audio.play('hurt', mine ? 1 : 0.4);
        if (mine) this.shake = 0.35;
        break;
      }
      case 'block':
        fx.burst(e.x, 0.8, e.z, SHIELD_COLOR, 14, 6);
        this.audio.play('block', mine ? 1 : 0.5);
        break;
      case 'gem':
        fx.burst(e.x, 0.6, e.z, GEM_COLOR, 5, 4, 0.1);
        if (mine) {
          this.addGems(1);
          this.audio.play('gem');
        }
        break;
      case 'power': {
        const sq = squadOf(e.p);
        this.popAt(POWER_SPECS[e.kind].name, sq.x, 2.4, 0, mine ? 'good' : 'gem');
        fx.burst(sq.x, 1, 0, POWER_SPECS[e.kind].color, 18, 6);
        this.audio.play('power', mine ? 1 : 0.5);
        if (mine) this.gs.setMood(POWER_SPECS[e.kind].color, 1.5);
        break;
      }
      case 'shieldbreak':
        fx.burst(e.x, 1, e.z, SHIELD_COLOR, 20, 7);
        this.audio.play('shieldbreak');
        break;
      case 'boss':
        this.ui.setBoss(1);
        this.ui.banner('BOSS INCOMING', 'Bring it down before it reaches you', '#ff2b6a');
        this.gs.setMood(0xff0040, 600);
        this.audio.play('boss');
        this.audio.music('boss');
        break;
      case 'arena':
        this.ui.banner('FIGHT!', '', '#ff2b6a');
        break;
      case 'event': {
        const ev = LEVEL_EVENT_INFO[e.kind];
        this.ui.banner(ev.title, ev.sub, ev.css);
        this.gs.setMood(ev.color, ev.seconds);
        this.audio.play(e.kind === 'gemrush' ? 'power' : 'alarm');
        break;
      }
      case 'meteor':
        // The host spawned its own; the guest draws one from the event.
        if (this.mode === 'guest') this.w.hazards.spawn(e.x, e.z, e.t);
        this.audio.play('meteor', 0.7);
        break;
      case 'boom': {
        fx.burst(e.x, 0.5, e.z, 0xff7a1a, 26, 9, 0.2);
        fx.burst(e.x, 0.5, e.z, 0xffd23f, 12, 6);
        this.gs.flash(e.x, 1.5, e.z, 0xff6a1a, 60);
        this.audio.play('boom', e.p === this.myIdx || e.p < 0 ? 1 : 0.6);
        if (e.p >= 0) {
          const sq = squadOf(e.p);
          if (e.loss > 0) this.popAt(`−${e.loss}`, sq.x, 1.8, 0, 'bad');
          else this.audio.play('block');
          if (e.p === this.myIdx) this.shake = 0.45;
        }
        break;
      }
      case 'summon':
        fx.burst(e.x, 3, e.z, 0xb45cff, 30, 8);
        this.gs.flash(e.x, 3, e.z, 0xb45cff, 50);
        this.audio.play('summon');
        this.shake = Math.max(this.shake, 0.2);
        break;
      case 'bossdown':
        fx.burst(e.x, 2, e.z, ENEMY_SPECS.boss.color, 70, 12, 0.22);
        fx.burst(e.x, 2, e.z, 0xffd23f, 30, 9);
        this.ui.setBoss(0);
        this.gs.flash(e.x, 3, e.z, 0xffd23f, 90);
        this.gs.setMood(0xffd23f, 3);
        this.audio.play('bossdown');
        this.shake = 0.6;
        break;
      case 'wipe': {
        const sq = squadOf(e.p);
        fx.burst(sq.x, 0.6, 0, mine ? 0x29f0ff : 0xc58bff, 30, 8);
        this.audio.play('wipe', mine ? 1 : 0.5);
        if (mine) {
          this.shake = 0.5;
          if (this.inCoop && this.partnerAlive()) this.ui.setSpectating(true);
        }
        break;
      }
      case 'reward':
        if (mine) {
          this.addGems(e.n);
          this.popAt(`+${e.n} GEMS`, this.me.squad.x, 2.6, -2, 'gem');
        }
        break;
    }
  }

  private partnerAlive(): boolean {
    const p = this.w.players[1 - this.myIdx];
    return p.active && !p.wiped;
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

  // ---------- Co-op session ----------

  private openCoop(): void {
    this.setState('coop');
    const note =
      detectVia() === 'room'
        ? `Here, co-op needs both players signed in to claude.ai with access to this page. If it won't connect (common on iPhone), use the standalone game: ${STANDALONE_URL.replace('https://', '')}`
        : 'Your friend opens this same page, taps CO-OP and enters your code.';
    this.ui.resetCoopBack();
    this.ui.showCoop(note);
  }

  private async hostCoop(): Promise<void> {
    this.ui.setCoopBusy(true, 'host');
    const code = makeCode();
    let ch: Channel;
    try {
      ch = await openChannel('host', code);
    } catch (e) {
      this.coopFailed(e);
      return;
    }
    if (this.state !== 'coop') return ch.close(); // backed out while connecting
    this.attach(ch, 'host');
    this.ui.coopSession(code, 'host', this.partner, this.save.level);
  }

  private async joinCoop(raw: string): Promise<void> {
    const code = normalizeCode(raw);
    if (!code) {
      this.ui.coopError('Codes are 5 letters and numbers, like K7PQ2.');
      return;
    }
    this.ui.setCoopBusy(true, 'join');
    let ch: Channel;
    try {
      ch = await openChannel('guest', code);
    } catch (e) {
      this.coopFailed(e);
      return;
    }
    if (this.state !== 'coop') return ch.close();
    this.attach(ch, 'guest');
    this.ui.coopSession(code, 'guest', true, 0);
  }

  private coopFailed(e: unknown): void {
    this.ui.setCoopBusy(false);
    this.ui.coopError(e instanceof NetError ? e.message : 'Something went wrong connecting. Try again.', e instanceof NetError ? e.link : undefined);
    if (!(e instanceof NetError)) console.error(e);
  }

  private attach(ch: Channel, role: 'host' | 'guest'): void {
    this.channel = ch;
    this.mode = role;
    this.myIdx = role === 'host' ? 0 : 1;
    this.w.setLocalPlayer(this.myIdx);
    this.run = 0;
    this.recent = [];
    ch.onState((s) => this.onNet(s));
    ch.onPartner((p) => this.onPartner(p));
  }

  private leaveCoop(): void {
    if (!this.channel) return;
    this.channel.close();
    this.channel = null;
    this.mode = 'solo';
    this.myIdx = 0;
    this.partner = false;
    this.guestMsg = null;
    this.w.setCoop(false);
    this.w.setLocalPlayer(0);
  }

  private onPartner(present: boolean): void {
    const was = this.partner;
    this.partner = present;
    if (this.mode === 'host') {
      if (this.state === 'coop') this.ui.coopSession(this.channel!.code, 'host', present, this.save.level);
      if (was && !present && this.state !== 'coop') {
        this.ui.toast('Your friend left. You can keep playing solo.');
        this.leaveCoop();
        this.w.setCoop(false);
      }
    } else if (this.mode === 'guest' && was && !present) {
      this.toMenu();
      this.ui.toast('The host left the game.');
    }
  }

  private guestStats(): PlayerStats {
    // The guest's numbers come from another browser: keep them within sane bounds.
    const st = this.guestMsg?.st ?? [5, 1, 3];
    const clamp = (v: unknown, lo: number, hi: number, d: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    };
    return { start: Math.round(clamp(st[0], 1, 200, 5)), power: clamp(st[1], 0.5, 20, 1), rate: clamp(st[2], 1, 12, 3) };
  }

  private onNet(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as GuestMsg | HostMsg;
    if (this.mode === 'host' && msg.r === 'g') {
      this.guestMsg = msg;
      if (this.w.players[1].active) this.w.players[1].squad.setTarget(Number(msg.x) || 0);
    } else if (this.mode === 'guest' && msg.r === 'h') {
      this.onHostMsg(msg);
    }
  }

  private onHostMsg(m: HostMsg): void {
    const inRun = this.state === 'playing' || this.state === 'paused';
    if (m.s === 'play') {
      if (m.run !== this.run) this.startGuestRun(m.lv, m.run);
      if (m.snap) this.replica.apply(m.snap);
    } else if (m.s === 'result' && m.run === this.run && inRun) {
      if (m.snap) this.replica.apply(m.snap);
      this.finish(m.won === 1, this.replica.distance / this.levelLength);
    } else if (m.s === 'lobby' && this.state === 'coop') {
      this.ui.coopSession(this.channel!.code, 'guest', true, m.lv);
    }
  }

  private netTick(dt: number): void {
    const ch = this.channel;
    if (!ch) return;
    this.netTimer += dt;
    if (this.netTimer < NET_INTERVAL) return;
    this.netTimer = 0;

    if (this.mode === 'host') {
      const coopRun = this.w.players[1].active;
      const stage: HostMsg['s'] =
        coopRun && (this.state === 'playing' || this.state === 'paused')
          ? 'play'
          : coopRun && this.state === 'result'
            ? 'result'
            : 'lobby';
      const now = performance.now();
      this.recent = this.recent.filter((r) => now - r.at < EVENT_RESEND_MS);
      const msg: HostMsg = { r: 'h', s: stage, lv: stage === 'lobby' ? this.save.level : this.level, run: this.run };
      if (stage !== 'lobby') msg.snap = encodeSnap(this.sim, this.w, this.recent.map((r) => r.a));
      if (stage === 'result') msg.won = this.sim.result === 'won' ? 1 : 0;
      ch.send(msg);
    } else {
      const st = statsOf(this.save);
      const msg: GuestMsg = { r: 'g', x: Math.round(this.me.squad.targetX * 100) / 100, st: [st.start, st.power, st.rate] };
      ch.send(msg);
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
      this.me.squad.steer(drag * worldPerPx);
    }

    // Fixed-step simulation keeps gameplay identical at 30, 60 or 120 Hz.
    this.acc += dt;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.netTick(dt);

    this.w.sync(this.time);
    this.updateCamera(dt);
    // Lights: decay flashes, ease the mood colour, pulse the neon to the music's beat
    // (or to a steady 112 bpm clock when music is off).
    this.gs.updateLights(dt);
    let pulse = this.audio.beat();
    if (pulse < 0) pulse = 0.6 * Math.exp(-(((now / 1000) * 112) / 60 % 1) * 7);
    this.w.track.setPulse(pulse, this.gs.mood, this.gs.moodMix);
    this.gs.backdrop.update(now / 1000);
    this.gs.render();
  };

  private step(dt: number): void {
    this.stateTime += dt;
    // In co-op the game keeps running behind the menu; it can't be paused for both.
    const running = this.state === 'playing' || (this.state === 'paused' && this.inCoop);

    if (running) {
      this.time += dt;
      this.me.squad.steer(this.input.keyAxis * KEY_STEER_SPEED * dt);
      if (this.mode === 'guest') {
        this.replica.step(dt, this.time);
        this.ui.setProgress(this.replica.distance / this.levelLength);
        if (this.replica.boss) this.ui.setBoss(this.replica.boss.hp / this.replica.boss.max);
      } else {
        this.sim.step(dt, this.time);
        this.ui.setProgress(this.sim.distance / this.levelLength);
        if (this.sim.boss) this.ui.setBoss(this.sim.boss.hp / this.sim.boss.maxHp);
        if (this.sim.result) this.finish(this.sim.result === 'won', this.sim.distance / this.levelLength);
      }
      this.ui.setPowers(this.me.pw);
    } else if (this.state === 'menu' || (this.state === 'shop' && !this.inCoop) || this.state === 'coop') {
      this.time += dt;
      this.w.track.update(MENU_SPEED * dt);
      this.me.squad.update(dt, this.time, true);
    } else if (this.state === 'result' || this.state === 'shop') {
      this.time += dt;
      this.w.fx.update(dt, 0);
      for (const p of this.w.players) if (p.active) p.squad.update(dt, this.time, false);
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.gs.camera;
    const sx = this.me.squad.x;
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
