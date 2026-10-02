import './style.css';
import { Game } from './game/Game';
import { isWebGLAvailable } from './render/Scene';

const canvas = document.getElementById('game') as HTMLCanvasElement;

if (!isWebGLAvailable()) {
  document.getElementById('ui')!.hidden = true;
  document.getElementById('nowebgl')!.hidden = false;
} else {
  const game = new Game(canvas);
  game.start();
  // Handy for debugging and automated tests; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}
