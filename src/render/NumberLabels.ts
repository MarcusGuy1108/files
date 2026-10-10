import * as THREE from 'three';

const FONT_FAMILY = "'Lilita One', 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
/** Every character enemy numbers use ("12.3K", "4M"…). */
const GLYPHS = '0123456789.KM';
const CELL_W = 64;
const CELL_H = 80;
/** Font size inside a cell; the rest is room for the outline. */
const FONT_PX = 60;
const MAX = 2048;

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aOffset;
attribute float aSize;
attribute float aGlyph;
attribute vec3 aColor;
uniform float uCells;
uniform float uCellAspect;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  // Camera-facing quad: offset in view space so every character lines up on screen.
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  mv.xy += vec2((position.x * uCellAspect + aOffset) * aSize, position.y * aSize);
  gl_Position = projectionMatrix * mv;
  vUv = vec2((aGlyph + uv.x) / uCells, uv.y);
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.02) discard;
  // The atlas is white text with a dark outline, so tinting keeps the outline dark.
  gl_FragColor = vec4(t.rgb * vColor, t.a);
  #include <colorspace_fragment>
}`;

/**
 * Health numbers over every enemy, drawn as one batch of camera-facing characters from a
 * small glyph atlas. Replaces one canvas texture and one draw call per enemy, which got
 * expensive with big swarms (and re-uploaded a texture on every hit).
 */
export class NumberLabels {
  private atlas: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  /** Advance width of each glyph, as a fraction of the cell height. */
  private advance = new Float32Array(GLYPHS.length);
  private glyphIndex = new Map<string, number>();
  private geo: THREE.InstancedBufferGeometry;
  private center = new Float32Array(MAX * 3);
  private offset = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private glyph = new Float32Array(MAX);
  private color = new Float32Array(MAX * 3);
  private attrs: THREE.InstancedBufferAttribute[];
  private n = 0;
  readonly mesh: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    this.canvas.width = CELL_W * GLYPHS.length;
    this.canvas.height = CELL_H;
    this.atlas = new THREE.CanvasTexture(this.canvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = THREE.LinearFilter;
    [...GLYPHS].forEach((c, i) => this.glyphIndex.set(c, i));
    this.drawAtlas();
    // Glyphs drawn before the web font arrives use a fallback face; redraw once it loads.
    document.fonts?.ready.then(() => this.drawAtlas());

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = (name: string, arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [
      mk('aCenter', this.center, 3),
      mk('aOffset', this.offset, 1),
      mk('aSize', this.size, 1),
      mk('aGlyph', this.glyph, 1),
      mk('aColor', this.color, 3),
    ];
    this.geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAtlas: { value: this.atlas },
        uCells: { value: GLYPHS.length },
        uCellAspect: { value: CELL_W / CELL_H },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    parent.add(this.mesh);
  }

  private drawAtlas(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = `400 ${FONT_PX}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = FONT_PX * 0.18;
    ctx.strokeStyle = 'rgba(8, 0, 20, 0.9)';
    ctx.fillStyle = '#ffffff';
    [...GLYPHS].forEach((c, i) => {
      const x = i * CELL_W + CELL_W / 2;
      const y = CELL_H / 2 + FONT_PX * 0.04;
      ctx.strokeText(c, x, y);
      ctx.fillText(c, x, y);
      // Characters sit a little closer than their full outline width.
      this.advance[i] = (ctx.measureText(c).width + FONT_PX * 0.08) / CELL_H;
    });
    this.atlas.needsUpdate = true;
  }

  /** Start a new frame of labels. */
  begin(): void {
    this.n = 0;
  }

  /**
   * Add a label centred at (x, y, z). `height` is the text height in world units; it shrinks
   * to fit `maxWidth`. `rgb` tints the white text.
   */
  add(text: string, x: number, y: number, z: number, height: number, maxWidth: number, rgb: number): void {
    let width = 0;
    for (let i = 0; i < text.length; i++) width += this.advance[this.glyphIndex.get(text[i]) ?? 0];
    // Cell height includes room for the outline: scale so the text itself is `height` tall.
    let cell = height * (CELL_H / FONT_PX);
    if (width * cell > maxWidth) cell = maxWidth / width;
    const r = ((rgb >> 16) & 255) / 255;
    const g = ((rgb >> 8) & 255) / 255;
    const b = (rgb & 255) / 255;
    let pen = -width / 2;
    for (let i = 0; i < text.length && this.n < MAX; i++) {
      const gi = this.glyphIndex.get(text[i]);
      if (gi === undefined) continue;
      const k = this.n++;
      const adv = this.advance[gi];
      this.center[k * 3] = x;
      this.center[k * 3 + 1] = y;
      this.center[k * 3 + 2] = z;
      // Offset of the character's centre from the label's centre, in cell heights.
      this.offset[k] = pen + adv / 2;
      this.size[k] = cell;
      this.glyph[k] = gi;
      this.color[k * 3] = r;
      this.color[k * 3 + 1] = g;
      this.color[k * 3 + 2] = b;
      pen += adv;
    }
  }

  /** Upload this frame's labels. */
  end(): void {
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
