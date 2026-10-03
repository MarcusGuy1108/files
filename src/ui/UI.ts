import { UPGRADES, UPGRADE_IDS, upgradeCost, type SaveData, type UpgradeId } from '../game/Progress';
import { POWER_KINDS, POWER_SPECS, type PowerKind } from '../game/Powerups';
import { splashArt } from './splashArt';

export type Screen = 'menu' | 'shop' | 'coop' | 'playing' | 'paused' | 'result';

export interface UIHandlers {
  play: () => void;
  next: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
  shop: () => void;
  buy: (id: UpgradeId) => void;
  coop: () => void;
  host: () => void;
  join: (code: string) => void;
  startCoop: () => void;
  toggleMusic: () => void;
  toggleSfx: () => void;
  /** The splash screen was dismissed (a user gesture: safe to start audio). */
  splashDone: () => void;
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Icon and colours for each upgrade card. */
const SHOP_LOOK: Record<UpgradeId, { c1: string; c2: string; icon: string }> = {
  squad: {
    c1: '#5fdcff',
    c2: '#1f84ff',
    icon: '<svg viewBox="0 0 24 24"><use href="#i-users" /></svg>',
  },
  power: {
    c1: '#ff9a7a',
    c2: '#e0303a',
    icon: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>',
  },
  rate: {
    c1: '#ffe14d',
    c2: '#ff9d1c',
    icon: '<svg viewBox="0 0 24 24"><path d="M3 5l7 7-7 7zM12 5l7 7-7 7z" /></svg>',
  },
};

/** Thin wrapper over the DOM overlay in index.html. */
export class UI {
  private hud = $('hud');
  private screens: Record<Exclude<Screen, 'playing'>, HTMLElement> = {
    menu: $('screen-menu'),
    shop: $('screen-shop'),
    coop: $('screen-coop'),
    paused: $('screen-pause'),
    result: $('screen-result'),
  };
  private hudLevel = $('hud-level');
  private hudProgress = $('hud-progress');
  private hudGems = $('hud-gems');
  private hudPowers = $('hud-powers');
  private bossBar = $('boss-bar');
  private bossFill = $('boss-fill');
  private pops = $('pops');
  private shopList = $('shop-list');
  private toastEl = $('toast');
  private toastTimer = 0;
  private lastGems = -1;
  private lastProgress = -1;
  private lastPowers = '';
  /** True until the player taps through the splash screen. */
  splashActive = true;

