<script lang="ts">
	import * as THREE from 'three';
	import { T, useThrelte } from '@threlte/core';
	import { setContext } from 'svelte';
	import Tank from '$lib/Tank.svelte';
	import Shell from '$lib/Shell.svelte';
	import Explosion from '$lib/Explosion.svelte';

	const { scene } = useThrelte();
	scene.background = new THREE.Color('#87CEEB');

	let { restartKey = 0 } = $props();

	// --- Terrain generation ---
	const GRID_SEGS = 100;
	const WORLD_SIZE = 500;
	const N = GRID_SEGS + 1;
	const MAX_STEP_HEIGHT = 2.8;
	const BORDER_RAISE = 6.5;

	function generateHeights(): Float32Array {
		const h = new Float32Array(N * N);
		// Generate interior vertices only
		for (let r = 1; r < N - 1; r++) {
			for (let c = 1; c < N - 1; c++) {
				let lo = -10,
					hi = 150;
				const left = h[r * N + c - 1];
				lo = Math.max(lo, left - MAX_STEP_HEIGHT);
				hi = Math.min(hi, left + MAX_STEP_HEIGHT);
				if (r > 1) {
					const v = h[(r - 1) * N + c];
					lo = Math.max(lo, v - MAX_STEP_HEIGHT);
					hi = Math.min(hi, v + MAX_STEP_HEIGHT);
				}
				h[r * N + c] = lo > hi ? (lo + hi) / 2 : lo + Math.random() * (hi - lo);
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

	const CRATER_DEPTH = 0.75;

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
		terrainGeo.computeVertexNormals();
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
		terrainGeo.computeVertexNormals();
	}

	interface ShellInstance {
		id: number;
		position: THREE.Vector3;
		velocity: THREE.Vector3;
	}
	let shells = $state<ShellInstance[]>([]);
	let nextShellId = 0;

	function handleFire(position: THREE.Vector3, velocity: THREE.Vector3) {
		shells.push({ id: nextShellId++, position, velocity });
	}

	function removeShell(id: number) {
		shells = shells.filter((s) => s.id !== id);
	}

	interface ExplodeInstance {
		id: number;
		position: THREE.Vector3;
	}
	let explosions = $state<ExplodeInstance[]>([]);
	let nextExplodeId = 0;

	function handleImpact(position: THREE.Vector3) {
		deformTerrain(position.x, position.z);
		explosions.push({ id: nextExplodeId++, position });
	}

	function removeExplosion(id: number) {
		explosions = explosions.filter((e) => e.id !== id);
	}

	let tankRef: { reset: () => void } | undefined;

	function initGame() {
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
				r = 0.1;
				g = 0.43;
				b = 0.66;
			} // water blue
			else if (h < 4) {
				r = 0.83;
				g = 0.71;
				b = 0.51;
			} // beach sand
			else if (h < 100) {
				r = 0.29;
				g = 0.49;
				b = 0.25;
			} // grass green
			else {
				r = 0.93;
				g = 0.94;
				b = 0.96;
			} // snow white
			colorsArr[i * 3] = r;
			colorsArr[i * 3 + 1] = g;
			colorsArr[i * 3 + 2] = b;
		}
		terrainGeo.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
		shells = [];
		explosions = [];
		tankRef?.reset();
	}

	initGame();

	$effect(() => {
		if (restartKey > 0) {
			restartKey = 0;
			initGame();
		}
	});
</script>

<T.Mesh geometry={terrainGeo} receiveShadow castShadow>
	<T.MeshStandardMaterial vertexColors />
</T.Mesh>

<!-- Water plane at sea level -->
<T.Mesh rotation.x={-Math.PI / 2} position.y={0}>
	<T.PlaneGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
	<T.MeshStandardMaterial color="#1a6fa8" transparent opacity={0.7} />
</T.Mesh>

<Tank controlled chaseCamera bind:this={tankRef} onfire={handleFire} />

{#each shells as s (s.id)}
	<Shell
		position={s.position}
		velocity={s.velocity}
		onremove={() => removeShell(s.id)}
		onimpact={handleImpact}
	/>
{/each}

{#each explosions as e (e.id)}
	<Explosion
		position={e.position}
		craterDepth={CRATER_DEPTH}
		onrockland={raiseTerrain}
		onremove={() => removeExplosion(e.id)}
	/>
{/each}
