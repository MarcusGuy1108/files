# Neon Legion on Google Play: launch guide

The game is wrapped as an Android app with [Capacitor](https://capacitorjs.com). The same web build runs inside the app, and co-op works between app and browser players.

## Progress

- [x] Google Play developer account approved
- [x] Android app project (`android/`), targeting Android 16 (API 36)
- [x] App icon, loading screen, back button, sound pauses when you switch apps
- [x] Automatic signed builds on GitHub (`.github/workflows/android.yml`)
- [x] Privacy policy: https://marcusguy1108.github.io/neontest/privacy.html
- [x] Store images in `store/`: icon, feature graphic, 5 phone screenshots
- [ ] Add the signing password to GitHub (step 1)
- [ ] Create the app in Play Console and fill in the forms (steps 3–4)
- [ ] Internal test on your own phone (step 5)
- [ ] Closed test: 12+ testers for 14 days in a row (step 6)
- [ ] Apply for production access, then publish (step 7)
- [ ] Later: gem purchases and rewarded ads (see `gem-store-plan.md`)

## 1. Add the signing password to GitHub (once)

Every upload to Google Play must be signed with the app's upload key. The key is in the repo at `android/upload-key.p12`, locked with a long random password. Only GitHub knows the password, so only GitHub can sign builds.

1. Open https://github.com/MarcusGuy1108/files/settings/secrets/actions
2. Tap **New repository secret**.
3. Name: `ANDROID_KEYSTORE_PASSWORD`. Value: the password from the chat. Save.
4. Also store the password in a password manager. If it's lost, Google can reset the upload key (Play Console → Test and release → App integrity), so it isn't a disaster, but it's slow.

Upload key SHA-256 fingerprint, which Play Console may show:
`D1:68:B8:42:B7:7B:95:1E:F5:A7:34:EF:DE:4E:35:E8:58:FE:9A:83:0F:62:03:6B:A3:FC:85:8A:A7:03:3C:0F`

## 2. Get the app file (.aab)

Each push to the branch builds a new signed bundle. To start a build by hand, open **Actions → Build Android app → Run workflow**.

1. Open https://github.com/MarcusGuy1108/files/actions/workflows/android.yml
2. Open the latest green run and download the artifact under **Artifacts** (`neon-legion-N`). It's a zip containing `app-release.aab`.
3. Unzip it. Uploading is easiest from a computer.

Each build gets a higher version code (the run number), so Play always accepts the newest one.

## 3. Create the app in Play Console

Go to **Play Console → Create app**:
- App name: **Neon Legion**
- Default language: English (United Kingdom) or (United States)
- App or game: **Game**
- Free or paid: **Free**. Free apps can still sell gems later, but a free app can never be changed to paid.
- Tick the declarations and create the app.

The package name was fixed when the app was created in Play Console: `com.marcusgames.neonlegi`. It can never change, and it must match `applicationId` in `android/app/build.gradle`.

## 4. App content forms (Policy → App content)

These are suggested answers based on what the game does today, with no ads, no purchases and no analytics. You submit them, so check each one.

| Form | Answer |
| --- | --- |
| Privacy policy | `https://marcusguy1108.github.io/neontest/privacy.html` |
| App access | All functionality is available without special access |
| Ads | No, the app doesn't contain ads (update this when ads are added) |
| Content rating | Category: Game. Violence: the player shoots cartoon robots and monsters; no blood, no realistic violence. Answer No to everything else (no sex, drugs, gambling or user-generated content). Players can share a typed name with a friend in co-op, but there's no chat. |
| Target audience | 13 and over. Choosing under-13 brings Families policy rules that restrict ads later. |
| Data safety | Likely **No data collected**. Progress stays on the device. The co-op name and position go straight to a friend's device at the player's request, and the PeerJS connection service only handles the connection briefly. Both appear to fall under Google's exceptions for user-initiated transfers and short-lived processing. Re-check against Google's guidance when you fill it in, and update it when purchases or ads arrive. |
| Government app / financial features / health | No |

### Store listing (Grow users → Store presence → Main store listing)

- **App icon:** `store/icon-512.png`
- **Feature graphic:** `store/feature-graphic.png`
- **Phone screenshots:** `store/screenshot-*.png` (all five)
- **Category:** Action (or Arcade)
- **Short description** (80 characters max):

  > Grow your neon squad, blast through gates and take down the boss. Solo or co-op!

- **Full description:**

  > Lead a glowing squad down a neon highway. Your squad fires on its own: you steer them through the right gates to grow your army, then blast through robots, brutes and barriers to reach the boss.
  >
  > • Pick your gates: +10, ×2… or a trap that takes a chunk of your squad. Shoot a bad gate to change its number.
  > • Smash obstacles: barrels explode, crates drop power-ups, barriers stand in your way.
  > • Power-ups: rapid fire, double damage and shields.
  > • Surprise events: meteor showers, ambushes, gem rushes, stampedes and blackouts.
  > • Beat the boss to clear each level. Levels go on forever and keep getting harder.
  > • Earn gems and upgrade your squad size, gun power and fire rate.
  > • Co-op: play the same level with a friend using a 5-letter session code. You each steer your own squad.
  > • Synthwave visuals and soundtrack, five colour themes.
  >
  > No account needed. Plays offline (co-op needs internet).

## 5. Internal test (your phone first)

1. **Test and release → Testing → Internal testing → Create new release**. Accept **Play App Signing** when asked; Google keeps the final signing key safe.
2. Upload `app-release.aab`, add release notes, then save and roll out.
3. Under **Testers**, make an email list with your own Google account and your co-op partner's. Open the opt-in link on your phones and install from the Play Store.
4. Check: sound, touch steering (sideways and forward/back), the back button, co-op between two phones, and co-op between a phone and the web version.

## 6. Closed test: 12 testers for 14 days

New personal accounts must do this before going public.

1. **Testing → Closed testing → Create track** (or use "Alpha"). Upload the same or a newer `.aab`.
2. Add at least **12 testers** by email, or with a Google Group. Each must open the opt-in link, accept, and install.
3. Keep at least 12 opted in for **14 days in a row**. If you drop below 12, the clock restarts, so recruit 15–20 to be safe.
4. Ask testers to actually play a few times; Google asks about their engagement and feedback.
5. Push fixes during the test as normal: new builds just need uploading to the closed track.

## 7. Production

After the 14 days, Play Console's dashboard shows **Apply for production**. It asks:
- how you recruited testers
- how they used the app
- what feedback you got and changed

Answer honestly and briefly. Review usually takes a few days. After approval, create a production release with the latest `.aab` and roll it out. A staged rollout (for example 20%) is fine.

## Updating the app later

Push changes to the branch, download the new `.aab` from Actions, and upload it as a new release. Updates don't need another 14-day test.

## Building locally (optional)

Needs Node 22, JDK 21 and the Android SDK (platform 36).

```bash
npm ci && npm run build && npx cap sync android
cd android && ANDROID_KEYSTORE_PASSWORD=... VERSION_CODE=1 ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Without the password, `./gradlew assembleDebug` builds an unsigned debug APK for sideloading with `adb install`.

To regenerate icons after changing `resources/`, run `npx @capacitor/assets generate --android --iconBackgroundColor '#140728' --splashBackgroundColor '#140728' --assetPath resources`.