  constructor(h: UIHandlers) {
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
    on('btn-play', h.play);
    on('btn-coop', h.coop);
    on('btn-shop', h.shop);
    on('btn-shop-back', h.menu);
    on('btn-pause', h.pause);
    on('btn-resume', h.resume);
    on('btn-quit', h.menu);
    on('btn-next', h.next);
    on('btn-result-shop', h.shop);
    on('btn-result-menu', h.menu);
    on('btn-host', h.host);
    on('btn-coop-start', h.startCoop);
    on('btn-coop-back', h.menu);
    on('btn-copy', () => this.copyCode());
    $('join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      h.join($<HTMLInputElement>('join-code').value);
    });
    for (const b of document.querySelectorAll('.tgl-music')) b.addEventListener('click', h.toggleMusic);
    for (const b of document.querySelectorAll('.tgl-sfx')) b.addEventListener('click', h.toggleSfx);
    this.shopList.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.btn-buy');
      if (btn && !btn.disabled) h.buy(btn.dataset.id as UpgradeId);
    });
    // Keep presses on overlay controls from also counting as gameplay taps or drags.
    $('ui').addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, form, #splash')) e.stopPropagation();
    });

    // Splash: art sized to the screen; tap anywhere (or press a key) to continue.
    const splash = $('splash');
    const drawArt = () => {
      if (this.splashActive) $('splash-art').innerHTML = splashArt(window.innerWidth, window.innerHeight);
    };
    drawArt();
    window.addEventListener('resize', drawArt);
    const leave = () => {
      if (!this.splashActive) return;
      this.splashActive = false;
      splash.classList.add('leaving');
      splash.addEventListener('animationend', () => splash.classList.add('hidden'), { once: true });
      h.splashDone();
    };
    splash.addEventListener('click', leave);
    window.addEventListener('keydown', (e) => {
      if (this.splashActive && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        leave();
      }
    });
  }

  show(screen: Screen): void {
    this.hud.classList.toggle('hidden', screen !== 'playing' && screen !== 'paused');
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('hidden', name !== screen);
    const focusId = {
      menu: 'btn-play',
      shop: 'btn-shop-back',
      coop: '',
      paused: 'btn-resume',
      result: 'btn-next',
      playing: '',
    }[screen];
    // Skip the focus ring on touch devices.
    const el = focusId ? document.getElementById(focusId) : null;
    if (el && !el.closest('.hidden') && !matchMedia('(pointer: coarse)').matches) el.focus({ preventScroll: true });
    else if (screen === 'playing') (document.activeElement as HTMLElement | null)?.blur?.();
  }

  setMenu(save: SaveData, themeName: string): void {
    $('menu-level').textContent = String(save.level);
    $('menu-theme').textContent = themeName;
    $('menu-gems').textContent = String(save.gems);
    this.setToggles(save.music, save.sfx);
  }

  setToggles(music: boolean, sfx: boolean): void {
    for (const b of document.querySelectorAll('.tgl-music')) b.setAttribute('aria-pressed', String(music));
    for (const b of document.querySelectorAll('.tgl-sfx')) b.setAttribute('aria-pressed', String(sfx));
  }

  startRun(level: number): void {
    this.hudLevel.textContent = `LEVEL ${level}`;
    this.lastProgress = -1;
    this.lastPowers = '';
    this.hudPowers.replaceChildren();
    this.setProgress(0);
    this.setBoss(null);
    this.setSpectating(false);
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

  /** Active power-ups with their remaining time. */
  setPowers(pw: Record<PowerKind, number>): void {
    const key = POWER_KINDS.map((k) => (pw[k] > 0 ? Math.ceil(pw[k] * 4) : 0)).join(',');
    if (key === this.lastPowers) return;
    this.lastPowers = key;
    this.hudPowers.replaceChildren(
      ...POWER_KINDS.filter((k) => pw[k] > 0).map((k) => {
        const spec = POWER_SPECS[k];
        const chip = document.createElement('span');
        chip.className = 'power-chip';
        chip.style.color = spec.css;
        chip.textContent = spec.short;
        const meter = document.createElement('span');
        meter.className = 'meter';
        const fill = document.createElement('i');
        fill.style.width = `${Math.min(100, (pw[k] / spec.duration) * 100)}%`;
        meter.appendChild(fill);
        chip.appendChild(meter);
        return chip;
      }),
    );
  }

  setSpectating(on: boolean): void {
    $('spectate').classList.toggle('hidden', !on);
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

  /** Big centred announcement (events, boss). Restarts its animation each time. */
  banner(title: string, sub: string, color: string): void {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.style.setProperty('--banner', color);
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  hideBanner(): void {
    $('banner').classList.add('hidden');
  }

  toast(message: string, ms = 3500): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  /** In co-op the pause menu doesn't stop the game; say so. */
  showPause(coop: boolean): void {
    $('pause-title').textContent = coop ? 'MENU' : 'PAUSED';
    $('pause-note').classList.toggle('hidden', !coop);
    $('btn-quit').textContent = coop ? 'LEAVE GAME' : 'MAIN MENU';
    this.show('paused');
  }

  /** `coop`: null in solo, otherwise this player's role. */
  showResult(won: boolean, level: number, progress: number, gems: number, coop: 'host' | 'guest' | null): void {
    const title = $('result-title');
    title.textContent = won ? `LEVEL ${level} CLEARED!` : coop ? 'SQUADS LOST' : 'SQUAD LOST';
    title.classList.toggle('won', won);
    title.classList.toggle('lost', !won);
    $('result-sub').textContent = won
      ? 'Boss defeated. Spend your gems or push on.'
      : `You made it ${Math.round(progress * 100)}% of the way. Upgrades will help.`;
    $('result-gems').textContent = String(gems);
    const next = $('btn-next');
    next.textContent = won ? 'NEXT LEVEL' : 'RETRY';
    next.classList.toggle('hidden', coop === 'guest');
    $('result-wait').classList.toggle('hidden', coop !== 'guest');
    $('btn-result-menu').textContent = coop ? 'LEAVE GAME' : 'MAIN MENU';
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

        const look = SHOP_LOOK[id];
        const filled = Math.round((lv / def.max) * 10);
        const row = document.createElement('div');
        row.className = 'upgrade';
        row.innerHTML = `
          <div class="up-icon" style="--c1:${look.c1};--c2:${look.c2}">${look.icon}</div>
          <div class="up-info">
            <div class="up-name">${def.name} <span class="up-lv">LV ${lv}</span></div>
            <div class="pips">${Array.from({ length: 10 }, (_, k) => `<i class="${k < filled ? 'on' : ''}"></i>`).join('')}</div>
            <div class="up-val">${maxed ? `${now} · max` : `${now} → <b>${next}</b>`}</div>
          </div>
          <button class="btn btn-green btn-buy" data-id="${id}" aria-label="Buy ${def.name} upgrade" ${
            maxed || save.gems < cost ? 'disabled' : ''
          }>${maxed ? 'MAX' : `<svg class="gem-icon"><use href="#i-gem" /></svg>${cost}`}</button>`;
        return row;
      }),
    );
  }

  // ---------- Co-op screen ----------

  showCoop(note: string): void {
    $('coop-choose').classList.remove('hidden');
    $('coop-session').classList.add('hidden');
    $('coop-error').classList.add('hidden');
    $('coop-note').textContent = note;
    this.setCoopBusy(false);
    this.show('coop');
  }

  setCoopBusy(busy: boolean, label?: string): void {
    const host = $<HTMLButtonElement>('btn-host');
    const join = $<HTMLButtonElement>('btn-join');
    host.disabled = join.disabled = busy;
    host.textContent = busy && label === 'host' ? 'CONNECTING…' : 'HOST A GAME';
    join.textContent = busy && label === 'join' ? '…' : 'JOIN';
  }

  coopError(message: string, link?: string): void {
    const el = $('coop-error');
    el.replaceChildren(document.createTextNode(message));
    if (link) {
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = link.replace(/^https:\/\//, '');
      el.append(' ', a);
    }
    el.classList.remove('hidden');
  }


  /** The session panel: the code, who's here, and (for the host) the start button. */
  coopSession(code: string, role: 'host' | 'guest', partner: boolean, level: number): void {
    $('coop-choose').classList.add('hidden');
    $('coop-error').classList.add('hidden');
    $('coop-session').classList.remove('hidden');
    $('coop-code').textContent = code;
    $('coop-level').textContent = String(level);
    const start = $<HTMLButtonElement>('btn-coop-start');
    start.classList.toggle('hidden', role !== 'host');
    start.disabled = !partner;
    $('coop-status').textContent =
      role === 'host'
        ? partner
          ? 'Your friend is here. Start when you are both ready.'
          : 'Waiting for your friend to join with this code…'
        : 'Connected. Waiting for the host to start the level…';
    $('btn-coop-back').textContent = 'LEAVE';
  }

  resetCoopBack(): void {
    $('btn-coop-back').textContent = 'BACK';
  }

  private copyCode(): void {
    const code = $('coop-code').textContent ?? '';
    navigator.clipboard?.writeText(code).then(
      () => this.toast('Code copied'),
      () => {
        const range = document.createRange();
        range.selectNodeContents($('coop-code'));
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      },
    );
  }
}
