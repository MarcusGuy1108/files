import * as THREE from 'three';

/** Sky colours. The horizon matches the scene fog so the floor melts into the sky. */
export const SKY = {
  zenith: new THREE.Color(0x05010d),
  mid: new THREE.Color(0x1a0634),
  glow: new THREE.Color(0xff3d8b),
  horizon: new THREE.Color(0x3a0d50),
};

const DOME_RADIUS = 290;

/**
 * Everything beyond the track: a gradient sky dome with stars, a striped sun with a soft
 * halo, and two layers of solid mountain ridges. All edges are anti-aliased in the shaders,
 * so nothing shimmers as the camera moves.
 */
export class Backdrop {
  private skyMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uZenith: { value: SKY.zenith },
        uMid: { value: SKY.mid },
        uGlow: { value: SKY.glow },
        uHorizon: { value: SKY.horizon },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // pin to the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uGlow;
        uniform vec3 uHorizon;
        varying vec3 vDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.12, h));
          col = mix(col, uZenith, smoothstep(0.12, 0.55, h));
          // Warm glow hugging the horizon, strongest straight ahead.
          float ahead = smoothstep(-0.2, -1.0, d.z);
          col += uGlow * exp(-max(h, 0.0) * 22.0) * (0.25 + 0.35 * ahead) * step(-0.02, h);

          // Stars: one candidate per cell on a 3D lattice, soft-edged and twinkling.
          vec3 p = d * 140.0;
          vec3 cell = floor(p);
          float r = hash(cell);
          if (r > 0.985 && h > 0.06) {
            vec3 c = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5) * 0.6;
            float dist = length(p - c);
            float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
            float star = (1.0 - smoothstep(0.05, 0.22, dist)) * tw * smoothstep(0.06, 0.3, h);
            col += vec3(0.85, 0.9, 1.0) * star;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), this.skyMat);
    dome.renderOrder = -2;
    dome.frustumCulled = false;
    scene.add(dome);

    scene.add(buildSun());
    scene.add(buildRidge(-232, 0x1a0733, 0x8a3bff, 0.6, 1.0, 11));
    scene.add(buildRidge(-205, 0x0c0219, 0xff2bd6, 0.9, 0.75, 29));
  }

  update(time: number): void {
    this.skyMat.uniforms.uTime.value = time;
  }
}

function buildSun(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        // The quad is twice the sun's size; the outer half holds the halo.
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float aa = fwidth(r) * 1.5;
        float disc = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, r);

        // Horizontal gaps that widen towards the bottom, with soft edges.
        float y = c.y / 0.5 * 0.5 + 0.5; // 0 at the sun's bottom, 1 at its top
        float band = fract(y * 11.0);
        float gap = clamp((0.55 - y) * 1.25, 0.0, 0.9);
        float bw = fwidth(y * 11.0) * 1.2;
        float stripes = smoothstep(gap - bw, gap + bw, band);
        if (y > 0.55) stripes = 1.0;

        vec3 top = vec3(1.0, 0.82, 0.3);
        vec3 bottom = vec3(1.0, 0.18, 0.55);
        vec3 sunCol = mix(bottom, top, smoothstep(0.05, 0.95, y));

        // Halo fades to exactly zero before the quad's edge, so no box outline shows.
        float halo = exp(-max(r - 0.5, 0.0) * 5.0) * 0.22 * (1.0 - disc) * (1.0 - smoothstep(0.75, 0.98, r));
        vec3 col = sunCol * disc * stripes * 0.62 + vec3(1.0, 0.3, 0.55) * halo;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), mat);
  sun.position.set(0, 18, -270);
  sun.renderOrder = -1;
  return sun;
}

/**
 * A wall of mountains across the horizon: low in the middle so the sun shows through a
 * valley, higher towards the sides. Solid fill with a vertical gradient plus a glowing rim.
 */
function buildRidge(z: number, baseHex: number, rimHex: number, rimStrength: number, scale: number, seed: number) {
  const group = new THREE.Group();
  const N = 120;
  const halfW = 300;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const jag: number[] = [];
  for (let i = 0; i <= N; i++) jag.push(rnd());

  const heights: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = -halfW + (i / N) * halfW * 2;
    const side = Math.min(1, Math.abs(x) / 140);
    const valley = 1 + side * side * 52;
    const wave = Math.sin(x * 0.045 + seed) * 0.5 + Math.sin(x * 0.11 + seed * 2) * 0.3 + 0.8;
    heights.push((valley * (0.7 + 0.3 * wave) + jag[i] * 7 * side) * scale);
  }

  const top = new THREE.Color(baseHex);
  const bottom = SKY.horizon.clone().lerp(top, 0.35);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = -halfW + (i / N) * halfW * 2;
    pos.push(x, heights[i], 0, x, -2, 0);
    col.push(top.r, top.g, top.b, bottom.r, bottom.g, bottom.b);
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  group.add(fill);

  // Rim: a thin ribbon along the ridge line (a real mesh, so it gets MSAA, unlike GL lines).
  const rimPos: number[] = [];
  const rimIdx: number[] = [];
  const thick = 0.7;
  for (let i = 0; i <= N; i++) {
    const x = -halfW + (i / N) * halfW * 2;
    rimPos.push(x, heights[i] + thick * 0.5, 0.1, x, heights[i] - thick * 0.5, 0.1);
    if (i < N) {
      const a = i * 2;
      rimIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const rimGeo = new THREE.BufferGeometry();
  rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rimGeo.setIndex(rimIdx);
  const rimColor = new THREE.Color(rimHex).multiplyScalar(rimStrength);
  group.add(new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: rimColor, fog: false })));

  group.position.z = z;
  return group;
}
