import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Backdrop, SKY } from './Backdrop';

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
    this.scene.add(new THREE.HemisphereLight(0xd9ccff, 0x2a1040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
