/** Colours on the drawing palette (the last button is the eraser). */
const PALETTE = [
  '#ffffff',
  '#111018',
  '#29f0ff',
  '#3d7bff',
  '#7dff4f',
  '#ffd23f',
  '#ff8a2b',
  '#ff3b4e',
  '#ff6fd2',
  '#b45cff',
  '#8a5a3c',
  '#ffc9a3',
];
const SIZES = [6, 14, 26];
const UNDO_LIMIT = 25;
/** Size of the saved image (it's drawn small on screen, so this is plenty). */
const OUT_SIZE = 128;

/**
 * A small paint editor for the player's own squad member: brush, colours, eraser,
 * sizes, undo and clear. Saves a transparent PNG data URL, or '' for a blank canvas.
 */
export class DrawEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colour = PALETTE[2];
  private erase = false;
  private size = SIZES[1];
  private undo: ImageData[] = [];
  private last: { x: number; y: number } | null = null;
  private pointer: number | null = null;

  constructor() {
    this.canvas = document.getElementById('draw-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    const palette = document.getElementById('draw-palette')!;
    const swatches = [...PALETTE, 'eraser'].map((c) => {
      const b = document.createElement('button');
      b.className = c === 'eraser' ? 'swatch eraser' : 'swatch';
      if (c !== 'eraser') b.style.setProperty('--sw', c);
      b.setAttribute('aria-label', c === 'eraser' ? 'Eraser' : `Colour ${c}`);
      b.addEventListener('click', () => {
        this.erase = c === 'eraser';
        if (!this.erase) this.colour = c;
        for (const s of swatches) s.setAttribute('aria-checked', String(s === b));
      });
      palette.append(b);
      return b;
    });
    swatches[2].setAttribute('aria-checked', 'true');

    const sizes = document.getElementById('draw-sizes')!;
    const sizeBtns = SIZES.map((px, k) => {
      const b = document.createElement('button');
      b.setAttribute('aria-label', ['Small brush', 'Medium brush', 'Big brush'][k]);
      b.innerHTML = `<i style="width:${6 + k * 6}px;height:${6 + k * 6}px"></i>`;
      b.addEventListener('click', () => {
        this.size = px;
        for (const s of sizeBtns) s.setAttribute('aria-pressed', String(s === b));
      });
      sizes.append(b);
      return b;
    });
    sizeBtns[1].setAttribute('aria-pressed', 'true');

    document.getElementById('btn-draw-undo')!.addEventListener('click', () => {
      const prev = this.undo.pop();
      if (prev) this.ctx.putImageData(prev, 0, 0);
    });
    document.getElementById('btn-draw-clear')!.addEventListener('click', () => {
      this.snapshot();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    });

    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.up);
  }

  /** Start editing, from an existing drawing ('' for a blank canvas). */
  async open(existing: string): Promise<void> {
    this.undo = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!existing) return;
    const img = new Image();
    img.src = existing;
    try {
      await img.decode();
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    } catch {
      /* unreadable: start blank */
    }
  }

  /** The drawing as a small PNG data URL, or '' if nothing was drawn. */
  export(): string {
    const { width, height } = this.canvas;
    const data = this.ctx.getImageData(0, 0, width, height).data;
    let any = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 20) {
        any = true;
        break;
      }
    }
    if (!any) return '';
    const out = document.createElement('canvas');
    out.width = out.height = OUT_SIZE;
    const o = out.getContext('2d')!;
    o.imageSmoothingQuality = 'high';
    o.drawImage(this.canvas, 0, 0, OUT_SIZE, OUT_SIZE);
    return out.toDataURL('image/png');
  }

  private snapshot(): void {
    this.undo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
  }

  private toCanvas(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  private down = (e: PointerEvent) => {
    if (this.pointer !== null) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.snapshot();
    this.last = this.toCanvas(e);
    this.stroke(this.last, this.last);
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer || !this.last) return;
    const p = this.toCanvas(e);
    this.stroke(this.last, p);
    this.last = p;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.last = null;
  };

  private stroke(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const c = this.ctx;
    c.globalCompositeOperation = this.erase ? 'destination-out' : 'source-over';
    c.strokeStyle = this.colour;
    c.lineWidth = this.size;
    c.lineCap = c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(a.x, a.y);
    // A dot when the pointer hasn't moved.
    c.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y);
    c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
}
