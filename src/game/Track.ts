import * as THREE from 'three';
import { COLORS } from '../render/Scene';

/** Half the playable width; the squad, gates and enemies all live inside ±TRACK_HALF. */
export const TRACK_HALF = 4;

const GRID_LENGTH = 220;
const CELL = 2;
const PILLAR_SPACING = 12;
const PILLAR_COUNT = 14; // per side
const ARCH_SPACING = 56;
const ARCH_COUNT = 4;
const ARCH_COLORS = [COLORS.pink, COLORS.cyan, COLORS.purple, COLORS.yellow];

/** Scrolling floor grid plus roadside pillars that give a sense of speed. */
export class Track {
  private gridMat: THREE.ShaderMaterial;
  private pillars: THREE.Mesh[] = [];
  private pillarMats: THREE.MeshBasicMaterial[] = [];
  private arches: { group: THREE.Group; mat: THREE.MeshBasicMaterial; hue: number }[] = [];
  private lineColor = new THREE.Color(COLORS.pink);

  constructor(parent: THREE.Object3D) {
    this.gridMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uOffset: { value: 0 },
        uPulse: { value: 0 },
        uCell: { value: CELL },
        uEdgeX: { value: TRACK_HALF + 0.25 },
        uRoad: { value: new THREE.Color(0x140a2a) },
        uOff: { value: new THREE.Color(0x07020f) },
        uLine: { value: new THREE.Color(COLORS.pink) },
        uEdge: { value: new THREE.Color(COLORS.cyan) },
        uHorizon: { value: new THREE.Color(COLORS.horizon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOffset;
        uniform float uPulse;
        uniform float uCell;
        uniform float uEdgeX;
        uniform vec3 uRoad;
        uniform vec3 uOff;
        uniform vec3 uLine;
        uniform vec3 uEdge;
        uniform vec3 uHorizon;
        varying vec3 vPos;
        void main() {
          vec2 p = vec2(vPos.x, vPos.z - uOffset) / uCell;
          vec2 w = max(fwidth(p), vec2(1e-4));
          vec2 g = abs(fract(p - 0.5) - 0.5) / (w * 1.4);
          float line = 1.0 - min(min(g.x, g.y), 1.0);

          float ax = abs(vPos.x);
          float onRoad = 1.0 - step(uEdgeX, ax);
          float edgeW = max(fwidth(vPos.x) * 1.5, 0.06);
          float edge = 1.0 - smoothstep(0.0, edgeW, abs(ax - uEdgeX));

          // Fade lines out once a cell shrinks to a few pixels; that is where moire starts.
          line *= 1.0 - smoothstep(0.18, 0.45, max(w.x, w.y));
          // Lines stay subtle on the road so the squad, enemies and gates read clearly;
          // off the road they fade out sooner.
          float dist = -vPos.z;
          float reach = mix(70.0, 120.0, onRoad);
          line *= (1.0 - smoothstep(20.0, reach, dist)) * mix(0.55, 0.35, onRoad);
          // Lines flare on each beat of the music.
          vec3 col = mix(uOff, uRoad, onRoad) + uLine * line * (1.0 + uPulse * 1.4);
          col = mix(col, uEdge * (1.2 + uPulse * 0.8), edge * (1.0 - smoothstep(60.0, 170.0, dist)));
          float fade = smoothstep(30.0, 175.0, dist);
          gl_FragColor = vec4(mix(col, uHorizon, fade), 1.0);
          #include <colorspace_fragment>
        }`,
    });

    const grid = new THREE.Mesh(new THREE.PlaneGeometry(200, GRID_LENGTH), this.gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.z = -GRID_LENGTH / 2 + 20;
    parent.add(grid);

    const pillarGeo = new THREE.BoxGeometry(0.15, 3.5, 0.15);
    pillarGeo.translate(0, 1.75, 0);
    const pinkMat = new THREE.MeshBasicMaterial({ color: COLORS.pink });
    const cyanMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
    this.pillarMats = [pinkMat, cyanMat];
    for (let i = 0; i < PILLAR_COUNT; i++) {
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(pillarGeo, i % 2 === 0 ? pinkMat : cyanMat);
        m.position.set(side * (TRACK_HALF + 2.5), 0, 14 - i * PILLAR_SPACING);
        parent.add(m);
        this.pillars.push(m);
      }
    }
    this.buildArches(parent);
  }

  /** Neon arches over the road that you run under. */
  private buildArches(parent: THREE.Object3D): void {
    const span = (TRACK_HALF + 1.3) * 2;
    // Taller than the camera (y 6.8) so the beam sweeps overhead instead of across the view.
    const postGeo = new THREE.BoxGeometry(0.2, 8, 0.2);
    postGeo.translate(0, 4, 0);
    const beamGeo = new THREE.BoxGeometry(span + 0.2, 0.16, 0.16);
    for (let i = 0; i < ARCH_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: ARCH_COLORS[i % ARCH_COLORS.length], transparent: true });
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, mat);
        post.position.x = (s * span) / 2;
        g.add(post);
      }
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.y = 8;
      g.add(beam);
      g.position.z = -30 - i * ARCH_SPACING;
      parent.add(g);
      this.arches.push({ group: g, mat, hue: i });
    }
  }

  /** Level colour scheme: grid line and road edge colours. */
  setColors(line: number, edge: number): void {
    this.lineColor.setHex(line);
    (this.gridMat.uniforms.uEdge.value as THREE.Color).setHex(edge);
  }

  /** Beat pulse (0..1) and the mood colour for the floor lines. */
  setPulse(pulse: number, mood: THREE.Color, moodMix: number): void {
    this.gridMat.uniforms.uPulse.value = pulse;
    (this.gridMat.uniforms.uLine.value as THREE.Color).copy(this.lineColor).lerp(mood, moodMix * 0.9);
    const k = 0.75 + pulse * 0.6;
    this.pillarMats[0].color.setHex(COLORS.pink).multiplyScalar(k);
    this.pillarMats[1].color.setHex(COLORS.cyan).multiplyScalar(k);
    for (const a of this.arches) a.mat.color.setHex(ARCH_COLORS[a.hue % ARCH_COLORS.length]).multiplyScalar(0.7 + pulse * 0.8);
  }

  update(dz: number): void {
    const u = this.gridMat.uniforms.uOffset;
    u.value = (u.value + dz) % CELL;
    const wrap = PILLAR_SPACING * PILLAR_COUNT;
    for (const p of this.pillars) {
      p.position.z += dz;
      if (p.position.z > 16) p.position.z -= wrap;
    }
    for (const a of this.arches) {
      a.group.position.z += dz;
      if (a.group.position.z > 14) {
        a.group.position.z -= ARCH_SPACING * ARCH_COUNT;
        a.hue++; // a new colour each time it comes round
      }
      // Fade out as it comes overhead, so the beam never sweeps across the top of a tall screen.
      const z = a.group.position.z;
      a.mat.opacity = Math.max(0, Math.min(1, (-z - 6) / 14));
      a.group.visible = a.mat.opacity > 0.01;
    }
  }
}
