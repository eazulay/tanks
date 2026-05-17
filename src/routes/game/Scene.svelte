<script lang="ts">
	import * as THREE from 'three';
	import { T, useThrelte } from '@threlte/core';
	import { useThrelteAudio } from '@threlte/extras';
	import { browser } from '$app/environment';
	import { setContext, onMount, onDestroy, untrack } from 'svelte';
	import Tank from '$lib/Tank.svelte';
	import Shell from '$lib/Shell.svelte';
	import Explosion from '$lib/Explosion.svelte';
	import Tree from '$lib/Tree.svelte';
	import type { TankBody, TankHealthEntry, TankSnapshot, TreeVol, TreeTrunk, ShellFollow } from '$lib/types';
	import { mulberry32 } from '$lib/rand';
	import { mp, send, TANK_STATE_HZ, setGameHandlers } from '$lib/mp.svelte.js';

	let {
		opponentCount = 1,
		tankHealthData = $bindable<TankHealthEntry[]>([]),
		gameOver = false,
		allGameOver = false,
		muted = false,
		seed = null as number | null,
		tankNames = [] as string[],
		tankColors = [] as string[],
		isHost = true,
		selfRelayIndex = 0,
		relayToLocal = null as Map<number, number> | null
	}: {
		opponentCount?: number;
		tankHealthData?: TankHealthEntry[];
		gameOver?: boolean;
		allGameOver?: boolean;
		muted?: boolean;
		seed?: number | null;
		tankNames?: string[];
		tankColors?: string[];
		isHost?: boolean;
		selfRelayIndex?: number;
		relayToLocal?: Map<number, number> | null;
	} = $props();

	// Unique audio listener ID per Scene instance — prevents Threlte's addAudioListener guard from
	// blocking the new listener when {#key} mounts new Scene before tearing down the old one.
	const audioId = Math.random().toString(36).slice(2);

	// Seeded RNG — use provided seed (multiplayer) or generate locally (single-player).
	// All clients in a multiplayer game receive the same seed via game_start, guaranteeing
	// identical terrain, spawns, and tree placement.
	// untrack: we intentionally capture the initial value only — seed never changes after mount.
	const gameSeed = untrack(() => seed) ?? ((Math.random() * 2 ** 32) | 0);
	const rand = mulberry32(gameSeed);
	setContext('audioId', audioId);

	// getAudioListener must be obtained at init time (uses Svelte context internally)
	const { getAudioListener } = useThrelteAudio();
	$effect(() => {
		// muted prop changed; listener is available once the player Tank has mounted
		getAudioListener(audioId)?.setMasterVolume(muted ? 0 : 1);
	});

	const { scene } = useThrelte();
	scene.background = new THREE.Color('#87CEEB');

	// --- Terrain generation ---
	const GRID_SEGS = 150;
	const WORLD_SIZE = 750;
	const N = GRID_SEGS + 1;
	const MAX_STEP_HEIGHT = 3.2;
	const BORDER_RAISE = 6.5;
	const WATER_SIZE = WORLD_SIZE + 40; // water extends 20 units beyond terrain on each side
	const WATER_SKIRT = 500; // depth of opaque skirt panels below the water perimeter

	// Tank spawning — circle at 80% of terrain half-radius, evenly spaced by count
	// Index 0 = player, indices 1..opponentCount = opponents (stationary until AI is added)
	const TANK_COUNT = untrack(() => opponentCount) + 1;
	const SPAWN_RADIUS = (WORLD_SIZE / 2) * 0.8; // 300 units
	const SPAWN_CLEAR = 40; // no trees within this distance of a spawn point

	// Hull tint colours — normalised so the brightest channel = 255, preserving texture brightness.
	// Index 0 = player (olive), 1–5 = opponents (sand, steel blue, rust, purple, mint).
	const TANK_COLORS = ['#CBFF70', '#FFD060', '#80CCFF', '#FF8055', '#CC80FF', '#60FFD0'];

	function generateHeights(): Float32Array {
		const h = new Float32Array(N * N);

		// Seed top-left corner at a random base elevation in [-10, 40]
		h[0] = rand() * 45 - 10;

		// Walk the top row — used as upper constraint for the first interior row
		for (let c = 1; c < N - 1; c++) {
			const prev = h[c - 1];
			const lo = Math.max(-10, prev - MAX_STEP_HEIGHT);
			const hi = Math.min(35, prev + MAX_STEP_HEIGHT);
			h[c] = lo + rand() * (hi - lo);
		}

		// Walk the left column — used as left constraint for each row
		for (let row = 1; row < N - 1; row++) {
			const prev = h[(row - 1) * N];
			const lo = Math.max(-10, prev - MAX_STEP_HEIGHT);
			const hi = Math.min(35, prev + MAX_STEP_HEIGHT);
			h[row * N] = lo + rand() * (hi - lo);
		}

		// Generate interior vertices — every vertex constrained by both left and upper neighbour
		for (let row = 1; row < N - 1; row++) {
			for (let c = 1; c < N - 1; c++) {
				let lo = -10,
					hi = 35;
				const left = h[row * N + c - 1];
				lo = Math.max(lo, left - MAX_STEP_HEIGHT);
				hi = Math.min(hi, left + MAX_STEP_HEIGHT);
				const above = h[(row - 1) * N + c];
				lo = Math.max(lo, above - MAX_STEP_HEIGHT);
				hi = Math.min(hi, above + MAX_STEP_HEIGHT);
				h[row * N + c] = lo > hi ? (lo + hi) / 2 : lo + rand() * (hi - lo);
			}
		}
		// Set border vertices above their adjacent interior neighbour
		for (let c = 0; c < N; c++) {
			h[0 * N + c] = h[1 * N + c] + BORDER_RAISE;
			h[(N - 1) * N + c] = h[(N - 2) * N + c] + BORDER_RAISE;
		}
		for (let r = 0; r < N; r++) {
			h[r * N + 0] = h[r * N + 1] + BORDER_RAISE;
			h[r * N + (N - 1)] = h[r * N + (N - 2)] + BORDER_RAISE;
		}
		return h;
	}

	const textureLoader = new THREE.TextureLoader();
	function loadTex(path: string, srgb = false): THREE.Texture {
		const tex = textureLoader.load(path);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(60, 60);
		if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	const grassColorMap = loadTex('/textures/Grass006_1K-JPG_Color.jpg', true);
	const grassNormalMap = loadTex('/textures/Grass006_1K-JPG_NormalGL.jpg');
	const grassRoughnessMap = loadTex('/textures/Grass006_1K-JPG_Roughness.jpg');

	const sandColorMap = loadTex('/textures/Ground079L_1K-JPG_Color.jpg', true);
	const sandNormalMap = loadTex('/textures/Ground079L_1K-JPG_NormalGL.jpg');
	const sandRoughnessMap = loadTex('/textures/Ground079L_1K-JPG_Roughness.jpg');

	const snowColorMap = loadTex('/textures/Snow010A_1K-JPG_Color.jpg', true);
	const snowNormalMap = loadTex('/textures/Snow010A_1K-JPG_NormalGL.jpg');
	const snowRoughnessMap = loadTex('/textures/Snow010A_1K-JPG_Roughness.jpg');

	const terrainMaterial = new THREE.MeshStandardMaterial({
		vertexColors: true,
		map: grassColorMap,
		normalMap: grassNormalMap,
		roughnessMap: grassRoughnessMap,
		normalScale: new THREE.Vector2(0.8, 0.8)
	});

	// Three-way biome blend via onBeforeCompile:
	//   sand  → grass: smoothstep(3, 5, h)
	//   grass → snow:  smoothstep(24, 27, h)
	terrainMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.sandColorMap = { value: sandColorMap };
		shader.uniforms.sandNormalMap = { value: sandNormalMap };
		shader.uniforms.sandRoughnessMap = { value: sandRoughnessMap };
		shader.uniforms.snowColorMap = { value: snowColorMap };
		shader.uniforms.snowNormalMap = { value: snowNormalMap };
		shader.uniforms.snowRoughnessMap = { value: snowRoughnessMap };

		shader.vertexShader = 'varying float vHeight;\n' + shader.vertexShader;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			'#include <begin_vertex>\nvHeight = position.y;'
		);

		shader.fragmentShader =
			'varying float vHeight;\n' +
			'uniform sampler2D sandColorMap;\n' +
			'uniform sampler2D sandNormalMap;\n' +
			'uniform sampler2D sandRoughnessMap;\n' +
			'uniform sampler2D snowColorMap;\n' +
			'uniform sampler2D snowNormalMap;\n' +
			'uniform sampler2D snowRoughnessMap;\n' +
			shader.fragmentShader;

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <map_fragment>',
			`#ifdef USE_MAP
	float grassBlend = smoothstep(3.0, 5.0, vHeight);
	float snowBlend = smoothstep(24.0, 27.0, vHeight);
	vec4 sandGrass = mix(texture2D(sandColorMap, vMapUv), texture2D(map, vMapUv), grassBlend);
	vec4 sampledDiffuseColor = mix(sandGrass, texture2D(snowColorMap, vMapUv), snowBlend);
	diffuseColor *= sampledDiffuseColor;
#endif`
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <roughnessmap_fragment>',
			`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	float grassBlendR = smoothstep(3.0, 5.0, vHeight);
	float snowBlendR = smoothstep(24.0, 27.0, vHeight);
	float sandGrassR = mix(texture2D(sandRoughnessMap, vMapUv).g, texture2D(roughnessMap, vMapUv).g, grassBlendR);
	roughnessFactor *= mix(sandGrassR, texture2D(snowRoughnessMap, vMapUv).g, snowBlendR);
#endif`
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			`#ifdef USE_NORMALMAP_TANGENTSPACE
	float grassBlendN = smoothstep(3.0, 5.0, vHeight);
	float snowBlendN = smoothstep(24.0, 27.0, vHeight);
	vec3 sandGrassN = mix(texture2D(sandNormalMap, vNormalMapUv).xyz, texture2D(normalMap, vNormalMapUv).xyz, grassBlendN);
	vec3 mapN = mix(sandGrassN, texture2D(snowNormalMap, vNormalMapUv).xyz, snowBlendN) * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize(tbn * mapN);
#endif`
		);
	};

	onDestroy(() => {
		sheetGeo.dispose();
		sheetMats.forEach((m) => m.dispose());
		terrainGeo.dispose();
		terrainMaterial.dispose();
		[
			grassColorMap,
			grassNormalMap,
			grassRoughnessMap,
			sandColorMap,
			sandNormalMap,
			sandRoughnessMap,
			snowColorMap,
			snowNormalMap,
			snowRoughnessMap
		].forEach((t) => t.dispose());
	});

	let heights: Float32Array<ArrayBufferLike>;
	let terrainGeo = $state(new THREE.PlaneGeometry());

	function getTerrainHeight(wx: number, wz: number): number {
		const cellSize = WORLD_SIZE / GRID_SEGS;
		const col = (wx + WORLD_SIZE / 2) / cellSize;
		const row = (wz + WORLD_SIZE / 2) / cellSize;
		const c0 = Math.floor(col),
			c1 = c0 + 1;
		const r0 = Math.floor(row),
			r1 = r0 + 1;
		if (c0 < 0 || r0 < 0 || c1 >= N || r1 >= N) return 0;
		const fc = col - c0,
			fr = row - r0;
		const h00 = heights[r0 * N + c0],
			h10 = heights[r0 * N + c1];
		const h01 = heights[r1 * N + c0],
			h11 = heights[r1 * N + c1];
		return h00 * (1 - fc) * (1 - fr) + h10 * fc * (1 - fr) + h01 * (1 - fc) * fr + h11 * fc * fr;
	}

	setContext('getTerrainHeight', getTerrainHeight);

	function isInBounds(wx: number, wz: number): boolean {
		const cellSize = WORLD_SIZE / GRID_SEGS;
		const col = (wx + WORLD_SIZE / 2) / cellSize;
		const row = (wz + WORLD_SIZE / 2) / cellSize;
		const c0 = Math.floor(col),
			c1 = c0 + 1;
		const r0 = Math.floor(row),
			r1 = r0 + 1;
		return c0 >= 0 && r0 >= 0 && c1 < N && r1 < N;
	}
	setContext('isInBounds', isInBounds);

	// Stable array of trunk colliders, updated in initGame(); Tank reads this every frame.
	const treeTrunks: TreeTrunk[] = [];
	setContext('treeTrunks', treeTrunks);

	// Stable array of tree bounding cylinders for shell hit detection.
	// canopyR = widest foliage tier radius; top = world Y of tree apex.
	const treeVolumes: TreeVol[] = [];

	// Spatial grid for tree volumes — shell queries only the 3×3 cells around its XZ position
	// instead of scanning every tree. Cell size >> max canopyR (2.7) so one cell of padding suffices.
	const TREE_GRID_CELL = 50;
	const treeVolumeGrid = new Map<string, TreeVol[]>();

	function forNearbyTreeVolumes(
		x: number,
		z: number,
		fn: (vol: TreeVol) => boolean
	): void {
		const gx = Math.floor(x / TREE_GRID_CELL);
		const gz = Math.floor(z / TREE_GRID_CELL);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dz = -1; dz <= 1; dz++) {
				const cell = treeVolumeGrid.get(`${gx + dx},${gz + dz}`);
				if (!cell) continue;
				for (const vol of cell) {
					if (fn(vol)) return;
				}
			}
		}
	}
	setContext('forNearbyTreeVolumes', forNearbyTreeVolumes);

	// Mirror of Tree.svelte's layer stacking — returns height of tree apex above its base.
	function treeApexHeight(scale: number, numLayers: number): number {
		const baseH = 2.5 * scale;
		let layerBaseY = 3.5 * scale * 0.6; // trunkH * 0.6
		let topY = 0;
		for (let i = 0; i < numLayers; i++) {
			const h = baseH * (1 - i * 0.22);
			topY = layerBaseY + h;
			layerBaseY += h * 0.52;
		}
		return topY;
	}

	// Stable array of live tank bodies, one entry per Tank instance.
	// Each Tank pushes its own entry on mount and keeps it updated every physics frame.
	// pushVx/pushVz accumulate impulses written by colliding tanks; the owner applies and decays them.
	// hitAt is set by Shell when a shell strikes the tank; Tank watches it to trigger fire+explosion.
	const tankBodies: TankBody[] = [];
	setContext('tankBodies', tankBodies);

	// Non-reactive map: localIndex → latest received TankSnapshot.
	// Tank.svelte reads this each frame in remote mode; Scene updates it from network messages.
	const remoteStateMap = new Map<number, TankSnapshot>();
	setContext('remoteStateMap', remoteStateMap);

	// Phantom bodies for guest tanks (host only): keep their positions in tankBodies so shells
	// can detect hits against them. Keyed by relay tankIndex.
	const phantomBodies = new Map<number, TankBody>();

	// Shell position tracker — Shell writes its live position here; Tank camera reads it when zoomed.
	// Scene nulls it out and dispatches 'shell-sequence-done' when the full sequence ends.
	const shellFollow: ShellFollow = { pos: null };
	setContext('shellFollow', shellFollow);
	let trackedExplosionId: number | null = null;

	// Shell sequence counter — each client gives its own shells a unique ID by offsetting from
	// selfRelayIndex * 100000, so host and guest IDs can't collide.
	const _selfRelayIndex = untrack(() => selfRelayIndex);
	let _isHost = untrack(() => isHost);
	const _passedRelayToLocal = untrack(() => relayToLocal);
	const _isMultiplayer = _passedRelayToLocal !== null;
	// Stable self-client ID for host-migration comparison (only meaningful in multiplayer)
	const _selfClientId = _isMultiplayer ? (untrack(() => mp.clientId) ?? '') : '';

	// Build full relay↔local maps covering all tanks (humans AND AI).
	// Human player mappings come from the prop; AI tanks fill remaining relay indices in order,
	// matching the iteration order in +page.svelte's buildGameSetup() so all machines agree.
	const fullRelayToLocal = new Map<number, number>();
	const fullLocalToRelay = new Map<number, number>();
	if (_passedRelayToLocal) {
		for (const [ri, li] of _passedRelayToLocal.entries()) {
			fullRelayToLocal.set(ri, li);
			fullLocalToRelay.set(li, ri);
		}
		let nextLI = 1;
		for (let ri = 0; ri < TANK_COUNT; ri++) {
			if (fullRelayToLocal.has(ri)) continue;
			while (fullLocalToRelay.has(nextLI)) nextLI++;
			fullRelayToLocal.set(ri, nextLI);
			fullLocalToRelay.set(nextLI, ri);
			nextLI++;
		}
	}

	let nextShellId = _selfRelayIndex * 100000;

	const CRATER_DEPTH = 0.75;
	// Terrain save/restore — keyed by game seed so reloading the same game recovers the state.
	// Only height and colour changes are tracked (colour only changes on craters).
	const TERRAIN_SAVE_KEY = `terrain_${gameSeed}`;
	const TERRAIN_SAVE_INTERVAL = 8000; // ms between localStorage writes
	const TERRAIN_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours — older saves are pruned on game start
	// Set of vertex indices that differ from the seeded initial state
	const dirtyVertices = new Set<number>();

	function saveTerrainState() {
		if (!browser || dirtyVertices.size === 0) return;
		const colAttr = terrainGeo.attributes.color as THREE.BufferAttribute;
		const entries: [number, number, number, number, number][] = [];
		for (const i of dirtyVertices) {
			entries.push([i, heights[i], colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i)]);
		}
		try {
			localStorage.setItem(TERRAIN_SAVE_KEY, JSON.stringify({ ts: Date.now(), vertices: entries }));
		} catch {
			// Storage quota exceeded — ignore
		}
	}

	function restoreTerrainState() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(TERRAIN_SAVE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as { ts: number; vertices: [number, number, number, number, number][] };
			const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
			const colAttr = terrainGeo.attributes.color as THREE.BufferAttribute;
			for (const [i, h, r, g, b] of parsed.vertices) {
				if (i < 0 || i >= posAttr.count) continue;
				heights[i] = h;
				posAttr.setY(i, h);
				colAttr.setXYZ(i, r, g, b);
				dirtyVertices.add(i);
			}
			posAttr.needsUpdate = true;
			colAttr.needsUpdate = true;
			terrainGeo.computeVertexNormals();
		} catch {
			// Malformed save data — ignore
		}
	}

	// Remove terrain saves for other seeds that are older than TERRAIN_MAX_AGE.
	// Never removes the current seed's entry — that belongs to this game.
	function pruneOldTerrainSaves() {
		if (!browser) return;
		const cutoff = Date.now() - TERRAIN_MAX_AGE;
		const toRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith('terrain_') || key === TERRAIN_SAVE_KEY) continue;
			try {
				const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as { ts?: number };
				if (!parsed.ts || parsed.ts < cutoff) toRemove.push(key);
			} catch {
				toRemove.push(key); // unparseable — remove it
			}
		}
		for (const key of toRemove) localStorage.removeItem(key);
	}

	function updateSheetPositions() {
		for (const s of landedSheets) {
			s.y = getTerrainHeight(s.x, s.z) + s.sz * 0.5;
		}
	}

	function deformTerrain(wx: number, wz: number) {
		const cellSize = WORLD_SIZE / GRID_SEGS;
		const col = Math.round((wx + WORLD_SIZE / 2) / cellSize);
		const row = Math.round((wz + WORLD_SIZE / 2) / cellSize);
		if (row < 0 || row >= N || col < 0 || col >= N) return;
		const i = row * N + col;
		const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
		const colAttr = terrainGeo.attributes.color as THREE.BufferAttribute;
		heights[i] -= CRATER_DEPTH;
		posAttr.setY(i, heights[i]);
		colAttr.setXYZ(i, 0.08, 0.06, 0.05);
		posAttr.needsUpdate = true;
		colAttr.needsUpdate = true;
		dirtyVertices.add(i);
		terrainGeo.computeVertexNormals();
		updateSheetPositions();
	}

	function raiseTerrain(wx: number, wz: number, amount: number) {
		const cellSize = WORLD_SIZE / GRID_SEGS;
		const col = Math.round((wx + WORLD_SIZE / 2) / cellSize);
		const row = Math.round((wz + WORLD_SIZE / 2) / cellSize);
		if (row < 0 || row >= N || col < 0 || col >= N) return;
		const i = row * N + col;
		const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
		heights[i] += amount;
		posAttr.setY(i, heights[i]);
		posAttr.needsUpdate = true;
		dirtyVertices.add(i);
		terrainGeo.computeVertexNormals();
		updateSheetPositions();
	}

	interface TreeSpec {
		id: number;
		x: number;
		y: number;
		z: number;
		scale: number;
		rotation: number;
		numLayers: number;
		colorIndex: number;
		burntAt: number | null;
	}
	let trees = $state<TreeSpec[]>([]);
	let nextTreeId = 0;

	interface ShellInstance {
		id: number;
		position: THREE.Vector3;
		velocity: THREE.Vector3;
		tracked: boolean; // true only for the player-controlled tank's shells
		firingBodyUid: number; // UID of firing tank body — compared with body.uid (not a reference, avoids Svelte proxy identity issues)
		isHost: boolean; // false for visual-only shells received from network
		aiDetectorOnly?: boolean; // host-side physics copy of a guest shell — only detects AI hits, sends no relay messages
	}
	let shells = $state<ShellInstance[]>([]);

	function handlePlayerFire(
		position: THREE.Vector3,
		velocity: THREE.Vector3,
		firingBodyUid: number
	) {
		const id = nextShellId++;
		shells.push({ id, position, velocity, tracked: true, firingBodyUid, isHost: true });
		trackedExplosionId = null;
		if (_isMultiplayer) {
			send({
				type: 'shell_fired',
				shellId: id,
				x: position.x, y: position.y, z: position.z,
				vx: velocity.x, vy: velocity.y, vz: velocity.z,
				tracked: false, // not tracked on other clients
				firingBodyUid
			});
		}
	}

	function handleOpponentFire(
		position: THREE.Vector3,
		velocity: THREE.Vector3,
		firingBodyUid: number
	) {
		const id = nextShellId++;
		shells.push({ id, position, velocity, tracked: false, firingBodyUid, isHost: true });
		if (_isMultiplayer && _isHost) {
			send({
				type: 'shell_fired',
				shellId: id,
				x: position.x, y: position.y, z: position.z,
				vx: velocity.x, vy: velocity.y, vz: velocity.z,
				tracked: false, firingBodyUid
			});
		}
	}

	// Shell hit a tank — decide locally vs relay depending on who owns the hit tank.
	// Called for shells with isHost=true (own shells, AI shells, host's aiDetectorOnly copies excluded).
	// Routes the hit: human remote player → relay; AI on this host → direct; AI on non-host → drop
	// (the host's aiDetectorOnly physics copy of the same shell handles it directly).
	function handleShellTankHit(bodyUid: number, dist: number, wx: number, wz: number) {
		const body = tankBodies.find((b) => b.uid === bodyUid);
		if (!body) return;
		if (_isMultiplayer && body.relayIndex >= 0 && body.relayIndex !== _selfRelayIndex) {
			const isHuman = _passedRelayToLocal?.has(body.relayIndex) ?? false;
			if (isHuman) {
				// Remote human player — relay so they apply damage locally
				send({ type: 'tank_hit', tankIndex: body.relayIndex, hitDist: dist, wx, wz });
			} else if (_isHost) {
				// AI tank, we are host — apply directly
				body.lastHit = { dist, wx, wz };
			}
			// Non-host hitting AI: drop — the host's aiDetectorOnly copy of this shell handles it
		} else {
			// Own tank (self-hit after grace) → write directly
			body.lastHit = { dist, wx, wz };
		}
	}

	// Called only for the host's aiDetectorOnly copies of guest shells.
	// Detects AI hits without relay; human tanks are intentionally skipped
	// (the guest's own shell handles those via tank_hit).
	function handleAiOnlyTankHit(bodyUid: number, dist: number, wx: number, wz: number) {
		const body = tankBodies.find((b) => b.uid === bodyUid);
		if (!body || body.hitAt !== null || body.lastHit !== null) return;
		if (_passedRelayToLocal?.has(body.relayIndex)) return; // human — guest handles
		if (body.relayIndex === _selfRelayIndex) return; // own tank
		body.lastHit = { dist, wx, wz };
	}

	function removeShell(id: number) {
		const shell = shells.find((s) => s.id === id);
		const wasTracked = shell?.tracked ?? false;
		// aiDetectorOnly shells are the host's private physics copies — they never send relay messages
		const wasLocalShell = (shell?.isHost ?? false) && !(shell?.aiDetectorOnly ?? false);
		shells = shells.filter((s) => s.id !== id);
		// Broadcast removal so other clients unmount their visual copy
		if (_isMultiplayer && wasLocalShell) {
			send({ type: 'shell_removed', shellId: id });
		}
		// OOB exit: shell left bounds with no explosion — end sequence now
		if (wasTracked && trackedExplosionId === null) {
			shellFollow.pos = null;
			window.dispatchEvent(new CustomEvent('shell-sequence-done'));
		}
	}

	interface ExplodeInstance {
		id: number;
		position: THREE.Vector3;
		tankExplosion: boolean;
		color?: string;
	}
	let explosions = $state<ExplodeInstance[]>([]);
	let nextExplodeId = 0;

	interface SheetData {
		id: number;
		x: number;
		y: number;
		z: number;
		rx: number;
		ry: number;
		rz: number;
		sx: number;
		sy: number;
		sz: number;
		color: string;
	}
	let landedSheets = $state<SheetData[]>([]);
	let nextSheetId = 0;

	const sheetGeo = new THREE.BoxGeometry(1, 1, 1);
	const sheetMats = new Map<string, THREE.MeshStandardMaterial>();
	function getSheetMat(color: string): THREE.MeshStandardMaterial {
		if (!sheetMats.has(color)) {
			sheetMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.8 }));
		}
		return sheetMats.get(color)!;
	}

	const IGNITION_RADIUS = 10;
	const SPLASH_RADIUS = 5; // explosion splash damage radius for nearby tanks

	function handleImpact(position: THREE.Vector3, tracked: boolean) {
		deformTerrain(position.x, position.z);
		const now = Date.now();
		const ignitedTreeIds: number[] = [];
		for (const t of trees) {
			if (t.burntAt != null) continue;
			const dx = t.x - position.x;
			const dz = t.z - position.z;
			if (dx * dx + dz * dz < IGNITION_RADIUS * IGNITION_RADIUS) {
				t.burntAt = now;
				ignitedTreeIds.push(t.id);
			}
		}
		// Splash damage
		for (const body of tankBodies) {
			if (body.hitAt !== null) continue;
			if (body.lastHit !== null) continue;
			const dx = body.x - position.x;
			const dz = body.z - position.z;
			if (dx * dx + dz * dz < SPLASH_RADIUS * SPLASH_RADIUS) {
				if (_isMultiplayer && body.relayIndex >= 0 && body.relayIndex !== _selfRelayIndex) {
					const isHuman = _passedRelayToLocal?.has(body.relayIndex) ?? false;
					if (!isHuman && _isHost) {
						body.lastHit = { dist: 0, wx: position.x, wz: position.z, splash: true };
					} else {
						send({ type: 'tank_hit', tankIndex: body.relayIndex, hitDist: 0, wx: position.x, wz: position.z, splash: true });
					}
				} else {
					body.lastHit = { dist: 0, wx: position.x, wz: position.z, splash: true };
				}
			}
		}
		const id = nextExplodeId++;
		explosions.push({ id, position, tankExplosion: false });
		if (_isMultiplayer) {
			send({ type: 'explosion', x: position.x, y: position.y, z: position.z, tankExplosion: false, color: '' });
			for (const tid of ignitedTreeIds) send({ type: 'tree_ignited', treeId: tid });
		}
		if (tracked) {
			trackedExplosionId = id;
			shellFollow.pos = position.clone();
		}
	}

	function removeExplosion(id: number) {
		explosions = explosions.filter((e) => e.id !== id);
		if (id === trackedExplosionId) {
			trackedExplosionId = null;
			shellFollow.pos = null;
			window.dispatchEvent(new CustomEvent('shell-sequence-done'));
		}
	}

	function handleTankExplosion(position: THREE.Vector3, color: string) {
		deformTerrain(position.x, position.z);
		const now = Date.now();
		const ignitedTreeIds: number[] = [];
		for (const t of trees) {
			if (t.burntAt != null) continue;
			const dx = t.x - position.x;
			const dz = t.z - position.z;
			if (dx * dx + dz * dz < IGNITION_RADIUS * IGNITION_RADIUS) {
				t.burntAt = now;
				ignitedTreeIds.push(t.id);
			}
		}
		explosions.push({ id: nextExplodeId++, position, tankExplosion: true, color });
		if (_isMultiplayer) {
			send({ type: 'explosion', x: position.x, y: position.y, z: position.z, tankExplosion: true, color });
			for (const tid of ignitedTreeIds) send({ type: 'tree_ignited', treeId: tid });
		}
	}

	let spawnPositions = $state<{ x: number; z: number; heading: number }[]>([]);
	let tankRef: { reset: (sx: number, sz: number, sh: number) => void; getState: (ri: number) => TankSnapshot } | undefined;
	// Opponent tank refs — used by host to read AI state for network broadcast
	const opponentTankRefs: Array<{ getState: (ri: number) => TankSnapshot } | undefined> = [];

	function initGame() {
		pruneOldTerrainSaves();
		// Compute spawn positions first so tree generation can avoid them.
		// Tanks sit on a circle at SPAWN_RADIUS, evenly spaced, with a random base
		// rotation each game for variety. Each position has up to 10% radial jitter.
		const baseAngle = rand() * Math.PI * 2;
		const jitter = SPAWN_RADIUS * 0.1;
		const newSpawns = Array.from({ length: TANK_COUNT }, (_, i) => {
			const angle = baseAngle + ((2 * Math.PI) / TANK_COUNT) * i;
			return {
				x: Math.cos(angle) * SPAWN_RADIUS + (rand() - 0.5) * 2 * jitter,
				z: Math.sin(angle) * SPAWN_RADIUS + (rand() - 0.5) * 2 * jitter,
				heading: -angle // CW tangent: 90° from outward radial, away from nearest edge
			};
		});
		spawnPositions = newSpawns;
		tankHealthData = Array.from({ length: TANK_COUNT }, (_, i) => ({
			health: 100,
			destroyed: false,
			color: tankColors[i] ?? TANK_COLORS[i] ?? TANK_COLORS[TANK_COLORS.length - 1],
			name: tankNames[i] ?? (i === 0 ? 'You' : `AI ${i}`)
		}));

		const prevGeo = terrainGeo;
		heights = generateHeights();
		// PlaneGeometry is in the XY plane; setting Z then rotating -90° around X
		// maps those Z values to world Y (height).
		terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID_SEGS, GRID_SEGS);
		const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
		for (let i = 0; i < posAttr.count; i++) {
			posAttr.setZ(i, heights[i]);
		}
		posAttr.needsUpdate = true;
		terrainGeo.rotateX(-Math.PI / 2);
		terrainGeo.computeVertexNormals();

		// Vertex colours by height
		const colorsArr = new Float32Array(posAttr.count * 3);
		for (let i = 0; i < posAttr.count; i++) {
			const h = heights[i];
			let r: number, g: number, b: number;
			if (h < 0) {
				r = 0.2;
				g = 0.45;
				b = 0.85;
			} // underwater blue tint
			else {
				r = 1;
				g = 1;
				b = 1;
			} // let texture show naturally
			colorsArr[i * 3] = r;
			colorsArr[i * 3 + 1] = g;
			colorsArr[i * 3 + 2] = b;
		}
		terrainGeo.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
		prevGeo?.dispose();
		dirtyVertices.clear();
		// Restore terrain modifications from a previous session with the same seed
		restoreTerrainState();

		// Place trees in green zone (height 5–23, gentle slope, away from spawn)
		const newTrees: TreeSpec[] = [];
		const TREE_SPACING = 80;
		for (
			let wx = -WORLD_SIZE / 2 + TREE_SPACING;
			wx < WORLD_SIZE / 2 - TREE_SPACING;
			wx += TREE_SPACING
		) {
			for (
				let wz = -WORLD_SIZE / 2 + TREE_SPACING;
				wz < WORLD_SIZE / 2 - TREE_SPACING;
				wz += TREE_SPACING
			) {
				const jx = wx + (rand() - 0.5) * TREE_SPACING * 0.8;
				const jz = wz + (rand() - 0.5) * TREE_SPACING * 0.8;
				const h = getTerrainHeight(jx, jz);
				if (h < 5 || h > 23) continue;
				const eps = 3;
				const dhdx = (getTerrainHeight(jx + eps, jz) - getTerrainHeight(jx - eps, jz)) / (2 * eps);
				const dhdz = (getTerrainHeight(jx, jz + eps) - getTerrainHeight(jx, jz - eps)) / (2 * eps);
				if (Math.sqrt(dhdx * dhdx + dhdz * dhdz) > 0.5) continue;
				if (newSpawns.some((s) => (jx - s.x) ** 2 + (jz - s.z) ** 2 < SPAWN_CLEAR ** 2)) continue;
				newTrees.push({
					id: nextTreeId++,
					x: jx,
					y: h,
					z: jz,
					scale: 0.6 + rand() * 0.9,
					rotation: rand() * Math.PI * 2,
					numLayers: 2 + Math.floor(rand() * 3),
					colorIndex: Math.floor(rand() * 5),
					burntAt: null
				});
			}
		}
		trees = newTrees;
		treeTrunks.length = 0;
		treeVolumes.length = 0;
		treeVolumeGrid.clear();
		for (const t of newTrees) {
			treeTrunks.push({ x: t.x, z: t.z, r: 0.18 * t.scale });
			const vol: TreeVol = {
				x: t.x,
				z: t.z,
				y: t.y,
				top: t.y + treeApexHeight(t.scale, t.numLayers),
				canopyR: 1.8 * t.scale
			};
			treeVolumes.push(vol);
			const key = `${Math.floor(t.x / TREE_GRID_CELL)},${Math.floor(t.z / TREE_GRID_CELL)}`;
			let cell = treeVolumeGrid.get(key);
			if (!cell) { cell = []; treeVolumeGrid.set(key, cell); }
			cell.push(vol);
		}

		shells = [];
		explosions = [];
		landedSheets = [];
		const playerSpawn = newSpawns[_selfRelayIndex] ?? newSpawns[0];
		tankRef?.reset(playerSpawn.x, playerSpawn.z, playerSpawn.heading);
	}

	initGame();

	let stateInterval: ReturnType<typeof setInterval> | null = null;
	let saveInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Periodically persist any terrain modifications to localStorage
		saveInterval = setInterval(saveTerrainState, TERRAIN_SAVE_INTERVAL);

		if (!_isMultiplayer) return;

		setGameHandlers({
			onTankState(snapshot) {
				// Ignore own state — we are the source of truth for our own tank
				if (snapshot.index === _selfRelayIndex) return;
				const localIdx = fullRelayToLocal.get(snapshot.index);
				if (localIdx === undefined) return;
				remoteStateMap.set(localIdx, snapshot);
				// Host: maintain phantom body so shell hit detection covers guest positions
				if (_isHost) {
					let pb = phantomBodies.get(snapshot.index);
					if (!pb) {
						pb = {
							uid: snapshot.index, // unique enough — relay indices are small integers
							relayIndex: snapshot.index,
							x: snapshot.x,
							y: snapshot.y,
							z: snapshot.z,
							pushVx: 0,
							pushVz: 0,
							hitAt: snapshot.destroyed ? Date.now() : null,
							lastHit: null,
							lastShellImpact: null
						};
						phantomBodies.set(snapshot.index, pb);
						tankBodies.push(pb);
					} else {
						pb.x = snapshot.x;
						pb.y = snapshot.y;
						pb.z = snapshot.z;
						if (snapshot.destroyed && pb.hitAt === null) pb.hitAt = Date.now();
					}
				}
			},
			onTankHit(tankIndex, hitDist, wx, wz, splash) {
				// Direct shell hits on AI are handled by the host's aiDetectorOnly physics copies.
				// This handler only needs to act when this client's own tank is hit.
				if (tankIndex !== _selfRelayIndex) return;
				const body = tankBodies.find((b) => b.relayIndex === _selfRelayIndex);
				if (body && body.hitAt === null && body.lastHit === null)
					body.lastHit = { dist: hitDist, wx, wz, splash };
			},
			onShellFired(shellId, x, y, z, vx, vy, vz, firingBodyUid) {
				// Host creates a physics copy (aiDetectorOnly) to detect AI hits without relay.
				// Non-host clients get a visual-only shell (isHost=false).
				shells.push({
					id: shellId,
					position: new THREE.Vector3(x, y, z),
					velocity: new THREE.Vector3(vx, vy, vz),
					tracked: false,
					firingBodyUid: firingBodyUid ?? -1,
					isHost: _isHost,
					aiDetectorOnly: _isHost
				});
			},
			onShellRemoved(shellId) {
				removeShell(shellId);
			},
			onExplosion(x, y, z, tankExplosion, color) {
				// Deform terrain locally to keep it in sync with the sender's world
				deformTerrain(x, z);
				explosions.push({
					id: nextExplodeId++,
					position: new THREE.Vector3(x, y, z),
					tankExplosion,
					color: color || undefined
				});
			},
			onTreeIgnited(treeId) {
				const tree = trees.find((t) => t.id === treeId);
				if (tree && tree.burntAt === null) tree.burntAt = Date.now();
			},
			onGameOver() {
				// Tank state updates will drive tankHealthData naturally; nothing extra needed here.
			},
			onTransferHost(newHostClientId: string) {
				if (newHostClientId !== _selfClientId) return;
				_isHost = true;
				// Release AI tanks from remote mode so their useTask runs local AI physics.
				// Human player entries stay in remoteStateMap — we still interpolate their positions.
				for (const [ri, li] of fullRelayToLocal.entries()) {
					if (_passedRelayToLocal?.has(ri)) continue; // human player — keep remote mode
					remoteStateMap.delete(li);
				}
			}
		});

		// Broadcast own tank state at TANK_STATE_HZ; host additionally broadcasts AI states
		stateInterval = setInterval(() => {
			if (!tankRef) return;
			const state = tankRef.getState(_selfRelayIndex);
			send({ type: 'tank_state', ...state });

			if (_isHost) {
				for (let i = 0; i < opponentTankRefs.length; i++) {
					const ref = opponentTankRefs[i];
					if (!ref) continue;
					const localIdx = i + 1;
					const ri = fullLocalToRelay.get(localIdx);
					if (ri === undefined) continue;
					// Only broadcast tanks not covered by a remote player (i.e. AI tanks)
					if (_passedRelayToLocal && _passedRelayToLocal.has(ri)) continue;
					const aiState = ref.getState(ri);
					send({ type: 'tank_state', ...aiState });
				}
			}
		}, 1000 / TANK_STATE_HZ);
	});

	let _quitting = false;

	// Called by the Quit button before navigation — signals onDestroy to remove rather than save.
	export function quitGame() {
		_quitting = true;
	}

	onDestroy(() => {
		setGameHandlers(null);
		if (stateInterval !== null) clearInterval(stateInterval);
		if (saveInterval !== null) clearInterval(saveInterval);
		if (_quitting) {
			localStorage.removeItem(TERRAIN_SAVE_KEY);
		} else {
			saveTerrainState(); // reload path — preserve crater state
		}
	});
