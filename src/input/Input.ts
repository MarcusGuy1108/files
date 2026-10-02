import type { MoveAction } from '../game/Player';

export type Action = MoveAction | 'pause' | 'confirm';

const SWIPE_MIN_PX = 30;
const TAP_MAX_MS = 300;

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'slide',
  KeyS: 'slide',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
};

/**
 * Maps keyboard, touch and mouse into one stream of actions.
 * Swipes (touch or mouse drag) fire as soon as they pass the threshold, so they feel instant.
 */
export class Input {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private swiped = false;

  constructor(private onAction: (a: Action) => void) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    // Stop long-press menus and double-tap zoom on mobile.
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    // Let buttons handle their own Enter/Space activation.
    if ((action === 'confirm' || e.code === 'Space') && (e.target as HTMLElement)?.closest?.('button')) return;
    e.preventDefault();
    if (e.repeat) return;
    this.onAction(action);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = performance.now();
    this.swiped = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || this.swiped) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    this.swiped = true;
    if (Math.abs(dx) > Math.abs(dy)) this.onAction(dx > 0 ? 'right' : 'left');
    else this.onAction(dy > 0 ? 'slide' : 'jump');
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (!this.swiped && performance.now() - this.startTime < TAP_MAX_MS) this.onAction('confirm');
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };
}
