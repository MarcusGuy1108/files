import { ENEMY_THEMES, SQUAD_COLOURS } from './Looks';

export type UpgradeId = 'squad' | 'power' | 'rate';

export interface SaveData {
  level: number;
  gems: number;
  upgrades: Record<UpgradeId, number>;
  music: boolean;
  sfx: boolean;
  /** Display name shown over your squad in co-op. */
  name: string;
  /** Lives left (each attempt at a level uses one; winning gives it back). */
  lives: number;
  /** When the next free life arrives (ms timestamp), or 0 when lives are full. */
  nextLifeAt: number;
  style: Style;
}

/** The player's look: squad colour, enemy colour theme, and their own drawn character. */
export interface Style {
  squad: number;
  enemies: number;
  /** PNG data URL of the player's drawing, or '' for the standard figure. */
  drawing: string;
}

export const MAX_LIVES = 5;
/** A free life comes back this often. */
export const LIFE_REGEN_MS = 20 * 60 * 1000;
/** Price of one extra life in gems. */
export const LIFE_GEM_COST = 75;

/** Add any free lives that have regenerated since the last check. */
export function refreshLives(save: SaveData, now = Date.now()): void {
  if (save.lives >= MAX_LIVES) {
    save.nextLifeAt = 0;
    return;
  }
  if (!save.nextLifeAt) save.nextLifeAt = now + LIFE_REGEN_MS;
  while (save.lives < MAX_LIVES && now >= save.nextLifeAt) {
    save.lives++;
    save.nextLifeAt += LIFE_REGEN_MS;
  }
  if (save.lives >= MAX_LIVES) save.nextLifeAt = 0;
}

/** Use a life to start a level. Returns false when there are none left. */
export function spendLife(save: SaveData, now = Date.now()): boolean {
  refreshLives(save, now);
  if (save.lives <= 0) return false;
  if (save.lives >= MAX_LIVES) save.nextLifeAt = now + LIFE_REGEN_MS;
  save.lives--;
  return true;
}

/** Give a life back (a won level, a bought life or an ad reward). */
export function addLife(save: SaveData): void {
  save.lives = Math.min(MAX_LIVES, save.lives + 1);
  if (save.lives >= MAX_LIVES) save.nextLifeAt = 0;
}

interface UpgradeDef {
  name: string;
  desc: string;
  baseCost: number;
  max: number;
  value: (lv: number) => number;
  format: (v: number) => string;
}

export const UPGRADE_IDS: UpgradeId[] = ['squad', 'power', 'rate'];

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  squad: {
    name: 'Squad',
    desc: 'Members at the start of a level',
    baseCost: 30,
    max: 40,
    value: (lv) => 5 + 3 * lv,
    format: (v) => String(v),
  },
  power: {
    name: 'Gun power',
    desc: 'Damage of every bullet',
    baseCost: 35,
    max: 40,
    value: (lv) => 1 + 0.3 * lv,
    format: (v) => `×${v.toFixed(1)}`,
  },
  rate: {
    name: 'Fire rate',
    desc: 'Volleys per second',
    baseCost: 35,
    max: 15,
    value: (lv) => 3 + 0.4 * lv,
    format: (v) => `${v.toFixed(1)}/s`,
  },
};

export function upgradeCost(id: UpgradeId, lv: number): number {
  return Math.round(UPGRADES[id].baseCost * Math.pow(1.45, lv));
}

export function upgradeValue(save: SaveData, id: UpgradeId): number {
  return UPGRADES[id].value(save.upgrades[id]);
}

const KEY = 'neon-runner:save:v3';

function fresh(): SaveData {
  return { level: 1, gems: 0, upgrades: { squad: 0, power: 0, rate: 0 }, music: true, sfx: true, name: '', lives: MAX_LIVES, nextLifeAt: 0, style: { squad: 0, enemies: 0, drawing: '' } };
}

// Storage can throw (private mode, blocked site data), so the game must work without it.

export function loadSave(): SaveData {
  const save = fresh();
  try {
    // Older saves (v2) carry over; the new economy simply applies from here on.
    const raw = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem('neon-runner:save:v2') ?? 'null');
    if (raw && typeof raw === 'object') {
      save.level = Math.max(1, Math.floor(Number(raw.level)) || 1);
      save.gems = Math.max(0, Math.floor(Number(raw.gems)) || 0);
      for (const id of UPGRADE_IDS) {
        const lv = Math.floor(Number(raw.upgrades?.[id])) || 0;
        save.upgrades[id] = Math.min(UPGRADES[id].max, Math.max(0, lv));
      }
      if (typeof raw.music === 'boolean') save.music = raw.music;
      if (typeof raw.sfx === 'boolean') save.sfx = raw.sfx;
      if (typeof raw.name === 'string') save.name = cleanName(raw.name);
      if (Number.isFinite(raw.lives)) save.lives = Math.max(0, Math.min(MAX_LIVES, Math.floor(raw.lives)));
      if (Number.isFinite(raw.nextLifeAt)) save.nextLifeAt = Math.max(0, Number(raw.nextLifeAt));
      const st = raw.style;
      if (st && typeof st === 'object') {
        const idx = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);
        save.style.squad = idx(st.squad, SQUAD_COLOURS.length);
        save.style.enemies = idx(st.enemies, ENEMY_THEMES.length);
        if (typeof st.drawing === 'string' && st.drawing.startsWith('data:image/png;base64,') && st.drawing.length < 300_000) {
          save.style.drawing = st.drawing;
        }
      }
    }
  } catch {
    /* start fresh */
  }
  return save;
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export interface PlayerStats {
  start: number;
  power: number;
  rate: number;
}

export function statsOf(save: SaveData): PlayerStats {
  return {
    start: upgradeValue(save, 'squad'),
    power: upgradeValue(save, 'power'),
    rate: upgradeValue(save, 'rate'),
  };
}

/** Names are shown to the other player: letters, digits and a few symbols, 12 chars max. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^\p{L}\p{N} _.!?'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}
