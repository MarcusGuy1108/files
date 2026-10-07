# Neon Legion

A synthwave 3D squad shooter-runner for one or two players. It runs in any modern browser, on phones, tablets and desktops.
Built with [Three.js](https://threejs.org/), TypeScript and Vite. All geometry is generated in code, so there are no assets to load.

## Play

Lead a neon squad down the track. Your squad fires on its own; you steer.

| Action          | Keyboard          | Touch / mouse              |
| --------------- | ----------------- | -------------------------- |
| Steer           | ← → or A D (hold) | Drag left / right anywhere |
| Forward / back  | ↑ ↓ or W S (hold) | Drag up / down anywhere |
| Pause / menu    | Esc or P          | Pause button               |
| Start / retry   | Enter or Space    | Tap                        |

- **Gates:** walk through a green **+N** gate to add members; a red **−N** gate removes them. Shooting a gate raises its number, so a red gate can turn green. From level 2, red **−%** gates take a share of your squad; shooting them shrinks the loss.
- **Big squads face tougher enemies:** once your squad is bigger than expected for the level, enemy, obstacle and boss health scale up to match, so a huge squad still has a fight.
- **Safe start:** each level opens with a 3-second shield, a gap before the first wave, and two lighter waves (no brutes or shield bearers) while your squad grows.
- **New layout every attempt:** levels are laid out fresh each time you play, so you can't memorise them.
- **Swarms:** from level 2, every wave is followed by a pack of weak grunts.
- **No one-shots:** a single enemy can take at most half of a big squad (over 120 members).
- **Enemies:** the number over each enemy is its health. If one reaches your squad, you lose that many members.
  - **Grunts** (red) and **brutes** (orange) walk straight at you.
  - **Dashers** (purple, from level 3) are fast and home in on your squad.
  - **Shield bearers** (blue, from level 4) carry a shield with its own number. It soaks up bullets and protects the enemies behind it until it breaks.
- **Power-ups:** walk through one to pick it up. **Rapid fire** doubles your fire rate and **double damage** doubles your damage, each for 6 s. **Shield** stops enemies and meteors taking members for 15 s.
- **Boss:** every level ends with one. Beat it to unlock the next level. Every few seconds it roars, summoning minions and, from level 3, hurling rocks at each squad (dodge the rings). If it reaches you, it trades its health for your members.
- **Gems:** enemies sometimes drop gems that you must walk over to collect. There are also gems on the track, and a bonus for beating the boss and clearing the level. You keep the gems you picked up even if your squad is wiped out.
- **Upgrades:** spend gems on starting **squad size**, **gun power** and **fire rate**. Prices rise with each level you buy.
- **Sound:** synthwave music and sound effects, all generated in the browser. You can switch music and sound effects off from the menu or the pause screen.

### What's on the track

- **Obstacles** block the way and have health numbers. Shoot them down or steer around them. If you run into one, you lose that many members.
  - **Explosive barrels** blow up when destroyed and damage everything nearby, setting off chain reactions.
  - **Tyre stacks** take a lot of shooting to clear.
  - **Supply crates** drop gems and sometimes a power-up.
  - **Concrete barriers** cover two-thirds of the road.
- **Events** are announced mid-level with a banner. Each one unlocks at a certain level, and the number of events per level rises from 1 to 3:
  - **Gem Rush:** a trail of gems.
  - **Ambush:** enemies drop in right in front of you.
  - **Stampede:** a wide charge of weak grunts.
  - **Meteor Shower:** dodge the red target rings. Only members inside a ring are hit, and the squad loses that share of its members (up to 20% per meteor).
  - **Double Up:** a ×2 gate opposite a negative one.
  - **Overdrive:** faster running and firing.
  - **Blackout:** the lights go out and you watch for glowing eyes.
- **Endless levels:** there's no last level. Enemy health, gate values, bosses and boss minions all grow steadily, and each level cycles through five colour themes (Sunset Strip, Ice Circuit, Toxic Zone, Inferno Run, The Void).

See [docs/gem-store-plan.md](docs/gem-store-plan.md) for the plan to sell gems on Google Play and the App Store.

### Android app

The game is also packaged as an Android app with Capacitor (`android/`). GitHub Actions builds a signed `.aab` for Google Play on every push. See [docs/android-launch.md](docs/android-launch.md) for the Play Store launch steps.

### Co-op

Two players, two squads, one level. Each player steers their own squad and uses their own upgrades. You fight the same enemies, gates and boss together, and the level is cleared for both of you.

1. One player taps **CO-OP → HOST A GAME** and gets a 5-character session code.
2. The other taps **CO-OP**, enters the code and taps **JOIN**.

Enter a name on the co-op screen to show it above your squad, with "(you)" on your own.
3. The host taps **START**. After each level, the host's **NEXT LEVEL** brings both players into the next one.

If one squad is wiped out, that player watches until the level ends. In co-op the game can't be paused, because the other player is still playing.

How the two browsers connect depends on where the game is running:

- **On the claude.ai link**, it uses claude.ai's real-time rooms. Both players need to be signed in, and the owner has to share the page with the friend from its **Share** menu.
- **Anywhere else**, it uses a direct WebRTC connection set up through the free public [PeerJS](https://peerjs.com) server. Examples are GitHub Pages or `npm run dev` on your network. No account is needed. Very strict networks (some corporate or school Wi-Fi) can block direct connections.

The host runs the game, and the guest's screen mirrors it about 20 times a second.

## Develop

```bash
npm install
npm run dev       # dev server (also on your LAN, so you can open it on a phone)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

The build uses relative paths, so you can host the `dist/` folder anywhere static.

### Publishing the web version

The source repo is private. `.github/workflows/publish-web.yml` builds the game on every push and copies only the finished files to the public repo `MarcusGuy1108/neontest`, which serves the game at https://marcusguy1108.github.io/neontest/. It needs the `PAGES_DEPLOY_KEY` secret here, and the matching public key added as a deploy key with write access on `neontest`.

### Testing co-op on one computer

Open two tabs at `http://localhost:5173/?net=local`. This version connects tabs of the same browser directly, with no network involved. Host in one tab and join in the other.

## Code map

```
src/main.ts             bootstrap + WebGL check
src/game/Game.ts        screens, input, camera, audio, co-op session; drives Sim (solo/host) or Replica (guest)
src/game/Sim.ts         the game rules: scrolling, spawning, firing, shields, contacts, pickups, boss, rewards
src/game/Replica.ts     co-op guest: mirrors host snapshots with smoothing and cosmetic bullets
src/game/World.ts       everything on the track, plus the two players
src/game/events.ts      events the rules emit (kills, gates, gems…) → effects, sound, rewards, network
src/game/Level.ts       random level layout (waves, rushes, gates, gems, power-ups) + difficulty per level
src/game/Squad.ts       a squad: formation, steering, count label, shield bubble
src/game/Enemies.ts     grunts, brutes, dashers, shield bearers and the boss
src/game/Gates.ts       +N / −N gates that rise when shot
src/game/Powerups.ts    rapid fire, double damage, shield pickups
src/game/Gems.ts        gem pickups
src/game/Bullets.ts     pooled bullets (one instanced draw)
src/game/Effects.ts     hit / kill particles
src/game/Progress.ts    saved level, gems, upgrades and sound settings; upgrade costs
src/game/Track.ts       scrolling floor grid + roadside pillars
src/net/Channel.ts      co-op transports: claude.ai room, PeerJS (WebRTC), BroadcastChannel (dev)
src/net/protocol.ts     host/guest messages, compact snapshots and event encoding
src/audio/Audio.ts      Web Audio synth: sound effects + synthwave music sequencer
src/render/Scene.ts     camera, lights, bloom, adaptive quality
src/render/Backdrop.ts  sky dome with stars, striped sun, mountain ridges
src/render/Label.ts     canvas-texture text for in-world numbers
src/input/Input.ts      drag + held keys → steering; pause / confirm
src/ui/UI.ts            DOM overlay: HUD, menus, co-op lobby, upgrade shop, results
```

## Performance notes

- Pixel ratio is capped at 2. If frames are consistently slow, the game first turns off bloom and then lowers the resolution.
- Enemies, gates, bullets, gems and particles come from pre-allocated pools, so nothing is allocated during a run.
- Gameplay runs at a fixed 120 Hz step, so it plays the same on 30, 60 and 120 Hz screens.
