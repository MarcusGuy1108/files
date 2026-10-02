import * as THREE from 'three';
import { COLORS } from '../render/Scene';
import { type AABB, setAABB } from './Collision';

export const LANE_WIDTH = 2.2;
export const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];

export type MoveAction = 'left' | 'right' | 'jump' | 'slide';

const JUMP_VELOCITY = 11;
const GRAVITY = 32;
const FAST_FALL_VELOCITY = -20;
const SLIDE_TIME = 0.65;
const BUFFER_TIME = 0.15;
const LANE_SPEED = 18;

const WIDTH = 0.6;
const HEIGHT = 1.6;
const SLIDE_HEIGHT = 0.7;

export class Player {
  readonly group = new THREE.Group();
  private body: THREE.Group;

  lane = 1;
  x = 0;
  y = 0;
  private vy = 0;
  private slideTimer = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private dead = false;

  private edgeMat: THREE.LineBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D) {
    this.body = new THREE.Group();
    this.group.add(this.body);

    const fillMat = new THREE.MeshBasicMaterial({ color: 0x0a1630 });
    this.edgeMat = new THREE.LineBasicMaterial({ color: COLORS.cyan });
    this.glowMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });

    const addPart = (w: number, h: number, d: number, y: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, fillMat);
      mesh.position.y = y;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMat);
      mesh.add(edges);
      this.body.add(mesh);
      return mesh;
    };

    addPart(0.62, 1.0, 0.5, 0.5); // torso
    addPart(0.46, 0.42, 0.46, 1.33); // head

    // Glowing visor and hover strip so bloom has something to grab onto.
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), this.glowMat);
    visor.position.set(0, 1.36, -0.24);
    this.body.add(visor);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.54), this.glowMat);
    strip.position.y = 0.05;
    this.body.add(strip);

    parent.add(this.group);
  }

  get grounded(): boolean {
    return this.y <= 0 && this.vy <= 0;
  }

  get sliding(): boolean {
    return this.slideTimer > 0;
  }

  reset(): void {
    this.lane = 1;
    this.x = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.slideTimer = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.dead = false;
    this.edgeMat.color.setHex(COLORS.cyan);
    this.glowMat.color.setHex(COLORS.cyan);
    this.syncMesh(0);
  }

  input(action: MoveAction): void {
    if (this.dead) return;
    switch (action) {
      case 'left':
        this.lane = Math.max(0, this.lane - 1);
        break;
      case 'right':
        this.lane = Math.min(LANES.length - 1, this.lane + 1);
        break;
      case 'jump':
        if (this.grounded) this.jump();
        else this.jumpBuffer = BUFFER_TIME;
        break;
      case 'slide':
        if (this.grounded) {
          this.slideTimer = SLIDE_TIME;
        } else {
          // Slam down out of a jump, then slide on landing.
          this.vy = Math.min(this.vy, FAST_FALL_VELOCITY);
          this.slideBuffer = BUFFER_TIME + 0.2;
          this.jumpBuffer = 0;
        }
        break;
    }
  }

  die(): void {
    this.dead = true;
    this.edgeMat.color.setHex(0xff3355);
    this.glowMat.color.setHex(0xff3355);
  }

  update(dt: number, time: number): void {
    if (this.dead) return;

    const targetX = LANES[this.lane];
    this.x += (targetX - this.x) * Math.min(1, dt * LANE_SPEED);

    if (!this.grounded || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = Math.max(0, this.slideBuffer - dt);
    this.slideTimer = Math.max(0, this.slideTimer - dt);

    if (this.grounded) {
      if (this.jumpBuffer > 0) this.jump();
      else if (this.slideBuffer > 0) {
        this.slideBuffer = 0;
        this.slideTimer = SLIDE_TIME;
      }
    }

    this.syncMesh(time);
  }

  /** Collision box: narrower than the visual mesh to keep near-misses fair. */
  getBox(out: AABB): AABB {
    const h = this.sliding ? SLIDE_HEIGHT : HEIGHT;
    return setAABB(out, this.x, this.y, 0, WIDTH, h, 0.5);
  }

  private jump(): void {
    this.vy = JUMP_VELOCITY;
    this.y = Math.max(this.y, 0.001);
    this.slideTimer = 0;
    this.jumpBuffer = 0;
  }

  private syncMesh(time: number): void {
    this.group.position.set(this.x, this.y, 0);
    const bob = this.grounded && !this.sliding ? Math.abs(Math.sin(time * 14)) * 0.06 : 0;
    this.body.position.y = 0.1 + bob;
    this.body.scale.y = this.sliding ? SLIDE_HEIGHT / HEIGHT : 1;
    // Lean into lane changes.
    this.body.rotation.z = THREE.MathUtils.clamp((this.x - LANES[this.lane]) * 0.25, -0.35, 0.35);
    this.body.rotation.x = this.sliding ? -0.25 : 0;
  }
}
