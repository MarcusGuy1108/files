type Screen = 'menu' | 'playing' | 'paused' | 'gameover';

export interface UIHandlers {
  play: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Thin wrapper over the DOM overlay in index.html. */
export class UI {
  private hud = $('hud');
  private screens = {
    menu: $('screen-menu'),
    paused: $('screen-pause'),
    gameover: $('screen-gameover'),
  };
  private hudScore = $('hud-score');
  private hudBest = $('hud-best');
  private menuBest = $('menu-best');
  private goScore = $('go-score');
  private goBest = $('go-best');
  private newBest = $('new-best');
  private lastScore = -1;

  constructor(h: UIHandlers) {
    $('btn-play').addEventListener('click', h.play);
    $('btn-retry').addEventListener('click', h.play);
    $('btn-pause').addEventListener('click', h.pause);
    $('btn-resume').addEventListener('click', h.resume);
    $('btn-quit').addEventListener('click', h.menu);
    $('btn-menu').addEventListener('click', h.menu);
    // Keep taps on overlay buttons from also counting as gameplay taps/swipes.
    for (const b of document.querySelectorAll('#ui button')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  show(screen: Screen): void {
    this.hud.classList.toggle('hidden', screen !== 'playing' && screen !== 'paused');
    this.screens.menu.classList.toggle('hidden', screen !== 'menu');
    this.screens.paused.classList.toggle('hidden', screen !== 'paused');
    this.screens.gameover.classList.toggle('hidden', screen !== 'gameover');
    const focusId = { menu: 'btn-play', paused: 'btn-resume', gameover: 'btn-retry', playing: '' }[screen];
    // Don't pop up the on-screen keyboard focus ring on touch devices.
    if (focusId && !matchMedia('(pointer: coarse)').matches) $(focusId).focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  setScore(score: number): void {
    if (score === this.lastScore) return;
    this.lastScore = score;
    this.hudScore.textContent = String(score);
  }

  setBest(best: number): void {
    this.hudBest.textContent = String(best);
    this.menuBest.textContent = String(best);
  }

  showGameOver(score: number, best: number, isNewBest: boolean): void {
    this.goScore.textContent = String(score);
    this.goBest.textContent = String(best);
    this.newBest.classList.toggle('hidden', !isNewBest);
    this.show('gameover');
  }
}
