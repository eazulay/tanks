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

Hold **left mouse button** or **Space** to charge the shot — a velocity bar fills over 2 seconds. Release to fire. The bar pulses gold at full charge and auto-cancels after half a second if you hold too long. After firing, the bar fades for 1 second, then a 2-second reload begins (3 seconds total before you can fire again).

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
# HTTPS
git clone https://github.com/eazulay/tanks
# SSH (if you have an SSH key registered with GitHub)
git clone git@github.com:eazulay/tanks.git

cd tanks
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Comments about mutiplayer game internals

### Multiplayer P2P physics (Scene.svelte, relay.ts, +page.svelte, Tank.svelte):

- The physics host is the player with the highest CPU benchmark score, measured when connecting to the lobby; in single-player the local client is always host
- Each player runs their own tank physics locally and broadcasts tank_state at 10 Hz; physics host also broadcasts AI states
- Every shell runs full physics on every client; ownership (amOwner) is derived from firingBodyUid — true when the firer is the local player, or when the firer is AI and this is the host
- Owner triggers terrain/tree explosions, sends shell_removed; all clients stop the shell visually at any tank hit
- registerHit in Shell.svelte applies body.lastHit only where authoritative: own tank always, AI tanks on host only; other human tanks self-detect via their own shell instance
- handlePlayerFire/handleOpponentFire send shell_fired; handleImpact sends explosion + tree_ignited + tank_hit (for splash); handleTankExplosion sends explosion + tree_ignited to other clients
- onTankHit handler applies body.lastHit for splash damage only; direct shell hits are handled locally by Shell.svelte
- onShellFired/onExplosion/onTreeIgnited handlers create visual counterparts locally + deform terrain in sync
- relay.ts: all in-game events use forwardToAll (any client → all others)
- +page.svelte: computes isHost, selfRelayIndex from mp.gameStart and passes to &lt;Scene&gt;
- fullRelayToLocal/fullLocalToRelay maps in Scene cover both human and AI tank relay indices

### Terrain persistence (Scene.svelte):

- dirtyVertices: Set&lt;number&gt; tracks all modified terrain vertices
- Every 8 seconds: saveTerrainState() writes [[index, height, r, g, b], ...] to localStorage under terrain\_${gameSeed}
- On initGame(): restoreTerrainState() re-applies any saved modifications after terrain generation, restoring crater state across page reloads

### How multplayer games share resposibility when shells are fired:

Every shell runs the same physics and hit-detection code on every client. Two rules determine what each client does with the result:

1. Every shell is owned by its firer. AI shells are owned by the physics host. The owner creates the terrain/tree explosion and sends shell_removed.
2. Every client checks every shell against its own tank. The physics host also checks every shell against AI tanks.

The owner sends shell_fired when firing; all other clients create their own shell instance from that message. Shell instances are removed when the owner's shell_removed arrives, or immediately when the owner's own shell is done.