</script>

<T.Mesh geometry={terrainGeo} receiveShadow castShadow>
	<T is={terrainMaterial} attach="material" />
</T.Mesh>

<!-- Water surface at y=0 — DoubleSide so it renders as a blue ceiling when camera is below -->
<T.Mesh rotation.x={-Math.PI / 2}>
	<T.PlaneGeometry args={[WATER_SIZE, WATER_SIZE]} />
	<T.MeshBasicMaterial color="#1a6fa8" transparent opacity={0.65} side={THREE.DoubleSide} />
</T.Mesh>

<!-- Skirts hanging below the water perimeter — same transparency as water surface so the
     blend with the background is identical whether the camera sees water or skirt -->
<T.Mesh position={[0, -WATER_SKIRT / 2, -WATER_SIZE / 2]}>
	<T.PlaneGeometry args={[WATER_SIZE, WATER_SKIRT]} />
	<T.MeshBasicMaterial color="#1a6fa8" transparent opacity={0.65} side={THREE.DoubleSide} />
</T.Mesh>
<T.Mesh position={[0, -WATER_SKIRT / 2, WATER_SIZE / 2]}>
	<T.PlaneGeometry args={[WATER_SIZE, WATER_SKIRT]} />
	<T.MeshBasicMaterial color="#1a6fa8" transparent opacity={0.65} side={THREE.DoubleSide} />
