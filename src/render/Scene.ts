import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Backdrop, SKY } from './Backdrop';
import type { Theme } from './themes';

export const COLORS = {
  pink: 0xff2bd6,
  cyan: 0x29f0ff,
  yellow: 0xffd23f,
  purple: 0x8a2bff,
  horizon: SKY.horizon.getHex(),
};

const MIN_HFOV_DEG = 56; // keeps the whole track width in view on tall phones
const BASE_VFOV_DEG = 55;

export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly backdrop: Backdrop;
  private hemi: THREE.HemisphereLight;
  private muzzle: THREE.PointLight;
  private flashes: THREE.PointLight[] = [];
  private flashIdx = 0;
  private baseGlow = new THREE.Color(SKY.glow);
  private moodTarget = new THREE.Color(SKY.glow);
  private sunLight: THREE.DirectionalLight;
  private blackoutTimer = 0;
  private blackout = 0;
  private moodTimer = 0;
  readonly mood = new THREE.Color(SKY.glow);
  /** 0 normally, easing to 1 while a mood colour is active. */
  moodMix = 0;

  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private bloomEnabled = true;
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(BASE_VFOV_DEG, 1, 0.1, 320);
    this.camera.position.set(0, 6.8, 8.6);
    this.camera.lookAt(0, 0, -14);

    this.scene.fog = new THREE.Fog(COLORS.horizon, 60, 150);

    // Solid, lit models read far better against the neon floor than outlines alone.
    this.hemi = new THREE.HemisphereLight(0xd9ccff, 0x2a1040, 1.6);
    this.scene.add(this.hemi);
    // A fixed set of point lights (intensity 0 when idle) so shaders never recompile.
    this.muzzle = new THREE.PointLight(0xffd23f, 0, 9, 1.6);
    this.scene.add(this.muzzle);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      this.flashes.push(l);
      this.scene.add(l);
    }
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sunLight = sun;
    sun.position.set(3, 10, 8);
    this.scene.add(sun);

    this.backdrop = new Backdrop(this.scene);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.3, 0.55);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Very low-memory devices start without bloom; others adapt at runtime.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mem !== undefined && mem <= 2) this.bloomEnabled = false;

    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    // Widen the vertical FOV on tall screens so the horizontal FOV never drops below MIN_HFOV.
    const minVfov =
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(MIN_HFOV_DEG) / 2) / aspect) * THREE.MathUtils.RAD2DEG;
    this.camera.fov = Math.min(100, Math.max(BASE_VFOV_DEG, minVfov));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
  }

  /** Muzzle flash at the squad. */
  fireFlash(x: number): void {
    this.muzzle.position.set(x, 1.2, -0.8);
    this.muzzle.intensity = 9;
  }

  /** A short coloured burst of light, e.g. an explosion. */
  flash(x: number, y: number, z: number, color: number, intensity = 30): void {
    const l = this.flashes[this.flashIdx++ % this.flashes.length];
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.intensity = intensity;
  }

  /** Shift the scene's mood colour for a while (null: back to the default). */
  setMood(color: number | null, seconds = 0): void {
    if (color === null) this.moodTarget.copy(this.baseGlow);
    else this.moodTarget.set(color);
    this.moodTimer = color === null ? 0 : seconds;
  }

  /** Switch the level's colour scheme. */
  setTheme(t: Theme): void {
    this.baseGlow.setHex(t.glow);
    if (this.moodTimer <= 0) this.moodTarget.copy(this.baseGlow);
    this.backdrop.setSun(t.sunTop, t.sunBottom);
  }

  /** Dim the world for a while: fog closes in, ambient light drops. */
  setBlackout(seconds: number): void {
    this.blackoutTimer = seconds;
  }

  /** Per frame: decay lights, ease the mood colour. */
  updateLights(dt: number): void {
    this.muzzle.intensity *= Math.exp(-dt * 18);
    for (const l of this.flashes) l.intensity *= Math.exp(-dt * 7);
    if (this.moodTimer > 0 && (this.moodTimer -= dt) <= 0) this.moodTarget.copy(this.baseGlow);
    this.mood.lerp(this.moodTarget, Math.min(1, dt * 2.5));
    this.moodMix += ((this.moodTimer > 0 ? 1 : 0) - this.moodMix) * Math.min(1, dt * 2.5);
    this.backdrop.setGlow(this.mood);
    // Ambient light takes a little of the mood colour too.
    this.hemi.color.setRGB(0.85, 0.8, 1).lerp(this.mood, 0.25);
    this.blackoutTimer = Math.max(0, this.blackoutTimer - dt);
    this.blackout += ((this.blackoutTimer > 0 ? 1 : 0) - this.blackout) * Math.min(1, dt * 2);
    const b = this.blackout;
    this.hemi.intensity = 1.6 - 1.35 * b;
    this.sunLight.intensity = 2.2 - 2.0 * b;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = 60 - 48 * b;
    fog.far = 150 - 105 * b;
  }

  render(): void {
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Step quality down one notch. Returns false when already at the floor. */
  degrade(): boolean {
    if (this.bloomEnabled) {
      this.bloomEnabled = false;
      return true;
    }
    if (this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.resize();
      return true;
    }
    return false;
  }
}
