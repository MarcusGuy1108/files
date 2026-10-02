import * as THREE from 'three';

const FONT_FAMILY = "'Orbitron', 'Segoe UI', system-ui, sans-serif";
const all = new Set<TextLabel>();

// Labels drawn before the web font arrives use a fallback face; redraw them once it loads.
document.fonts?.ready.then(() => all.forEach((l) => l.redraw()));

export interface LabelStyle {
  color?: string;
  /** Rounded "pill" background behind the text. */
  bg?: string;
  border?: string;
  weight?: number;
}

/** Text rendered to a canvas texture. Only redraws when the text or colour changes. */
export class TextLabel {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private text = '';
  private color: string;

  constructor(
    width: number,
    height: number,
    private style: LabelStyle = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.color = style.color ?? '#ffffff';
    all.add(this);
  }

  setBorder(color: string): void {
    this.style = { ...this.style, border: color };
    this.redraw();
  }

  set(text: string, color = this.color): void {
    if (text === this.text && color === this.color) return;
    this.text = text;
    this.color = color;
    this.redraw();
  }

  redraw(): void {
    const { ctx, canvas, style } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (style.bg) {
      const pad = h * 0.08;
      const r = (h - pad * 2) / 2;
      ctx.beginPath();
      // roundRect is missing on Safari < 16; a plain rectangle is fine there.
      if (ctx.roundRect) ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
      else ctx.rect(pad, pad, w - pad * 2, h - pad * 2);
      ctx.fillStyle = style.bg;
      ctx.fill();
      if (style.border) {
        ctx.lineWidth = h * 0.06;
        ctx.strokeStyle = style.border;
        ctx.stroke();
      }
    }

    let size = h * 0.62;
    ctx.font = `${style.weight ?? 800} ${size}px ${FONT_FAMILY}`;
    const maxW = w * 0.86;
    const measured = ctx.measureText(this.text).width;
    if (measured > maxW) {
      size *= maxW / measured;
      ctx.font = `${style.weight ?? 800} ${size}px ${FONT_FAMILY}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Dark outline keeps text readable over bright neon and over the fog.
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = 'rgba(8, 0, 20, 0.9)';
    ctx.strokeText(this.text, w / 2, h / 2 + size * 0.04);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, w / 2, h / 2 + size * 0.04);
    this.texture.needsUpdate = true;
  }
}

/** A camera-facing sprite showing a TextLabel, drawn on top of the scene. */
export function labelSprite(label: TextLabel, width: number, height: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: label.texture, depthTest: false, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(width, height, 1);
  s.renderOrder = 10;
  return s;
}
