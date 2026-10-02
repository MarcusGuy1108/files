# Neon Runner

A synthwave 3D squad shooter-runner that runs in any modern browser: phones, tablets and desktops.
Built with [Three.js](https://threejs.org/), TypeScript and Vite. All geometry is generated in code, so there are no assets to load.

## Play

Lead a neon squad down the track. Your squad fires on its own, and you steer.

| Action          | Keyboard          | Touch / mouse              |
| --------------- | ----------------- | -------------------------- |
| Steer           | ← → or A D (hold) | Drag left / right anywhere |
| Pause           | Esc or P          | Pause button               |
| Start / retry   | Enter or Space    | Tap                        |

- **Gates:** walking through a green **+N** gate adds members and a red **−N** gate removes them. Shooting a gate raises its number, so a red gate can turn green.
- **Enemies:** the number over each enemy is its health. If one reaches your squad, you lose that many members.
- **Firepower:** every member fires, so a bigger squad hits harder.
- **Boss:** every level ends with one. Beat it to unlock the next level. If it reaches you, you need more members than its remaining health to survive.
- **Gems:** earned from kills, pickups on the track, and clearing levels. You keep the gems you collected even if your squad is wiped out.
- **Upgrades:** spend gems on starting **squad size**, **gun power** and **fire rate**. Progress is saved on the device.

## Develop

```bash
npm install
npm run dev       # dev server (also on your LAN, so you can open it on a phone)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

The build uses relative paths, so you can host the `dist/` folder anywhere static: GitHub Pages, Netlify, itch.io, or an S3 bucket.

## Code map

```
src/main.ts            bootstrap + WebGL check
src/game/Game.ts       state machine, fixed-step loop, firing, collisions, rewards
src/game/Level.ts      seeded level layout (waves, gates, gems) + difficulty per level
src/game/Squad.ts      the crowd: formation, steering, count label
src/game/Bullets.ts    pooled bullets (one instanced draw)
src/game/Enemies.ts    grunts, brutes and the boss, with health labels
src/game/Gates.ts      +N / −N gates that rise when shot
src/game/Gems.ts       gem pickups
src/game/Effects.ts    hit / kill particles
src/game/Progress.ts   saved level, gems and upgrade levels; upgrade costs
src/game/Track.ts      scrolling floor grid + roadside pillars
src/render/Scene.ts    camera, lights, sky, sun, mountains, bloom, adaptive quality
src/render/Label.ts    canvas-texture text for in-world numbers
src/input/Input.ts     drag + held keys → steering; pause / confirm
src/ui/UI.ts           DOM overlay: HUD, menus, upgrade shop, results
```

## Performance notes

- Pixel ratio is capped at 2. If frames are consistently slow, the game first turns off bloom and then lowers the resolution.
- Enemies, gates, bullets, gems and particles come from pre-allocated pools, so nothing is allocated during a run.
- Gameplay runs at a fixed 120 Hz step, so it plays the same on 30, 60 and 120 Hz screens.