</T.Mesh>
<T.Mesh position={[-WATER_SIZE / 2, -WATER_SKIRT / 2, 0]} rotation.y={Math.PI / 2}>
	<T.PlaneGeometry args={[WATER_SIZE, WATER_SKIRT]} />
	<T.MeshBasicMaterial color="#1a6fa8" transparent opacity={0.65} side={THREE.DoubleSide} />
</T.Mesh>
<T.Mesh position={[WATER_SIZE / 2, -WATER_SKIRT / 2, 0]} rotation.y={Math.PI / 2}>
	<T.PlaneGeometry args={[WATER_SIZE, WATER_SKIRT]} />
	<T.MeshBasicMaterial color="#1a6fa8" transparent opacity={0.65} side={THREE.DoubleSide} />
</T.Mesh>

<Tank
	controlled
	chaseCamera
	{gameOver}
	tankColor={tankColors[0] ?? TANK_COLORS[0]}
	localIndex={0}
	relayIndex={_selfRelayIndex}
	spawnX={spawnPositions[_selfRelayIndex]?.x ?? 0}
	spawnZ={spawnPositions[_selfRelayIndex]?.z ?? 0}
	spawnHeading={spawnPositions[_selfRelayIndex]?.heading ?? 0}
	bind:this={tankRef}
	onfire={handlePlayerFire}
	onexplode={handleTankExplosion}
	onhealthchange={(h, d) => {
		if (tankHealthData[0]) { tankHealthData[0].health = h; tankHealthData[0].destroyed = d; }
	}}
