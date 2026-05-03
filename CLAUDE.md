# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## License

Copyright (c) 2026 Eyal Azulay. All rights reserved (`UNLICENSED`). Do not suggest changing to a permissive license.

## Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # TypeScript + Svelte type checking
npm run check:watch  # Watch mode type checking
npm run lint         # Prettier check + ESLint
npm run format       # Auto-format with Prettier
```

No test runner is configured — type checking via `svelte-check` and linting via ESLint serve as validation.

## Working conventions

- **Keep CLAUDE.md up to date** after every set of code changes. If the user ends the session by typing "exit", update CLAUDE.md before stopping, even if they didn't ask.

## Architecture

The game is named **Tank Royale**. It is a SvelteKit + Three.js tanks game using [Threlte](https://threlte.xyz/) (Three.js bindings for Svelte 5).

**Route flow:**
- `src/routes/+page.svelte` — Landing page, links to `/game`
- `src/routes/game/+page.svelte` — Wraps `<Scene>` in Threlte's `<Canvas shadows>`, holds `restartKey` and pointer-lock state, manages the firing charge mechanic, renders HTML overlay (buttons when unlocked, charge bar + hint when locked)
- `src/routes/game/Scene.svelte` — Terrain generation, `getTerrainHeight` and `isInBounds` exposed via Svelte context, water plane, sky colour; owns the `shells` array and renders `<Shell>` instances
- `src/lib/Tank.svelte` — Self-contained tank: physics, keyboard/mouse input, turret/barrel control, chase camera, directional light — all controlled by `controlled` and `chaseCamera` boolean props; `onfire` prop called with `(position, velocity)` when a shell is fired
- `src/lib/Shell.svelte` — Self-contained shell: clones initial position/velocity, owns its own `useTask` physics loop, handles water splash and terrain impact
- `src/lib/Explosion.svelte` — Fireball + flying rocks with ballistic physics; rocks trigger `<Splash>` on water crossings; delays removal until all rocks landed and all splashes complete
- `src/lib/Splash.svelte` — Reusable water splash: 3 staggered expanding `RingGeometry` rings fading over 2 s; calls `onremove` when all rings finish; used by both Shell and Explosion

**Prettier config:** tabs, single quotes, no trailing commas, 100-char line width. VS Code is configured (`.vscode/settings.json`) to run Prettier on save. Re-read any file after editing it before making further edits, in case Prettier has reflowed it.

**TypeScript:** strict mode enabled; uses bundler module resolution.

## Key patterns

**Svelte 5 reactivity with Three.js objects:** Mutating `.x/.y/.z` on a `$state` Vector3 does NOT trigger re-renders. Always reassign: `tankPosition = new THREE.Vector3(x, y, z)`.

**Threlte per-frame loop:** `useTask((delta) => { ... })` — `delta` is seconds since last frame.

**Terrain generation** (`Scene.svelte`): `PlaneGeometry` in XY plane, heights stored in Z, then `rotateX(-Math.PI/2)` maps Z → world Y. Heights use bilinear interpolation via `getTerrainHeight(wx, wz)`. Vertex colors set via `BufferAttribute` on `'color'` attribute + `vertexColors` on `MeshStandardMaterial`. `getTerrainHeight` is shared to child components via `setContext('getTerrainHeight', fn)`; returns `0` for out-of-bounds coordinates. `isInBounds(wx, wz)` (same grid math, exposed via `setContext('isInBounds', fn)`) returns false for the same OOB cases.

**Tank rotation order — critical:** Use nested groups to avoid Euler XYZ interaction between heading and pitch/roll:
```svelte
<T.Group position={[x, y, z]} rotation.y={tankHeading}>
  <T.Group rotation.x={tankPitch} rotation.z={tankRoll}>
    <!-- tank meshes -->
  </T.Group>
