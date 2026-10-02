import type { EnemyKind } from './Enemies';
import type { PowerKind } from './Powerups';

/**
 * Everything noteworthy the simulation does. The game turns these into effects, sound,
 * pop-up numbers and gem rewards; in co-op the host also forwards them to the guest,
 * so both screens react identically. `p` is a player index (0 = host / solo, 1 = guest).
 */
export type GameEvent =
  | { k: 'kill'; kind: EnemyKind; x: number; z: number }
  | { k: 'gate'; p: number; v: number }
  | { k: 'hurt'; p: number; loss: number; x: number; z: number; kind: EnemyKind }
  | { k: 'block'; p: number; x: number; z: number }
  | { k: 'gem'; p: number; x: number; z: number }
  | { k: 'power'; p: number; kind: PowerKind }
  | { k: 'shieldbreak'; x: number; z: number }
  | { k: 'boss' }
  | { k: 'arena' }
  | { k: 'bossdown'; x: number; z: number }
  | { k: 'wipe'; p: number }
  | { k: 'reward'; p: number; n: number };
