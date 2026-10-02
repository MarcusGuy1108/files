const BEST_KEY = 'neon-runner:best';

// Storage can throw (private mode, blocked site data), so the game must work without it.

export function loadBest(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* ignore */
  }
}
