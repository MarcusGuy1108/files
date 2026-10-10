import type { EnemyKind } from './Enemies';
import type { SquadLook } from './Squad';

/** Squad colours the player can pick from (the first is the default). */
export const SQUAD_COLOURS: { name: string; look: SquadLook }[] = [
  { name: 'Cyan', look: { body: 0x3fd2ff, emissive: 0x062a38, border: '#29f0ff' } },
  { name: 'Lime', look: { body: 0x7dff4f, emissive: 0x0f3306, border: '#9dff6b' } },
  { name: 'Gold', look: { body: 0xffc93a, emissive: 0x3a2604, border: '#ffd23f' } },
  { name: 'Orange', look: { body: 0xff8a2b, emissive: 0x3a1604, border: '#ff9d4a' } },
  { name: 'Red', look: { body: 0xff4a5e, emissive: 0x3a0610, border: '#ff6b7c' } },
  { name: 'Pink', look: { body: 0xff6fd2, emissive: 0x3a0630, border: '#ff8ee0' } },
  { name: 'Violet', look: { body: 0xc58bff, emissive: 0x2a0c40, border: '#c58bff' } },
  { name: 'White', look: { body: 0xf2f4ff, emissive: 0x2a2c3a, border: '#ffffff' } },
];

/** Your partner's squad in co-op when they haven't picked a colour (or picked yours). */
export const PARTNER_DEFAULT = 6;

export function squadLook(index: number): SquadLook {
  return (SQUAD_COLOURS[index] ?? SQUAD_COLOURS[0]).look;
}

/** Enemy colour themes. Obstacles keep their own colours (red barrels must read as explosive). */
export type EnemyColours = Partial<Record<EnemyKind, number>>;

export const ENEMY_THEMES: { name: string; colours: EnemyColours }[] = [
  { name: 'Classic', colours: {} },
  {
    name: 'Toxic',
    colours: { grunt: 0x5dff3b, brute: 0xc6ff1a, dasher: 0x1affb2, bearer: 0x2ee87a, boss: 0x9dff00, skitter: 0xa8ff5a },
  },
  {
    name: 'Frost',
    colours: { grunt: 0x6fd8ff, brute: 0x3a8bff, dasher: 0xb4f0ff, bearer: 0x7a7dff, boss: 0x4d6bff, skitter: 0x9ee7ff },
  },
  {
    name: 'Gold',
    colours: { grunt: 0xffc23a, brute: 0xff9a1a, dasher: 0xffe066, bearer: 0xd9a400, boss: 0xffd700, skitter: 0xffd27a },
  },
  {
    name: 'Ghost',
    colours: { grunt: 0xe8e8f0, brute: 0xb8bccc, dasher: 0xffffff, bearer: 0x9aa3b8, boss: 0xd0d4e0, skitter: 0xf2f2f2 },
  },
  {
    name: 'Candy',
    colours: { grunt: 0xff7ad9, brute: 0xc77dff, dasher: 0xff9ec7, bearer: 0x9b7dff, boss: 0xff4fd8, skitter: 0xffb3e6 },
  },
];

export function enemyTheme(index: number): EnemyColours {
  return (ENEMY_THEMES[index] ?? ENEMY_THEMES[0]).colours;
}