</T.Group>
```
Putting all three angles on the same object with XYZ order causes pitch/roll to be heading-dependent (world-space axes, not tank-local axes).

**Tank pitch/roll from terrain normal:**
```js
const dhdx = (getTerrainHeight(x+ε, z) - getTerrainHeight(x-ε, z)) / (2ε);
const dhdz = (getTerrainHeight(x, z+ε) - getTerrainHeight(x, z-ε)) / (2ε);
const slopeForward = dhdx*(-sinH) + dhdz*(-cosH);  // project onto tank forward
const slopeRight   = dhdx*cosH   + dhdz*(-sinH);   // project onto tank right
targetPitch = +Math.atan(slopeForward);  // positive = nose up
targetRoll  = +Math.atan(slopeRight);   // positive = right side up
```

**Tank Y positioning — track corners:** Tank Y is set to `max(requiredY)` over the 4 track-belt corners `(±TRACK_W, 0, ±TRACK_L)` in local space, transformed to world XZ. Each corner's required Y accounts for the current tilt:
```js
requiredY = getTerrainHeight(cornerWx, cornerWz) + lz*sin(pitch) - lx*sin(roll)
```

**Gravity / grounded physics:** `velocityY` accumulates gravity each frame. When `newY <= groundY`, the tank is clamped to `groundY` and `velocityY` reset to 0. Keyboard input and slope limits are gated on `velocityY === 0` (grounded last frame).

**Slope limits** (`Tank.svelte`): `MAX_SLOPE = tan(35°) ≈ 0.70`. Uphill steeper than MAX_SLOPE blocks movement (speed zeroed, position reverted). Overall slope steeper than MAX_SLOPE causes downhill sliding proportional to excess slope. Terrain max slope is ~45° given the vertex height constraint of ±5 per 5-unit cell.

**Differential track steering:** Left and right tracks spin at different rates during turns:
```js
wheelSpinLeft  += (speed - angVel * factor) * delta;
wheelSpinRight += (speed + angVel * factor) * delta;
```

**Track animation speed (`Tank.svelte`):** `spinSpeed` uses `max(speed, accelSpin)` (forward) / `min(speed, accelSpin)` (backward) rather than `speed + accelSpin`. This keeps wheel animation proportional to actual movement when coasting, while still spinning visibly when slope blocks movement (speed=0 but key held). Direction is resolved via `spinDir = speed !== 0 ? sign(speed) : sign(accelSpin)` to handle the standstill case correctly.

**Controls (`Tank.svelte`):**
- `W`/`S` — drive forward/back; `A`/`D` — steer left/right (hull)
- `X` — handbrake: one tap decelerates to a full stop (`BRAKE_DECEL = 6`); cancelled early by pressing `W` or `S`
- Arrow left/right — rotate turret; arrow up/down — elevate/depress barrel (clamped to −10°/+40°)
- Mouse (when pointer-locked) — aim turret/barrel; directly updates `turretHeading`/`barrelElevation`

**Firing charge mechanic (`+page.svelte`):** Hold LMB (pointer-locked) or Space to charge. Bar fills over 2 seconds (green → gold) with a centred "VELOCITY" label. Release to fire at current charge level (minimum speed 20 m/s, maximum 50 m/s). At 100% the bar pulses gold for 500 ms then disappears — releasing after that does not fire. Charge state is managed in `+page.svelte` via a `requestAnimationFrame` loop; on fire it dispatches a `tank-fire` custom event with `{ chargeLevel }`. Tank listens for `tank-fire`, computes muzzle world position + velocity vector, and calls `onfire(position, velocity)`. `spaceHeld`/`mouseHeld` are plain `let` (not `$state`) and are only cleared by their own `keyup`/`mouseup` handlers — NOT by `resetCharge()` — to prevent key-repeat from restarting a dismissed charge. The charge bar and reload bar share the same screen position (`top: 1.2rem`, centred) — they are never visible simultaneously.

**Reload mechanic (`+page.svelte`):** After firing, a 4-second reload countdown begins (`RELOAD_TIME = 4000`). `reloadProgress` (`$state`, 0–1) is driven by the same RAF loop. `startCharge` is gated on `reloadProgress >= 1` so the player cannot charge while reloading. A reload bar (dark red → orange) starts full and drains to empty (`width: (1 - reloadProgress) * 100%`) with a centred "RELOADING" label; disappears when reload completes. Pressing R (restart) immediately resets `reloadStart = null; reloadProgress = 1`.

**Turret and barrel (`Tank.svelte`):** `turretHeading` (relative to hull) and `barrelElevation` are separate `$state` values updated in `useTask`. The template uses nested groups:
```svelte
<T.Group rotation.y={turretHeading}>          <!-- turret ring -->
  <!-- turret mesh, cupola -->
  <T.Group position={[0, 1.29, -0.67]} rotation.x={barrelElevation}>  <!-- pivot at mantlet -->
    <!-- gun mantlet, barrel -->
  </T.Group>
