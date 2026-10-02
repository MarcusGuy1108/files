import * as THREE from 'three';
import { COLORS } from '../render/Scene';

/** Half the playable width; the squad, gates and enemies all live inside ±TRACK_HALF. */
export const TRACK_HALF = 4;

const GRID_LENGTH = 220;
const CELL = 2;
const PILLAR_SPACING = 12;
const PILLAR_COUNT = 14; // per side

/** Scrolling floor grid plus roadside pillars that give a sense of speed. */
export class Track {
  private gridMat: THREE.ShaderMaterial;
  private pillars: THREE.Mesh[] = [];

  constructor(parent: THREE.Object3D) {
    this.gridMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uOffset: { value: 0 },
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

          // Lines stay subtle on the road so the squad, enemies and gates read clearly.
          float dist = -vPos.z;
          line *= (1.0 - smoothstep(25.0, 110.0, dist)) * mix(0.9, 0.35, onRoad);
          vec3 col = mix(uOff, uRoad, onRoad) + uLine * line;
          col = mix(col, uEdge * 1.2, edge * (1.0 - smoothstep(60.0, 170.0, dist)));
          float fade = smoothstep(40.0, 190.0, dist);
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
    for (let i = 0; i < PILLAR_COUNT; i++) {
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(pillarGeo, i % 2 === 0 ? pinkMat : cyanMat);
        m.position.set(side * (TRACK_HALF + 2.5), 0, 14 - i * PILLAR_SPACING);
        parent.add(m);
        this.pillars.push(m);
      }
    }
  }

  update(dz: number): void {
    const u = this.gridMat.uniforms.uOffset;
    u.value = (u.value + dz) % CELL;
    const wrap = PILLAR_SPACING * PILLAR_COUNT;
    for (const p of this.pillars) {
      p.position.z += dz;
      if (p.position.z > 16) p.position.z -= wrap;
    }
  }
}
