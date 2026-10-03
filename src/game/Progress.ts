export type UpgradeId = 'squad' | 'power' | 'rate';

export interface SaveData {
  level: number;
  gems: number;
  upgrades: Record<UpgradeId, number>;
  music: boolean;
  sfx: boolean;
  /** Display name shown over your squad in co-op. */
  name: string;
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
  return { level: 1, gems: 0, upgrades: { squad: 0, power: 0, rate: 0 }, music: true, sfx: true, name: '' };
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
