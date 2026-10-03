# Neon Legion: Gem Store Plan (Google Play / App Store)

Status: plan only. Nothing here is built yet. Today gems are earned in play and stored on the device.

## 1. Goals

- **Let players buy gems** inside the iOS and Android apps, using each store's own billing (required for digital goods).
- **Keep a fair free path.** Gems only buy the three permanent upgrades (squad, gun power, fire rate). Everything stays reachable by playing, so buying speeds you up but doesn't lock content away.
- **No random paid rewards.** No loot boxes or gacha. Every purchase gives a known amount, which keeps us clear of odds-disclosure rules and the regions that restrict loot boxes.
- **Make purchases safe.** Bought gems must survive reinstalls and device changes and be refundable correctly. That means the gem balance has to move off the device (see §5).

## 2. What players can buy

Prices use standard store price tiers. The stores convert them to local currencies and handle VAT and sales tax. The bonus % makes bigger packs better value per gem.

| Product | Type | Gems | Price (USD tier) | Bonus |
| --- | --- | ---: | ---: | ---: |
| Handful of Gems | consumable | 120 | 0.99 | — |
| Gem Pouch | consumable | 650 | 4.99 | +8% |
| Gem Chest | consumable | 1,400 | 9.99 | +17% |
| Gem Vault | consumable | 3,000 | 19.99 | +25% |
| Legion Hoard | consumable | 8,000 | 49.99 | +33% |
| Starter Pack (once per account) | non-consumable | 500 + a free Squad upgrade | 1.99 | — |
| Remove Ads (only if ads ship) | non-consumable | — | 2.99 | — |

**How the prices relate to free play:** a cleared level pays about 20–35 gems early on and about 60–140 by level 8. Upgrades start at 30–35 gems and cost 1.45× more each step. So the 0.99 pack is roughly 4–5 early levels of progress, and the Starter Pack about 15 levels. Revisit these numbers with real play data (§7).

Later options, not part of the first release:
- A seasonal **Legion Pass** with a free and a paid track, rewarding gems and cosmetic squad colours.
- **Cosmetics**, such as squad skins, gun trail colours and gate effects. These sell well without affecting balance.

## 3. Free gem sources (for players who don't pay, and to show the store's value)

- **Rewarded ads (optional):** "Watch an ad to double this level's gems", offered on the results screen and capped at about 5 a day. Ads are strictly opt-in, with no forced interstitials during a run.
- **Daily login streak:** 10 / 15 / 20 … gems, resetting after a missed day.
- **Milestones:** one-off gem rewards for first boss kill, level 10, 25, 50, first co-op clear, and so on.
- **In-level gems:** Gem Rush events, crates and enemy drops already do this.

## 4. Store screen

- **Entry point:** a "+" on the gem counter in the menu and upgrade screens opens the Gem Store. Also a link from the upgrade screen when you can't afford something ("Need 23 more gems?").
- **Layout:** pack cards in a grid, each with:
  - a gem pile illustration and the gem amount
  - a bonus ribbon
  - the local price, taken from the store, never hard-coded
  - "Best value" and "Most popular" badges on the Chest and Vault
- **Purchase flow:**
  1. The player taps a pack and the native store sheet opens.
  2. While the purchase completes, the game shows a spinner.
  3. Once the server confirms, the gems animate into the counter.
- **Errors:** cancelled, pending (for example "Ask to Buy" on a family account) and failed purchases each get a clear message. Pending purchases are credited later, when they clear.
- **Restore Purchases:** a button in Settings, which Apple requires for non-consumables (Starter Pack, Remove Ads).
- **Legal footer:** links to the Privacy Policy and Terms.

## 5. Technical plan

### Packaging the game as an app

- Wrap the existing web build with **Capacitor**. It produces real iOS and Android projects around the Three.js game with almost no code changes.
- Plugins needed:
  - billing (below)
  - haptics, for hit feedback
  - status bar and splash
  - Game Center / Play Games sign-in

### Billing

