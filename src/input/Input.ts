export type Action = 'pause' | 'confirm';

const TAP_MAX_PX = 12;
const TAP_MAX_MS = 300;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);

/**
 * Steering from a drag anywhere on screen (touch or mouse) or held arrow / A-D keys,
 * plus discrete actions (pause, confirm).
 */
export class Input {
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private dragPy = 0;
  private moved = 0;
  private startTime = 0;
  private dragPx = 0;
  private held = new Set<string>();

  constructor(private onAction: (a: Action) => void) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Horizontal drag in CSS pixels since the last call. */
  consumeDrag(): number {
    const d = this.dragPx;
    this.dragPx = 0;
    return d;
  }

  /** Vertical drag in CSS pixels since the last call (positive = down the screen). */
  consumeDragY(): number {
    const d = this.dragPy;
    this.dragPy = 0;
    return d;
  }

  /** -1 (forward / up) .. 1 (back / down) from held keys. */
  get keyAxisY(): number {
    let a = 0;
    for (const c of this.held) {
      if (UP.has(c)) a -= 1;
      if (DOWN.has(c)) a += 1;
    }
    return Math.max(-1, Math.min(1, a));
  }

  /** -1 (left) .. 1 (right) from held keys. */
  get keyAxis(): number {
    let a = 0;
    for (const c of this.held) {
      if (LEFT.has(c)) a -= 1;
      if (RIGHT.has(c)) a += 1;
    }
    return Math.max(-1, Math.min(1, a));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (LEFT.has(e.code) || RIGHT.has(e.code) || UP.has(e.code) || DOWN.has(e.code)) {
      e.preventDefault();
      this.held.add(e.code);
      return;
    }
    const onButton = !!(e.target as HTMLElement)?.closest?.('button');
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      if (!e.repeat) this.onAction('pause');
    } else if ((e.code === 'Enter' || e.code === 'Space') && !onButton) {
      // Buttons handle their own Enter/Space activation.
      e.preventDefault();
      if (!e.repeat) this.onAction('confirm');
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
    this.startTime = performance.now();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dragPx += dx;
    this.dragPy += dy;
    this.moved += Math.abs(dx) + Math.abs(dy);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.moved < TAP_MAX_PX && performance.now() - this.startTime < TAP_MAX_MS) this.onAction('confirm');
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };
}