</T.Group>
```
The cupola sits in the turret group (rotates with turret azimuth) but outside the elevation group (does not tilt with barrel).

**Barrel elevation pivot — gun mantlet:** The elevation group pivots at the turret front face (`z ≈ −0.67`), not the turret centre. This keeps the barrel visually anchored to the turret as it elevates. A gun mantlet mesh at the pivot point (`position={[0,0,0]}` in the elevation group) masks the gap. The barrel mesh is offset so its world position is unchanged: `pivot_z + barrel_local_z = turret_centre_z − half_barrel_length`.

**Camera (`Tank.svelte`):** Single chase camera, active only when `chaseCamera` prop is true. Smoothly lerps (factor `CHASE_LERP=3`) to a position behind the barrel — using `absHeading = tankHeading + turretHeading` so rotating the turret swings the camera around the tank. Camera Y rises with barrel elevation: `tankPosition.y + CAMERA_HEIGHT + sin(barrelElevation)*CAMERA_BEHIND*0.5`, floored at `terrainHeight(camXZ) + CAMERA_HEIGHT` to avoid going underground. Look target is `tankPosition` with Y offset `CAMERA_HEIGHT*0.5 + sin(barrelElevation)*CAMERA_BEHIND*0.4`. `cameraRef` captured via `oncreate`.

**Pointer lock (`+page.svelte`):** `document.documentElement.requestPointerLock()` is called when the player clicks "Use Mouse Control". Mouse aim (`movementX/Y`) accumulates whenever `pointerLockElement !== null`. Escape releases pointer lock (browser-enforced); the overlay reappears automatically via `pointerlockchange`.

**Directional light tracking tank** (`Tank.svelte`): Light is rendered inside `{#if chaseCamera}`. Position and target updated every frame via `lightRef` directly (no reactive overhead). Small shadow frustum (±`SHADOW_HALF` units) for sharp shadows near tank.

**Exposing component methods:** `export function reset()` in Tank.svelte is called by Scene via `bind:this={tankRef}` → `tankRef.reset()`. `onMount(() => snapTankToTerrain(0, 0))` handles the initial terrain snap since Tank mounts after Scene's `initGame()` has populated `heights`.

**`const` / `let` temporal dead zone:** In Svelte 5 component scripts, `const` and `let` declarations are NOT hoisted. Any code that runs at initialisation (e.g. `initGame()` called at module level) must appear after all `const`/`let` declarations it depends on.

**Custom hull geometry (`Tank.svelte`):** The hull is a trapezoidal prism built from a `BufferGeometry` (function `makeHullGeometry`). Bottom face extends further forward than the top (front slope ~32° from vertical) and slightly further back (rear ~11° from vertical), making front/back visually distinct. Each face uses its own vertices (non-indexed) so `computeVertexNormals()` gives clean flat shading per face. The geometry encodes absolute tilt-group local coords (`y=0.30` = track top, `y=1.10` = hull top), so the mesh has no position offset. UV coordinates are generated via box projection: each face projects onto its dominant plane (top/bottom → XZ, front/back → XY, sides → ZY), normalised to [0, 1] per face so textures cover each face without stretching.

**Per-frame allocation avoidance:** `_X_AXIS`, `_Y_AXIS`, `_scratchEuler` are declared once as component-level constants and reused inside `useTask` and `fire()` to avoid GC pressure. `cameraPosition` (a `$state` Vector3 read by the template) must still be reassigned to a `new THREE.Vector3` each frame — mutating `.x/.y/.z` in place does not trigger reactivity.

**Shell system (`Scene.svelte` + `Shell.svelte`):** Scene owns a `shells: ShellInstance[]` array (`$state`). Tank's `onfire(position, velocity)` callback pushes a new entry; Scene renders `{#each shells as s}<Shell onremove={() => removeShell(s.id)} .../>`. `removeShell(id)` filters the shell out of the array. On restart, `shells = []` in `initGame()`. Each Shell component:
- Clones `position` and `velocity` on mount; runs its own `useTask` physics loop (gravity, position, quaternion orientation along velocity)
- Updates the group position/quaternion imperatively via `groupRef` (no Svelte reactivity overhead)
- **Out-of-bounds flight:** physics continues past the terrain boundary without sticking. When `pos.y < position.y - 15` (15 m below the launch height), Shell calls `onremove()` and exits the task. Terrain impact and splash are guarded by `isInBounds` so `getTerrainHeight`'s OOB sentinel of `0` never triggers a false hit.
- **Water splash:** detects crossings of `y=0` in water areas (only when `isInBounds`) by comparing `prevY` to `pos.y` each frame. Each crossing (upward or downward) mounts a `<Splash>` component. Multiple splashes run concurrently via a `$state<{id,x,z}[]>` array.
- **Terrain impact:** (only when `isInBounds`) when `pos.y <= getTerrainHeight(pos.x, pos.z)`, sets `done = true` and hides the mesh. The `useTask` keeps running until all active splashes finish, then calls `onremove()`.
- Shell material: `MeshStandardMaterial` copper/brass (`#c87830`), metalness 0.8, roughness 0.3, emissive `#7a3a08` at 0.4 intensity for visibility in shadow.

**Splash component (`Splash.svelte`):** Props: `x`, `z`, `onremove`. Manages 3 rings with staggered delays (0, 0.4, 0.8 s); each expands from radius 0 to 6 over 2 s while fading from opacity 0.7 to 0. Rendered as `<T.Mesh><T.RingGeometry>` in Svelte markup (reactive `$state<Ring[]>`). Calls `onremove()` once all rings have completed. Used by both `Shell.svelte` and `Explosion.svelte`.

**Explosion system (`Explosion.svelte`):** Created by Scene when a shell impacts terrain (`onimpact` → `handleImpact` → `explosions.push`). Components:
- **Fireball:** `SphereGeometry` scaled via `sin` curve over 0.6 s then hidden; opacity fades 1→0.
- **Rocks:** 10 `IcosahedronGeometry` meshes with randomised size, azimuth, elevation (0.08–1.81 rad), and speed (4–20 m/s). Ballistic physics + angular spin per frame, updated imperatively via `rock.mesh`. Land when `pos.y <= getTerrainHeight` (only when `isInBounds`); hidden on landing. Each landed rock calls `onrockland` to raise terrain slightly (distributing crater depth across all rocks). **Grace period:** landing is not checked for the first 0.15 s — this prevents rocks from immediately registering as landed on sloped terrain at the impact point.
- **Rock water splashes:** each rock tracks `prevY`; detects crossings of `y=0` in water areas (same `isInBounds` + terrain-height-<0 guard as Shell) and mounts a `<Splash>`.
- **Removal:** `useTask` calls `stop()` + `onremove()` only when fireball done AND all rocks landed AND all splashes finished.

**Muzzle world position (`Tank.svelte` `fire()`):** Barrel tip at `z=−2.25` in elevation-group local space. Transform chain: `Rx(barrelElevation)` → add pivot offset `(0, 1.29, −0.67)` → `Ry(turretHeading)` → `Euler(tankPitch, 0, tankRoll)` → `Ry(tankHeading)` → add `tankPosition`. Same chain (without the pivot offset step) gives the firing direction unit vector.

**Terrain textures (`Scene.svelte`):** `MeshStandardMaterial` with `onBeforeCompile` for three-way biome blending. Grass textures (`Grass006`) occupy the material's primary `map`/`normalMap`/`roughnessMap` slots; sand (`Ground079L`) and snow (`Snow010A`) are passed as custom uniforms. A `vHeight` varying carries world Y from the vertex shader. Two blend weights are computed per fragment: `grassBlend = smoothstep(3, 5, h)` (sand→grass) and `snowBlend = smoothstep(24, 27, h)` (grass→snow) — each applied to colour, roughness, and normal maps in sequence. Vertex colours are white (1,1,1) on all land so textures show naturally; underwater vertices use a blue tint `(0.35, 0.55, 0.9)`. All textures tile at `repeat(60, 60)` (~12 world units per tile). Texture files live in `static/textures/`; only `_Color.jpg` (sRGB), `_NormalGL.jpg`, and `_Roughness.jpg` variants are used.

**Tank textures (`Tank.svelte`):** A shared `loadTex(prefix, suffix, srgb)` helper loads any PBR texture set from `static/textures/`. All four PBR maps are used: `Color` (sRGB), `NormalGL`, `Roughness`, `Metalness`; both `metalness` and `roughness` scale factors are set to 1.0 so the maps drive the values fully.
- **Hull + turret** (`hullMaterial`, shared as `turretMaterial`): texture set `Metal047B`. Color tinted with `#CBFF70` — this is the olive-green hue `#556B2F` normalised so its brightest channel reaches 1.0, which tints without darkening the texture beyond what the hue requires.
- **Barrel** (`barrelMaterial`): texture set `Metal055A`, no colour tint (natural metal colour).
- The custom hull `BufferGeometry` has no auto-generated UVs, so `makeHullGeometry` builds them explicitly via box projection (see above).

**HTML overlays over Canvas:** Wrap `<Canvas>` in a `position: relative` div; overlay divs use `position: absolute; z-index: 10`. The game overlay uses `pointer-events: none` on the container and `pointer-events: auto` on the panel so the canvas remains interactive behind it. The charge bar uses `z-index: 20` and is always rendered when `chargeVisible`, independently of the lock state overlay.
