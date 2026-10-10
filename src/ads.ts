/**
 * Rewarded ads ("watch an ad for a life"). Not wired up yet: ads need AdMob in the
 * Android app, which can only be approved once the app is live on Google Play.
 * Until then `rewardedReady()` is false and the button shows as coming soon.
 */
export function rewardedReady(): boolean {
  return false;
}

/** Show a rewarded ad. Resolves true only if the player watched it to the end. */
export async function showRewarded(): Promise<boolean> {
  return false;
}
