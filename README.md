# Tank Supremo

A 3D tank combat game built with SvelteKit and Three.js. Fight against up to five AI opponents across procedurally generated terrain with hills, water, forests, and snow-capped peaks.

**Play it live at [tanks.tiyal.com](https://tanks.tiyal.com)**

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

## Hosting on cPanel (Passenger + CloudLinux)

### SvelteKit app

1. Build: `npm run build`
2. In cPanel, set up a Node.js app pointing to the repo root with startup file `app.cjs`
3. Restart the app from cPanel after each deployment

`app.cjs` is a CommonJS wrapper required by cPanel's Node.js app manager:

```js
(async () => {
	await import('./server.js');
})();
```

### WebSocket relay

CloudLinux LVE isolates Passenger-managed processes in their own network namespace — Apache's `mod_proxy` cannot reach them directly. The relay must run as a separate systemd service outside the LVE.

**First-time setup (requires root SSH access):**

1. Create `/etc/systemd/system/tanks-relay.service`:

```ini
[Unit]
Description=Tank Supremo WebSocket Relay
After=network.target

[Service]
Type=simple
User=<cpanel-username>
Group=<cpanel-username>
WorkingDirectory=/home/<cpanel-username>/repo/tanks
ExecStart=/home/<cpanel-username>/nodevenv/repo/tanks/22/bin/node relay-server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

2. Enable and start:

```bash
systemctl daemon-reload
systemctl enable tanks-relay
systemctl start tanks-relay
```

3. Add to `/etc/apache2/conf.d/userdata/ssl/2_4/<cpanel-username>/<your-domain>/websocket.conf` (and matching `std/` path for non-SSL connections):

```apache
ProxyPass /ws ws://127.0.0.1:3001/ws upgrade=websocket
ProxyPassReverse /ws ws://127.0.0.1:3001/ws
```

4. Rebuild Apache config: `/scripts/rebuildhttpdconf && systemctl restart httpd`

Port 3001 is arbitrary — if it conflicts with another app, change it in `relay-server.mjs` and in `websocket.conf`.

**After each deployment**, if `relay.ts` changed:

```bash
systemctl restart tanks-relay
```

## Comments about AI internals

### State machine (Tank.svelte)

Each AI tank runs a four-state machine every frame when `controlled` is false:

- **patrol** — drives toward a random `aiPatrolAngle` (biased toward the map centre) while scanning the turret ±60°. Transitions to **engage** on contact, **search** on lost contact.
- **search** — moves toward the last known position (`aiLastSeenX/Z`). Slows to a creep within 50 units and exits the state when it closes to within 12 units.
- **engage** — three sub-cases depending on distance to target: approach, back-away, or good-range. The good-range sub-case seeks flat ground before committing to a shot; firing requires the barrel to dwell on the aimed direction for 0.3 s. After 3 consecutive misses the AI repositions by adjusting its min/max engage distance.
- **cooldown** — 2–3.5 s pause after firing. On expiry the AI reads `lastShellImpact` to derive speed/heading correction biases for the next shot; a confirmed hit resets the biases.

In the back-away sub-case, the turret is pointed at the target via simple `atan2` geometry _before_ the ballistic solver runs, so it is never left frozen at a stale angle if the solver fails. During cooldown the same geometric tracking keeps the turret on the last known position while the solver separately pre-aims the barrel elevation for the next shot.

### Vision

A 120° FOV cone (dot-product test) combined with line-of-sight sampling along the path to the target. LOS uses `max(16, ceil(dist/5))` samples — one per 5-unit terrain cell — so a narrow hill can't slip between checks. Both FOV and LOS must pass for a new contact; only LOS is required to maintain an existing one.

### Ballistic solver (`aiComputeAim`)

Iterates muzzle speed from `SHELL_MIN` to `SHELL_MAX` in steps of 3 m/s. For each speed it solves the projectile discriminant `v⁴ − g(gd² + 2Δh·v²)` and tests the low-angle solution first, then the high-angle. Shot-correction biases accumulated during cooldown are added at fire time.

### Stuck detection

If the AI is holding a drive key but speed stays below 0.3 m/s for 1.5 s, it forces a hard turn in a fixed direction (`aiStuckTurnDir`). After three stuck cycles it reverses that direction. The counter resets whenever the tank makes progress.

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
