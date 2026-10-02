import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const COLORS = {
  pink: 0xff2bd6,
  cyan: 0x29f0ff,
  yellow: 0xffd23f,
  purple: 0x8a2bff,
  horizon: 0x2a0a3a,
};

/** Horizontal field of view we try to keep, so all three lanes fit on narrow portrait screens. */
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

    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(COLORS.horizon, 60, 150);

    // Solid, lit models read far better against the neon floor than outlines alone.
    this.scene.add(new THREE.HemisphereLight(0xd9ccff, 0x2a1040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 10, 8);
    this.scene.add(sun);

    this.buildSun();
    this.buildMountains();

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

  private buildSun(): void {
    const mat = new THREE.ShaderMaterial({
      fog: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          if (length(c) > 0.5) discard;
          // Classic synthwave sun: horizontal gaps that widen towards the bottom.
          if (vUv.y < 0.48) {
            float gap = (0.48 - vUv.y) * 1.3;
            if (fract(vUv.y * 16.0) < gap) discard;
          }
          vec3 top = vec3(1.0, 0.72, 0.12);
          vec3 bottom = vec3(0.95, 0.05, 0.45);
          gl_FragColor = vec4(mix(bottom, top, smoothstep(0.1, 0.95, vUv.y)) * 0.8, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), mat);
    sun.position.set(0, 21, -260);
    sun.renderOrder = -1;
    this.scene.add(sun);
  }

  private buildMountains(): void {
    const fill = new THREE.MeshBasicMaterial({
      color: 0x12031f,
      side: THREE.DoubleSide, // one side is mirrored, which flips its winding
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const wire = new THREE.MeshBasicMaterial({ color: COLORS.purple, wireframe: true, side: THREE.DoubleSide });

    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(90, 180, 18, 30);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i) + 45; // 0 at the track edge, 90 at the far edge
        const lz = pos.getZ(i);
        const ridge = Math.sin(lz * 0.07 + side) * 0.5 + Math.sin(lz * 0.19 + lx * 0.11) * 0.3 + 0.8;
        const h = Math.max(0, lx - 6) * 0.42 * ridge + (Math.random() - 0.5) * 2 * Math.min(1, lx / 20);
        pos.setY(i, Math.max(0, h));
      }
      geo.computeVertexNormals();
      const x = side * (12 + 45);
      const z = -120;
      for (const m of [fill, wire]) {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, 0, z);
        mesh.scale.x = side; // mirror so the low edge faces the track
        this.scene.add(mesh);
      }
    }
  }
}

function makeSkyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#05010c');
  g.addColorStop(0.45, '#1a0530');
  g.addColorStop(0.7, '#3d0a52');
  g.addColorStop(1, '#2a0a3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
