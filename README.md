# Neon Runner

A synthwave-style 3D endless runner that runs in any modern browser: phones, tablets and desktops.
Built with [Three.js](https://threejs.org/), TypeScript and Vite. All geometry is generated in code, so there are no assets to load.

## Play

| Action        | Keyboard               | Touch / mouse          |
| ------------- | ---------------------- | ---------------------- |
| Switch lanes  | ← → or A D             | Swipe left / right     |
| Jump          | ↑, W or Space          | Swipe up               |
| Slide         | ↓ or S                 | Swipe down             |
| Pause         | Esc or P               | Pause button           |
| Start / retry | Enter or Space         | Tap                    |

- **Pink barriers:** jump over them.
- **Yellow beams:** slide under them.
- **Cyan blocks:** switch lanes.
- **Orbs:** +50 points each.

Speed rises as you go. Your best score is saved on the device.
Swiping down while you're in the air slams you to the ground and goes straight into a slide.

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
src/game/Game.ts       state machine (menu → playing ⇄ paused → dying → game over) and fixed-step loop
src/game/Player.ts     lanes, jump/slide physics, input buffering
src/game/Spawner.ts    obstacle rows (always passable) and difficulty ramp
src/game/Obstacles.ts  pooled obstacle meshes + hitboxes
src/game/Pickups.ts    pooled orbs
src/game/Track.ts      scrolling neon grid shader + roadside pillars
src/render/Scene.ts    camera, sky, sun, mountains, bloom, adaptive quality
src/input/Input.ts     keyboard + swipe (pointer events) → actions
src/ui/UI.ts           DOM overlay: HUD and menus
```

## Performance notes

- Pixel ratio is capped at 2. If frames are consistently slow, the game first turns off bloom and then lowers the resolution.
- All obstacles and orbs come from pre-allocated pools, so nothing is allocated during a run.
- Gameplay runs at a fixed 120 Hz step, so it plays the same on 30, 60 and 120 Hz screens.
