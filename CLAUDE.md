# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## License

Copyright (c) 2026 Eyal Azulay. All rights reserved (`UNLICENSED`). Do not suggest changing to a permissive license.

## Commands

```bash
npm run dev          # Start dev server (localhost:5173) — relay WebSocket runs on same port
npm run build        # Production build: vite build + tsc --project tsconfig.relay.json
npm run preview      # Preview production build
npm run check        # TypeScript + Svelte type checking
npm run check:watch  # Watch mode type checking
npm run lint         # Prettier check + ESLint
npm run format       # Auto-format with Prettier
node server.js       # Run production server after build (cPanel startup file)
```

No test runner is configured — type checking via `svelte-check` and linting via ESLint serve as validation.

## Working conventions

- **Keep CLAUDE.md up to date** after every set of code changes. If the user ends the session by typing "exit", update CLAUDE.md before stopping, even if they didn't ask.

## Architecture

The game is named **Tank Royale**. It is a SvelteKit + Three.js tanks game using [Threlte](https://threlte.xyz/) (Three.js bindings for Svelte 5).

**Route flow:**
- `src/routes/+page.svelte` — Mode-select: player name input (persisted to `localStorage`), Single Player → `/single`, Multiplayer → `/multi`
- `src/routes/single/+page.svelte` — Single-player setup: AI count 1–5 (default from `localStorage['sp_aiCount']`), Mute checkbox. `startGame()` calls `unlockAudio()`, saves count to `localStorage['sp_aiCount']`, generates a 32-bit seed, writes `{ aiCount, seed }` to `sessionStorage['sp_gameStart']`, navigates to `/game` (or `/game?muted=1`).
- `src/routes/multi/+page.svelte` — Multiplayer lobby: connects WebSocket via `mp` store, lists rooms, create/join flow.
- `src/routes/multi/[roomId]/+page.svelte` — Waiting room: color picker, AI stepper, join-request panel, countdown + Start/Cancel actions; handles direct-URL entry by sending `request_join` on connect.
- `src/routes/game/+page.ts` — `export const ssr = false` (prevents WebGL crash on SSR).
- `src/routes/game/+page.svelte` — Calls `buildGameSetup()` at module-init (before children mount) to produce `gameSeed`, `tankNames`, `tankColors`, `relayToLocal`. Multiplayer reads from `mp.gameStart` / `sessionStorage['mp_gameStart']`; single-player reads from `sessionStorage['sp_gameStart']`. `opponentCount = tankNames.length - 1` (authoritative). `onMount` calls `connect()` for multiplayer (idempotent; triggers rejoin after F5). `onDestroy` sends `leave_room` and removes all sessionStorage keys. Handles `mp.latestPlayerLeft` to mark tanks destroyed and show a 5 s banner.
- `src/routes/game/Scene.svelte` — Accepts `opponentCount`, `seed`, `tankNames`, `tankColors`, `isHost`, `selfRelayIndex`, `relayToLocal` (null in single-player). Multiplayer: registers `GameHandlers`, broadcasts `tank_state`, forwards shell/hit/explosion events. `fullRelayToLocal`/`fullLocalToRelay` maps cover human and AI tanks.
- `src/lib/Tank.svelte` — Self-contained tank: physics, keyboard/mouse/touch input, turret/barrel, AI state machine, chase camera. `controlled` and `chaseCamera` props toggle player vs AI behaviour.
- `src/lib/Shell.svelte` — Self-contained shell with its own `useTask` physics loop; handles water splash and terrain impact. Props: `position`, `velocity`, `firingBodyUid`. Derives `amOwner` (firer is local player, or firer is AI and this is host) and `_tracked` from context (`selfRelayIndex`, `getIsHost`). `amOwner` gates terrain/tree explosions and `onremove`; `registerHit` writes `body.lastHit` only for own tank or AI-on-host. Closest-approach tracking via `pendingHits[]`.
- `src/lib/Explosion.svelte` — Fireball + ballistic rocks; rocks trigger `<Splash>` on water crossings; delays `onremove` until all rocks and splashes finish.
- `src/lib/Splash.svelte` — 3 staggered expanding ring geometries; `onremove` fires when all rings complete. Used by Shell, Explosion, and Tank (wake waves).
- `src/lib/Flames.svelte` — Imperative fire: 6 cone meshes + PointLight in a `THREE.Group`. Props: `x/y/z`, `baseHeight` (0.3 for tanks), `burning`, `scale`, `flameCount`, `burnDuration` (cubic falloff; 0 = no fade). Shader warmup via `renderer.compile` on first tick.
- **HTML health bars** — Rendered as HTML overlays (not in-world). `Scene` exposes `tankHealthData` as a `$bindable`; `+page.svelte` renders player bar (bottom-right, vertical) and opponent bars (bottom-left, side-by-side). Destroyed tanks fade to 30% opacity.

**Prettier config:** tabs, single quotes, no trailing commas, 100-char line width. Re-read any file after editing in case Prettier has reflowed it.

**TypeScript:** strict mode, bundler module resolution.

## Key patterns

**Svelte 5 reactivity with Three.js objects:** Mutating `.x/.y/.z` on a `$state` Vector3 does NOT trigger re-renders. Always reassign: `tankPosition = new THREE.Vector3(x, y, z)`.

**Threlte per-frame loop:** `useTask((delta) => { ... })` — `delta` is seconds since last frame.

**Terrain generation** (`Scene.svelte`): `PlaneGeometry` in XY plane, heights in Z, then `rotateX(-Math.PI/2)` maps Z → world Y. Heights use bilinear interpolation via `getTerrainHeight(wx, wz)` (returns `0` for OOB). `isInBounds` exposed via context alongside `getTerrainHeight`. Vertex colors via `BufferAttribute` + `vertexColors`.

**Tank rotation order — critical:** Nested groups prevent Euler XYZ interaction between heading and pitch/roll:
```svelte
<T.Group position={[x, y, z]} rotation.y={tankHeading}>
  <T.Group rotation.x={tankPitch} rotation.z={tankRoll}>
    <!-- tank meshes -->
  </T.Group>
</T.Group>
```
Putting all three angles on one object causes pitch/roll to be heading-dependent.

**Tank pitch/roll from terrain normal:**
```js
const dhdx = (getTerrainHeight(x+ε, z) - getTerrainHeight(x-ε, z)) / (2ε);
const dhdz = (getTerrainHeight(x, z+ε) - getTerrainHeight(x, z-ε)) / (2ε);
slopeForward = dhdx*(-sinH) + dhdz*(-cosH);  // project onto tank forward
slopeRight   = dhdx*cosH   + dhdz*(-sinH);   // project onto tank right
targetPitch = +Math.atan(slopeForward);
targetRoll  = +Math.atan(slopeRight);
```

**Tank Y positioning — track corners:** Y is `max(requiredY)` over 4 track corners `(±TRACK_W, 0, ±TRACK_L)` transformed to world XZ. Each corner: `requiredY = getTerrainHeight(cx, cz) + lz*sin(pitch) - lx*sin(roll)`.

**Gravity / grounded:** `velocityY` accumulates gravity; clamped to ground when `newY <= groundY`. Input and slope limits gated on `velocityY === 0`.

**Water drag:** Detected when `getTerrainHeight(x, z) < 0`. Drag applied as `vel *= pow(DRAG, delta)` while `pos.y <= 0`. Different constants for shell, rocks, tank. Tank water check uses current `tankPosition`, not proposed new position.

**Slope limits:** `MAX_SLOPE = tan(35°)`. Uphill steeper than MAX_SLOPE blocks movement; excess slope causes downhill sliding.

**Track animation speed:** `spinSpeed` uses `max(speed, accelSpin)` rather than sum — keeps animation proportional to movement when coasting, while still spinning when slope blocks movement. Direction via `spinDir = speed !== 0 ? sign(speed) : sign(accelSpin)`.

**Controls:**
- `W/S` — drive; `A/D` — steer; `X` — handbrake; `Z` — zoom (50°→15° FOV, 4× finer aim); `M` — mute
- Arrow keys — turret/barrel; mouse (pointer-locked) — aim
- No Restart button or shortcut — players quit to main menu.

**Mobile / touch controls:** Detected via `'ontouchstart' in window || navigator.maxTouchPoints > 0`. Left joystick dispatches `tank-touch-drive`; right dispatches `tank-touch-aim`; FIRE button drives charge/fire via `touchFireHeld`. Touch drive clears keyboard flags to prevent conflicts. `touch-action: none` on `.game-container`.

**Zoom mode:** `currentFov` is a plain `let` lerped each frame toward `ZOOM_FOV=15` or `NORMAL_FOV=50`, written imperatively to the camera with `updateProjectionMatrix()`.

**Shell camera tracking in zoom mode:** Shell's live `pos` Vector3 is shared via `'shellFollow'` context and updated in-place — no per-frame writes needed. On impact, `shellFollow.pos` is cloned to hold camera on the crater. When sequence ends, `shellFollow.pos` is nulled and `'shell-sequence-done'` event dispatched. `trackedShellId`/`trackedExplosionId` prevent stale events from overlapping sequences.

**Firing charge mechanic:** Charge fills over 2 s; releases at current level (20–50 m/s). At 100% pulses for 500 ms then auto-dismisses without firing. Dispatches `tank-fire` custom event with `{ chargeLevel }`. `spaceHeld`/`mouseHeld` are plain `let`, not cleared by `resetCharge()` — prevents key-repeat from restarting a dismissed charge. After fire, bar fades over 1 s (`chargeOpacity` 1→0), then 2 s reload begins. Charge and reload bars share the same position and never show simultaneously.

**Turret and barrel:** Nested groups — turret group rotates azimuth; inner elevation group pivots at mantlet (`z ≈ −0.67`), not turret centre. Cupola sits in the turret group, outside elevation group.

**Camera (`Tank.svelte`):** Lerps behind barrel using `absHeading = tankHeading + turretHeading`. `barrelDownLift = max(0, -worldBarrelPitch) * CAMERA_BEHIND * 2` where `worldBarrelPitch = barrelElevation + cos(turretH)*tankPitch - sin(turretH)*tankRoll` — the roll sign is negated because positive turretHeading rotates the barrel left (−X hull-local), which is downhill when tankRoll > 0. Camera Y floored at terrain height. Game-over: camera lifts to `(0, 800, 0)` over 30 s via quaternion SLERP (not `lookAt` — avoids gimbal-lock snap).

**`const` / `let` temporal dead zone:** In Svelte 5, declarations are NOT hoisted. Code running at init (e.g. `initGame()` at module level) must appear after all declarations it depends on.

**Custom hull geometry:** Trapezoidal prism via `BufferGeometry` (`makeHullGeometry`). Non-indexed so flat normals work per face. UVs generated via box projection per face.

**Per-frame allocation avoidance:** Scratch vectors/quaternions declared at component level, reused in `useTask`. `cameraPosition` (`$state` Vector3) must be reassigned to `new THREE.Vector3` each frame — in-place mutation doesn't trigger reactivity.

**Shell system:** Scene owns `shells: ShellInstance[]` (`$state`). Each Shell clones position/velocity on mount, runs its own physics loop, updates `groupRef` imperatively. OOB exit: when `!isInBounds && pos.y < startY - 15`, shell removes itself — the `!isInBounds` guard is critical, otherwise high-ground shells would be removed before reaching distant low-lying terrain. Terrain impact and water splash are both guarded by `isInBounds` so `getTerrainHeight`'s OOB sentinel of `0` never triggers false hits.

**Splash component:** Ring geometry's position buffer is updated in-place each frame (not via reactive `args`) — avoids creating a new GPU buffer every frame. Material uses `depthWrite={false}` (no holes in overlapping transparency), `polygonOffset` (breaks z-fighting with the coplanar water plane — works from both above/below because NDC offset is camera-direction-independent), `renderOrder={1}`. Do NOT set `depthTest: false` — rings would show through terrain.

**Tree system:** Trees generated on a 35-unit jittered grid, grass biome only (height 5–23, slope ≤ 0.5), excluded within 40 units of spawns. `nextTreeId` is a persistent counter (never reset) so Svelte treats each new set as fresh components. `treeVolumes` and `treeTrunks` are stable array references (mutated in-place in `initGame()`) shared via context — the same object reference stays valid in child components across restarts.

**Tree trunk collision:** Speed is zeroed only when velocity has a component toward the trunk (allows sliding along the surface). `TANK_RADIUS = 1.4` (slightly larger than `TRACK_W = 1.1`).

**Tank-tank collision:** Equal-mass impulse applied to `pushVx/pushVz` on the other body; decays with `Math.pow(PUSH_DECAY, delta)` each frame. Destroyed bodies (`hitAt !== null`) are skipped.

**Tank destruction:** Shell checks XZ distance (`HIT_RADIUS = 2.5`) AND vertical distance (`HIT_HEIGHT = 3.0`) — height check prevents fly-over false hits. Firer identified by numeric `body.uid` (not object reference) — Svelte 5 `$state` deep-proxies array contents, breaking `===` identity on objects. Shell writes `body.lastHit` (not `hitAt`) and sets `done = true`; Tank reads it next frame and starts burn sequence. `hitAt` is only set when health reaches 0 (triggers explosion + hides tank). While burning, physics is frozen and health drains; if health > 0 when burn ends, tank resumes.

**Visual damage:** Two effects driven by `damageFraction = 1 − health/100`: per-face hull dents (start at 85% health) and front/back panel deformation (panels progressively degenerate as damage increases). Updates throttled to `damageFraction` changes > 0.005.

**Explosion system:** 10 ballistic rocks with randomised ejection. Grace period of 0.15 s before landing is checked (prevents immediate landing on sloped terrain at impact point). Water drag split by axis (horiz/vert/spin) with different constants for rocks vs flat panels.

**Opponent AI:** Four states in `useTask` when `!controlled`:
- **patrol**: drives toward `aiPatrolAngle` (biased toward centre), scans turret ±60°.
- **search**: moves to `aiLastSeenX/Z`; slows to creep within 50 units; exits when within 12 units.
- **engage**: approach/back-away/good-range sub-cases. Back-away tracks turret unconditionally (pure geometry) before the ballistic block — turret never left pointing nowhere if solver fails. Good range seeks flat ground before firing. After 3 consecutive misses, repositions by shrinking max or growing min engage distance. Fire requires 0.3 s dwell on aimed condition.
- **cooldown**: 2–3.5 s. Turret tracked via pure geometry throughout (not ballistic solve). On expiry, reads `ownBody.lastShellImpact` to compute speed and heading biases for the next shot. Hit → reset biases.

**Vision:** 120° FOV cone (dot product). LOS sampled at `max(16, ceil(dist/5))` — one sample per 5-unit terrain cell so no narrow hill slips between checks. FOV + LOS for new contacts; LOS-only for maintaining contact.

**Ballistic solver (`aiComputeAim`):** Iterates speed from `SHELL_MIN` to `SHELL_MAX` in steps of 3; solves `disc = v⁴ − g(gd² + 2Δh·v²)`; tests low-angle then high-angle solution. Shot-correction biases (from cooldown) added at fire time.

**AI stuck detection:** If `(upHeld || downHeld) && speed < 0.3` persists for 1.5 s, forces hard turn in `aiStuckTurnDir`. Reverses direction after 3× that. Resets when making progress.

**Muzzle world position:** Barrel tip at `z=−2.25` in elevation-group local space. Transform chain: `Rx(barrelElevation)` → pivot offset `(0, 1.29, −0.67)` → `Ry(turretH)` → `Euler(pitch, 0, roll)` → `Ry(tankH)` → `+tankPosition`. Same chain without pivot gives firing direction.

**Terrain textures:** `MeshStandardMaterial` with `onBeforeCompile` for three-way biome blending (sand→grass→snow) via `vHeight` varying and `smoothstep` blend weights. Textures tiled at `repeat(60, 60)`.

**Tank textures:** Hull/turret share `Metal047B` texture set, tinted by `tankColor` (normalised so brightest channel = 255). Barrel uses `Metal055A` untinted.

**Three.js memory management:** Every imperative `BufferGeometry`, `Material`, and `Texture` must be disposed in `onDestroy`. For replaced objects (e.g. `terrainGeo` in `initGame()`), capture the old reference before reassigning and dispose after. **Critical anti-pattern:** `<T.RingGeometry args={[reactiveValue]} />` creates a new GPU buffer every frame — use `mesh.scale` or update `BufferAttribute` data instead.

**Water rendering:** Water surface uses `MeshBasicMaterial` (unlit) so colour exactly matches the hex value — essential for underwater camera consistency. Four vertical skirts use the **same opacity (0.6)** as the surface — mismatched transparency would create a visible seam at the waterline.

**Seeded RNG:** `mulberry32(seed)` from `src/lib/rand.ts`. Scene generates seed once; single-player stores it in `sessionStorage['sp_gameStart']`, multiplayer receives it in `game_start`. All terrain/spawn/tree generation uses `rand()` instead of `Math.random()`.

**Multiplayer infrastructure:**

- **`src/lib/mp.svelte.ts`** — module-level WS singleton. `connect(name)` is idempotent. `mp` state: `connected`, `clientId`, `rooms`, `room`, `gameStart`, `latestPlayerLeft`, etc. `setGameHandlers(h)` wires in-game event callbacks.
- **`src/lib/types.ts`** — protocol types. `TankBody.relayIndex`: `-1` = AI/single-player, `≥0` = player relay index. `ShellFiredMsg` includes `tracked` and `firingBodyUid`. `ClientMessage` / `ServerMessage` union types with `parseMessage`/`encodeMessage`.
- **`src/lib/relay.ts`** — in-memory relay. In-game events use `forwardToAll`. `removeFromRoom(clientId, sendPlayerLeft)`: `player_left` broadcast only on explicit leave (Quit), not on WS disconnect. **Reconnect/rejoin:** on WS close mid-game, `schedulePendingLeave` starts a 20 s grace timer; `handleRejoin` cancels it, remaps `wsToClientId` to the old clientId, sends `rejoin_ack`. On timeout, calls `removeFromRoom(clientId, true)`. `wsToClientId: Map<WebSocket, string>` ensures all message handling uses the canonical identity.
- **`tsconfig.relay.json`** — separate tsc compile for relay (`src/lib` → `build/`). Needed because adapter-node doesn't bundle files not imported by any route.
- **`server.js`** — production entry: shared `http.createServer`, WS on `/ws`, listens on `PORT ?? 3000`. Passenger (cPanel) starts this via `app.cjs`.
- **`relay-server.mjs`** — standalone relay entry point for production. Runs as a systemd service (`tanks-relay`) on port 3001, separate from Passenger. Start/stop: `systemctl start|stop tanks-relay`. After `npm run build`, restart with `systemctl restart tanks-relay`.
- **`vite.config.ts` relay plugin** — attaches WS server to Vite's httpServer for single-port dev.

**Production WebSocket setup (tanks.tiyal.com / cPanel + Passenger):** CloudLinux LVE isolates Passenger-managed Node.js processes in their own network namespace — Apache's `mod_proxy` cannot reach `127.0.0.1:3000` inside the LVE. Fix: `relay-server.mjs` runs as a systemd service under the `eyal` user (outside the LVE) on port 3001, which Apache can reach. Apache config at `/etc/apache2/conf.d/userdata/ssl/2_4/eyal/tanks.tiyal.com/websocket.conf` (and matching `std/` path) contains:
```apache
ProxyPass /ws ws://127.0.0.1:3001/ws upgrade=websocket
ProxyPassReverse /ws ws://127.0.0.1:3001/ws
```
Systemd service file: `/etc/systemd/system/tanks-relay.service`. After each deployment (`git pull && npm run build`), run `systemctl restart tanks-relay` on the server.

**Peer-to-peer physics:** Each client runs its own tank physics and broadcasts `tank_state` at 10 Hz. Physics host also runs AI and broadcasts their states. Shell owner broadcasts `shell_fired`, and on impact: `shell_removed` + `explosion` + `tree_ignited`. Hit detection follows two rules: (1) every shell is owned by its firer; AI shells are owned by the physics host — the owner creates terrain/tree explosions and sends `shell_removed`; (2) every shell runs on every client — each client checks all shells against its own tank, and the host also checks all shells against AI tanks. No `tank_hit` messages are sent; damage is applied locally where authoritative.

**Host migration:** On host disconnect, relay broadcasts `transfer_host`. New host sets `_isHost = true` and removes AI entries from `remoteStateMap` — those Tanks fall through to local AI physics on the next `useTask` tick.

**Terrain persistence:** `dirtyVertices: Set<number>` tracks modified vertices. Serialised to `localStorage['terrain_${gameSeed}']` every 8 s and on each explosion. Restored in `initGame()`. `pruneOldTerrainSaves()` removes entries older than 6 hours (but never the current seed's).

**Tree fire persistence:** Ignition timestamps saved to `localStorage['tree_fire_${gameSeed}']` immediately on each ignition. Restored by index in `initGame()` — deterministic generation guarantees stable indices for the same seed.

**Player and AI position persistence:** `SESSION_KEY` is `player_pos_${gameSeed}` for the player and `ai_pos_${gameSeed}_${localIndex}` for single-player AI tanks (`relayIndex === -1 && gameSeed !== null` — this uniquely identifies SP AI since multiplayer tanks always have relay indices ≥ 0). Both save position/heading every 2 s and restore in `onMount`. AI restore skipped if `_initialDestroyed`. F5 preserves data (onDestroy doesn't run); Quit clears it via `_quitting` flag.

**Opponent health/destroyed persistence:** Scene.svelte saves `[{health, destroyed}]` to `sessionStorage['opp_health_${gameSeed}']`. Saves on destruction (immediately) and on the save interval. `initGame()` restores before Tanks mount; Tanks receive `initialHealth`/`initialDestroyed` props. `onDestroy`: quit → clear all keys; multiplayer non-quit → save for rejoin; single-player non-quit → clear (safety net — effectively unreachable without Restart).

**Mute system:** `muted` prop passed to Scene; Scene calls `audioListener.setMasterVolume(muted ? 0 : 1)`. `AudioContext.suspend()` is NOT used — Threlte's `play()` calls `context.resume()` internally, overriding any suspend immediately.

**Audio system:** Positional stereo via `@threlte/extras` `<AudioListener>` + `<PositionalAudio>`. `AudioListener` is a child of the player's camera (correct spatial tracking). Engine sound `playbackRate` driven by speed each frame. Tree fire volume fades out over burn duration. All audio in `.mp3`.

**iOS audio unlock:** iOS suspends any `AudioContext` created before a user gesture. Fix: `unlockAudio()` in `src/lib/audioUnlock.ts` creates a fresh `AudioContext` inside the gesture (starts running). On touch devices, `tank-unlock-audio` event triggers `THREE.AudioContext.setContext(unlockedCtx)` in Tank.svelte before PositionalAudio components mount.
