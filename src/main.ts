// Fonts ship with the game (no Google Fonts request; works offline and in app stores).
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import './style.css';
import { Game } from './game/Game';
import { isWebGLAvailable } from './render/Scene';
import { initNative } from './native';

const canvas = document.getElementById('game') as HTMLCanvasElement;

if (!isWebGLAvailable()) {
  document.getElementById('ui')!.hidden = true;
  document.getElementById('nowebgl')!.hidden = false;
} else {
  const game = new Game(canvas);
  game.start();
  void initNative(game);
  // Handy for debugging and automated tests; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}