/>

{#each Array.from({ length: TANK_COUNT - 1 }, (_, i) => i + 1) as localIdx (localIdx)}
	{@const ri = fullLocalToRelay.get(localIdx)}
	{@const sp = ri !== undefined ? spawnPositions[ri] : spawnPositions[localIdx]}
	<Tank
		tankColor={tankColors[localIdx] ?? TANK_COLORS[localIdx] ?? TANK_COLORS[TANK_COLORS.length - 1]}
		localIndex={localIdx}
		relayIndex={ri ?? -1}
		spawnX={sp?.x ?? 0}
		spawnZ={sp?.z ?? 0}
		spawnHeading={sp?.heading ?? 0}
		gameOver={allGameOver}
		onfire={handleOpponentFire}
		onexplode={handleTankExplosion}
		onhealthchange={(h, d) => {
			if (tankHealthData[localIdx]) { tankHealthData[localIdx].health = h; tankHealthData[localIdx].destroyed = d; }
		}}
		bind:this={opponentTankRefs[localIdx - 1]}
	/>
{/each}

{#each shells as s (s.id)}
	<Shell
		position={s.position}
		velocity={s.velocity}
		excludeBodyUid={s.firingBodyUid}
		tracked={s.tracked}
		isHost={s.isHost}
		onremove={() => removeShell(s.id)}
		onimpact={s.isHost && !s.aiDetectorOnly ? (pos) => handleImpact(pos, s.tracked) : undefined}
		ontankhit={s.isHost && _isMultiplayer
			? (s.aiDetectorOnly ? handleAiOnlyTankHit : handleShellTankHit)
			: undefined}
	/>
{/each}

{#each explosions as e (e.id)}
	<Explosion
		position={e.position}
		craterDepth={CRATER_DEPTH}
		tankExplosion={e.tankExplosion}
		debrisColor={e.color}
		onrockland={raiseTerrain}
		onsheetland={(x, y, z, rx, ry, rz, sx, sy, sz) => {
			landedSheets.push({
				id: nextSheetId++,
				x, y, z, rx, ry, rz, sx, sy, sz,
				color: e.color ?? '#4a3f38'
			});
		}}
		onremove={() => removeExplosion(e.id)}
	/>
{/each}

{#each landedSheets as s (s.id)}
	<T.Mesh
		geometry={sheetGeo}
		material={getSheetMat(s.color)}
		position={[s.x, s.y, s.z]}
		rotation={[s.rx, s.ry, s.rz]}
		scale={[s.sx, s.sy, s.sz]}
		receiveShadow
	/>
{/each}

{#each trees as t (t.id)}
	<Tree
		x={t.x}
		y={t.y}
		z={t.z}
		scale={t.scale}
		rotation={t.rotation}
		numLayers={t.numLayers}
		colorIndex={t.colorIndex}
		burntAt={t.burntAt}
	/>
{/each}
