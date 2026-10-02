import { UPGRADES, UPGRADE_IDS, upgradeCost, type SaveData, type UpgradeId } from '../game/Progress';

export type Screen = 'menu' | 'shop' | 'playing' | 'paused' | 'result';

export interface UIHandlers {
  play: () => void;
  next: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
  shop: () => void;
  buy: (id: UpgradeId) => void;
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Thin wrapper over the DOM overlay in index.html. */
export class UI {
  private hud = $('hud');
  private screens: Record<Exclude<Screen, 'playing'>, HTMLElement> = {
    menu: $('screen-menu'),
    shop: $('screen-shop'),
    paused: $('screen-pause'),
    result: $('screen-result'),
  };
  private hudLevel = $('hud-level');
  private hudProgress = $('hud-progress');
  private hudGems = $('hud-gems');
  private bossBar = $('boss-bar');
  private bossFill = $('boss-fill');
  private pops = $('pops');
  private shopList = $('shop-list');
  private lastGems = -1;
  private lastProgress = -1;

  constructor(h: UIHandlers) {
    $('btn-play').addEventListener('click', h.play);
    $('btn-shop').addEventListener('click', h.shop);
    $('btn-shop-back').addEventListener('click', h.menu);
    $('btn-pause').addEventListener('click', h.pause);
    $('btn-resume').addEventListener('click', h.resume);
    $('btn-quit').addEventListener('click', h.menu);
    $('btn-next').addEventListener('click', h.next);
    $('btn-result-shop').addEventListener('click', h.shop);
    $('btn-result-menu').addEventListener('click', h.menu);
    this.shopList.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.btn-buy');
      if (btn && !btn.disabled) h.buy(btn.dataset.id as UpgradeId);
    });
    // Keep presses on overlay buttons from also counting as gameplay taps or drags.
    document.getElementById('ui')!.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.stopPropagation();
    });
  }

  show(screen: Screen): void {
    this.hud.classList.toggle('hidden', screen !== 'playing' && screen !== 'paused');
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('hidden', name !== screen);
    const focusId = { menu: 'btn-play', shop: 'btn-shop-back', paused: 'btn-resume', result: 'btn-next', playing: '' }[
      screen
    ];
    // Skip the focus ring on touch devices.
    if (focusId && !matchMedia('(pointer: coarse)').matches) $(focusId).focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  setMenu(save: SaveData): void {
    $('menu-level').textContent = String(save.level);
    $('menu-gems').textContent = String(save.gems);
  }

  startRun(level: number): void {
    this.hudLevel.textContent = `LEVEL ${level}`;
    this.lastProgress = -1;
    this.setProgress(0);
    this.setBoss(null);
  }

  setProgress(p: number): void {
    const pct = Math.round(Math.min(1, p) * 100);
    if (pct === this.lastProgress) return;
    this.lastProgress = pct;
    this.hudProgress.style.width = `${pct}%`;
  }

  setGems(n: number): void {
    if (n === this.lastGems) return;
    const grew = n > this.lastGems && this.lastGems >= 0;
    this.lastGems = n;
    this.hudGems.textContent = String(n);
    if (grew) {
      const chip = this.hudGems.parentElement!;
      chip.classList.remove('pulse');
      void chip.offsetWidth; // restart the animation
      chip.classList.add('pulse');
    }
  }

  /** Boss health 0..1, or null to hide the bar. */
  setBoss(frac: number | null): void {
    this.bossBar.classList.toggle('hidden', frac === null);
    if (frac !== null) this.bossFill.style.width = `${Math.max(0, frac) * 100}%`;
  }

  /** Floating text at a screen position (CSS pixels). */
  pop(text: string, x: number, y: number, kind: 'good' | 'bad' | 'gem'): void {
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.addEventListener('animationend', () => el.remove());
    this.pops.appendChild(el);
  }

  clearPops(): void {
    this.pops.replaceChildren();
  }

  showResult(won: boolean, level: number, progress: number, gems: number): void {
    $('result-title').textContent = won ? `LEVEL ${level} CLEARED` : 'SQUAD LOST';
    $('result-sub').textContent = won
      ? 'Boss defeated. Spend your gems or push on.'
      : `You made it ${Math.round(progress * 100)}% of the way. Upgrades will help.`;
    $('result-gems').textContent = String(gems);
    $('btn-next').textContent = won ? 'NEXT LEVEL' : 'RETRY';
    this.show('result');
  }

  renderShop(save: SaveData): void {
    $('shop-gems').textContent = String(save.gems);
    this.shopList.replaceChildren(
      ...UPGRADE_IDS.map((id) => {
        const def = UPGRADES[id];
        const lv = save.upgrades[id];
        const maxed = lv >= def.max;
        const cost = upgradeCost(id, lv);
        const now = def.format(def.value(lv));
        const next = def.format(def.value(lv + 1));

        const row = document.createElement('div');
        row.className = 'upgrade';
        row.innerHTML = `
          <div class="up-info">
            <div class="up-name">${def.name}<span class="up-lv">LV ${lv}</span></div>
            <div class="up-desc">${def.desc}</div>
            <div class="up-val">${maxed ? `${now} (max)` : `${now} → <b>${next}</b>`}</div>
          </div>
          <button class="btn-buy" data-id="${id}" aria-label="Buy ${def.name} upgrade" ${
            maxed || save.gems < cost ? 'disabled' : ''
          }>${maxed ? 'MAX' : `<span class="gem-icon"></span>${cost}`}</button>`;
        return row;
      }),
    );
  }
}
