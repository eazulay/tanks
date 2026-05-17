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

## Attributions

**Sound files**

Diesel engine operation by nomerodin1 -- https://freesound.org/s/723104/ -- License: Creative Commons 0
Short Wave Radio Noise 1 by zmobie -- https://freesound.org/s/257880/ -- License: Creative Commons 0
Steampunk Crossbow Shot 1 by qubodup -- https://freesound.org/s/219457/ -- License: Attribution 4.0
Explosion_001.mp3 by cydon -- https://freesound.org/s/268557/ -- License: Attribution NonCommercial 4.0
Fire_Forest_Inferno.aif by Dynamicell -- https://freesound.org/s/17548/ -- License: Attribution 3.0

## Running locally

```bash
git clone https://github.com/eazulay/tanks
cd tanks
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Comments about mutiplayer game internals

### Multiplayer P2P physics (Scene.svelte, relay.ts, +page.svelte, Tank.svelte):

- Each player runs their own tank physics locally and broadcasts tank_state at 10 Hz; physics host also broadcasts AI states
- All shell physics run on the firing client (isHost=true); other clients see visual-only shells (isHost=false) that wait for shell_removed to be cleaned up
- handlePlayerFire/handleOpponentFire send shell_fired; handleImpact sends explosion + tree_ignited + tank_hit (for splash); handleShellTankHit sends tank_hit for remote human tanks, writes body.lastHit locally for own/AI tanks
- handleTankExplosion sends explosion + tree_ignited to other clients
- onTankHit handler applies body.lastHit only when the hit is directed at own relay index
- onShellFired/onExplosion/onTreeIgnited handlers create visual counterparts locally + deform terrain in sync
- relay.ts: all in-game events now use forwardToAll (any client → all others)
- +page.svelte: computes isHost, selfRelayIndex from mp.gameStart and passes to <Scene>
- fullRelayToLocal/fullLocalToRelay maps in Scene cover both human and AI tank relay indices

### Terrain persistence (Scene.svelte):

- dirtyVertices: Set<number> tracks all modified terrain vertices
- Every 8 seconds: saveTerrainState() writes [[index, height, r, g, b], ...] to localStorage under terrain\_${gameSeed}
- On initGame(): restoreTerrainState() re-applies any saved modifications after terrain generation, restoring crater state across page reloads

### How multplayer games share calc resposibility when shells fly:

Firing player (any client):

- Creates a local isHost=true shell — runs physics, detects hits
- Sends shell_fired to relay
- When shell hits terrain: creates explosion locally, sends explosion + shell_removed to all
- When shell hits a human player: sends tank_hit to relay; that player applies their own damage
- When shell hits an AI tank and the firer is not the host: drops the hit silently — the host's copy handles it

Physics host (on receiving a guest's shell_fired):

- Creates an aiDetectorOnly=true, isHost=true physics copy
- Runs the same deterministic physics — same gravity, same terrain — so it reaches the same positions
- Detects AI tank hits only, applies damage directly, no relay message needed
- Suppresses terrain explosion and shell_removed — the firer already handles those
- Removed silently when the firer's shell_removed arrives (or when it hits terrain first)

Other players (neither firer nor host):

- Receive shell_fired → create isHost=false visual shells
- These still run local physics (gravity, position update) for smooth interpolation, but detect nothing
- Receive shell_removed → remove the visual shell
- Receive explosion → show the explosion

So effectively: the firer owns terrain impact and human hit detection; the host owns AI hit detection; everyone else just animates the shell locally and reacts to relay events.
