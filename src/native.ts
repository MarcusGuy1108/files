import { Capacitor } from '@capacitor/core';
import type { Game } from './game/Game';

/** Android app glue: the hardware back button. Does nothing in a browser. */
export async function initNative(game: Game): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (!game.back()) void App.exitApp();
  });
}
