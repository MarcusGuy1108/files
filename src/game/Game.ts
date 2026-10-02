import * as THREE from 'three';
import { GameScene } from '../render/Scene';
import { Input, type Action } from '../input/Input';
import { UI } from '../ui/UI';
import { loadBest, saveBest } from '../storage';
import { Player } from './Player';
import { Track } from './Track';
import { Obstacles } from './Obstacles';
import { Pickups } from './Pickups';
import { Spawner } from './Spawner';
import { makeAABB, overlaps } from './Collision';

type State = 'menu' | 'playing' | 'paused' | 'dying' | 'gameover';

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const START_SPEED = 18;
const MAX_SPEED = 46;
const ACCEL_PER_UNIT = 0.0045;
const MENU_SPEED = 10;
const ORB_SCORE = 50;
const DYING_TIME = 0.8;
const GAMEOVER_INPUT_LOCK = 0.4;

export class Game {
  private gs: GameScene;
  private world = new THREE.Group();
  private player: Player;
  private track: Track;
  private obstacles: Obstacles;
  private pickups: Pickups;
  private spawner: Spawner;
  private ui: UI;

  private state: State = 'menu';
  private speed = 0;
  private distance = 0;
  private orbs = 0;
  private best = loadBest();
  private stateTime = 0;
  private time = 0;

  private acc = 0;
  private lastFrame = 0;
  private frameEma = 16;
  private perfTimer = 0;

  private playerBox = makeAABB();
  private otherBox = makeAABB();

  constructor(canvas: HTMLCanvasElement) {
    this.gs = new GameScene(canvas);
    this.gs.scene.add(this.world);

    this.player = new Player(this.world);
    this.track = new Track(this.world);
    this.obstacles = new Obstacles(this.world);
    this.pickups = new Pickups(this.world);
    this.spawner = new Spawner(this.obstacles, this.pickups);

    this.ui = new UI({
      play: () => this.startRun(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      menu: () => this.toMenu(),
    });
    new Input((a) => this.onAction(a));

    window.addEventListener('resize', () => this.gs.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    this.ui.setBest(this.best);
    this.player.reset();
    this.toMenu();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  get score(): number {
    return Math.floor(this.distance) + this.orbs * ORB_SCORE;
  }

  // ---------- State transitions ----------

  private toMenu(): void {
    this.obstacles.reset();
    this.pickups.reset();
    this.player.reset();
    this.setState('menu');
    this.ui.show('menu');
  }

  private startRun(): void {
    this.obstacles.reset();
    this.pickups.reset();
    this.spawner.reset();
    this.player.reset();
    this.speed = START_SPEED;
    this.distance = 0;
    this.orbs = 0;
    this.ui.setScore(0);
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

  private crash(): void {
    this.player.die();
    this.setState('dying');
  }

  private gameOver(): void {
    const score = this.score;
    const isNewBest = score > this.best;
    if (isNewBest) {
      this.best = score;
      saveBest(score);
      this.ui.setBest(score);
    }
    this.setState('gameover');
    this.ui.showGameOver(score, this.best, isNewBest);
  }

  private setState(s: State): void {
    this.state = s;
    this.stateTime = 0;
  }

  private onAction(a: Action): void {
    switch (this.state) {
      case 'menu':
        if (a === 'confirm' || a === 'jump') this.startRun();
        break;
      case 'playing':
        if (a === 'pause') this.pause();
        else if (a !== 'confirm') this.player.input(a);
        break;
      case 'paused':
        if (a === 'pause' || a === 'confirm') this.resume();
        break;
      case 'gameover':
        if ((a === 'confirm' || a === 'jump') && this.stateTime > GAMEOVER_INPUT_LOCK) this.startRun();
        break;
    }
  }

  // ---------- Loop ----------

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(MAX_FRAME, (now - this.lastFrame) / 1000) : STEP;
    this.lastFrame = now;

    this.trackPerformance(dt);

    // Fixed-step simulation keeps gameplay identical at 30, 60 or 120 Hz.
    this.acc += dt;
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }

    this.updateCamera();
    this.gs.render();
  };

  private step(dt: number): void {
    this.stateTime += dt;
    if (this.state === 'paused') return;
    this.time += dt;

    switch (this.state) {
      case 'menu':
        // Attract mode: the floor keeps scrolling behind the title screen.
        this.track.update(MENU_SPEED * dt);
        this.player.update(dt, this.time);
        break;

      case 'playing': {
        this.speed = Math.min(MAX_SPEED, START_SPEED + this.distance * ACCEL_PER_UNIT);
        const dz = this.speed * dt;
        this.distance += dz;
        this.track.update(dz);
        this.obstacles.update(dz);
        this.pickups.update(dz, this.time);
        this.spawner.update(dz, this.speed, this.distance);
        this.player.update(dt, this.time);
        this.checkCollisions();
        this.ui.setScore(this.score);
        break;
      }

      case 'dying':
        if (this.stateTime > DYING_TIME) this.gameOver();
        break;
    }
  }

  private checkCollisions(): void {
    const pb = this.player.getBox(this.playerBox);

    for (const o of this.obstacles.active) {
      if (overlaps(pb, this.obstacles.getBox(o, this.otherBox))) {
        this.crash();
        return;
      }
    }

    const active = this.pickups.active;
    for (let i = active.length - 1; i >= 0; i--) {
      if (overlaps(pb, this.pickups.getBox(active[i], this.otherBox))) {
        this.pickups.release(i);
        this.orbs++;
      }
    }
  }

  private updateCamera(): void {
    const cam = this.gs.camera;
    const px = this.player.x;
    cam.position.set(px * 0.55, 3.4, 6.5);
    if (this.state === 'dying') {
      const k = Math.max(0, 1 - this.stateTime / DYING_TIME) * 0.35;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
    }
    cam.lookAt(px * 0.35, 1.2, -8);
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
