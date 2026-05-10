# Tank Royale

A 3D tank combat game built with SvelteKit and Three.js. Fight against up to three AI opponents across procedurally generated terrain with hills, water, forests, and snow-capped peaks.

## Gameplay

You control a tank on a shared battlefield. All tanks spawn on the perimeter facing along the circle. Last tank standing wins.

**Movement**

| Key   | Action                  |
| ----- | ----------------------- |
| W / S | Drive forward / reverse |
| A / D | Steer left / right      |
| X     | Brake to a stop         |

**Aiming**

| Input                     | Action                           |
| ------------------------- | -------------------------------- |
| Mouse (with pointer lock) | Rotate turret and elevate barrel |
| Arrow left / right        | Rotate turret                    |
| Arrow up / down           | Elevate / depress barrel         |
| Z                         | Toggle 5× zoom (finer aim)       |

**Firing**

Hold **left mouse button** or **Space** to charge the shot — a velocity bar fills over 2 seconds. Release to fire. The bar pulses gold at full charge and auto-cancels after half a second if you hold too long. A 2-second reload follows each shot.

**Camera**

The camera tracks behind the barrel. In zoom mode, it follows the shell in flight and holds on the impact point until the explosion clears.

**Click "Mouse Control"** on the start panel to enable pointer lock and mouse aim, or use arrow keys without it.

## Running locally

```bash
git clone https://github.com/eazulay/tanks
cd tanks
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.
