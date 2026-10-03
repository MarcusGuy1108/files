/** Colour schemes that rotate level by level, so long runs keep looking fresh. */
export interface Theme {
  name: string;
  /** Horizon glow (and the default mood colour). */
  glow: number;
  /** Floor grid lines and road edges. */
  line: number;
  edge: number;
  /** Sun gradient, top and bottom. */
  sunTop: number;
  sunBottom: number;
  /** CSS colour for the level banner. */
  css: string;
}

export const THEMES: Theme[] = [
  { name: 'SUNSET STRIP', glow: 0xff3d8b, line: 0xff2bd6, edge: 0x29f0ff, sunTop: 0xffd14d, sunBottom: 0xff2e8c, css: '#ff4fd8' },
  { name: 'ICE CIRCUIT', glow: 0x3dc8ff, line: 0x3d7bff, edge: 0xc8f6ff, sunTop: 0xe8fbff, sunBottom: 0x3d9bff, css: '#5cd2ff' },
  { name: 'TOXIC ZONE', glow: 0x6dff3d, line: 0x2bff88, edge: 0xe7ff3d, sunTop: 0xf6ff6b, sunBottom: 0x2bd66b, css: '#7dff5c' },
  { name: 'INFERNO RUN', glow: 0xff6a1a, line: 0xff3d2b, edge: 0xffd23f, sunTop: 0xfff07a, sunBottom: 0xff3a1a, css: '#ff8a3a' },
  { name: 'THE VOID', glow: 0xb45cff, line: 0x8a2bff, edge: 0xff6bf0, sunTop: 0xffc8ff, sunBottom: 0x8a2bff, css: '#c58bff' },
];

export function themeFor(level: number): Theme {
  return THEMES[(Math.max(1, level) - 1) % THEMES.length];
}