- Use **RevenueCat** through its Capacitor plugin. One API covers both stores. It handles receipt validation and tells our server about purchases, refunds and cancellations through webhooks.
- **Alternative:** `cordova-plugin-purchase` plus our own receipt checks. Cheaper at very high revenue, but much more work and risk.
- **Product setup:** create each product in App Store Connect and the Play Console with the same IDs, for example `gems_120` and `starter_pack`.

### Accounts and a server-side gem wallet (required before taking money)

The gem balance currently lives in browser storage. Anyone can edit it, and it's lost on reinstall. For paid gems:
- **Silent sign-in** with Game Center / Google Play Games, or an anonymous account (for example with Firebase Auth) that can be upgraded later.
- **A small backend** (Firebase or Supabase) stores each player's wallet: gems, upgrade levels, owned products.
- **Crediting purchases:** when RevenueCat's webhook reports a purchase, the server adds the gems. A refund removes them, and the balance can go negative until earned back.
- **Server-checked spending:** upgrades are bought through a server call, so the balance can't be faked.
- **Gameplay stays on the phone.** Gems picked up in levels are reported at the end of the run and capped per level server-side, which stops obvious cheating without needing an always-online game.
- **Offline play:** levels work without a connection, earned gems sync later, and the store needs a connection.

### Co-op

- Co-op is unaffected: each player still brings their own upgrades.
- If leaderboards are added later, the host should check guest stats against the server.

### Web version

- The browser version can keep free play only, or use Stripe for web purchases.
- Inside the iOS and Android apps, digital goods must use store billing. Whether you're allowed to link from the app to a web store differs by country and keeps changing, so check the current Apple and Google rules before adding any link.

## 6. Policy and compliance checklist

- **Apple App Review 3.1.1 and Google Play Payments policy:** gems go through in-app purchase only.
- **Restore Purchases:** a working button for non-consumables.
- **Privacy:** App Privacy labels (Apple) and the Data safety form (Google), covering analytics, the ad SDK and account data. Publish a Privacy Policy URL.
- **Age rating questionnaire:** mild cartoon violence; in-app purchases are disclosed by the stores.
- **Under-13s:** if the game appeals to them, use COPPA / Families Policy–compliant ad and analytics settings, or set the audience to 13+.
- **No random paid rewards**, which avoids loot-box odds disclosure. Any future random rewards must be free, or show their odds.
- **Refunds:** handled by the stores, and our server removes the gems.
- **Prices and tax:** set price tiers per region and let the stores collect VAT and sales tax.

## 7. Measuring and tuning

Track: gems earned per level, gems spent per upgrade, where players fail, store views, purchase conversion, average revenue per paying user, and day 1/7/30 retention. Use these to tune:
- pack sizes and bonus percentages
- upgrade cost growth (currently 1.45×)
- level rewards
- how often the store is suggested, kept gentle

## 8. Phases

| Phase | What | Rough effort |
| --- | --- | --- |
| 0 | Gem Store screen in the web build behind a flag, with fake purchases, for UX testing | 2–3 days |
| 1 | Capacitor iOS and Android builds, icons, splash, store listings, TestFlight and internal testing | 1 week |
| 2 | Accounts and a server-side wallet; move saves to the server; offline sync | 1–2 weeks |
| 3 | RevenueCat in-app purchases, webhooks to the wallet, Restore Purchases, refund handling | 1 week |
| 4 | Rewarded ads, daily streak and milestones (optional) | 1 week |
| 5 | Live tuning, then cosmetics and the Legion Pass | ongoing |

## 9. Decisions needed from you

1. **Ads:** include rewarded ads (and therefore Remove Ads), or keep the game ad-free?
2. **Prices:** confirm the tier ladder above, or set your own.
3. **Backend:** Firebase (fastest to set up) or Supabase (open source, SQL)?
4. **Web version:** stay free-only, or sell gems there too through Stripe?
5. **Publisher accounts:** an Apple Developer account (99 USD a year) and a Google Play Console account (25 USD one-off) are needed. Who will own them, you personally or a company?
