<script lang="ts">
	import * as THREE from 'three';
	import { T, useThrelte } from '@threlte/core';
	import { setContext, onDestroy } from 'svelte';
	import Tank from '$lib/Tank.svelte';
	import Shell from '$lib/Shell.svelte';
	import Explosion from '$lib/Explosion.svelte';
	import Tree from '$lib/Tree.svelte';

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
	const TANK_COUNT = 1;
	const SPAWN_RADIUS = (WORLD_SIZE / 2) * 0.8; // 300 units
	const SPAWN_CLEAR = 40; // no trees within this distance of a spawn point

	function generateHeights(): Float32Array {
		const h = new Float32Array(N * N);

		// Seed top-left corner at a random base elevation in [-10, 40]
		h[0] = Math.random() * 45 - 10;

		// Walk the top row — used as upper constraint for the first interior row
		for (let c = 1; c < N - 1; c++) {
			const prev = h[c - 1];
			const lo = Math.max(-10, prev - MAX_STEP_HEIGHT);
			const hi = Math.min(35, prev + MAX_STEP_HEIGHT);
			h[c] = lo + Math.random() * (hi - lo);
		}

		// Walk the left column — used as left constraint for each row
		for (let r = 1; r < N - 1; r++) {
			const prev = h[(r - 1) * N];
			const lo = Math.max(-10, prev - MAX_STEP_HEIGHT);
			const hi = Math.min(35, prev + MAX_STEP_HEIGHT);
			h[r * N] = lo + Math.random() * (hi - lo);
		}

		// Generate interior vertices — every vertex constrained by both left and upper neighbour
		for (let r = 1; r < N - 1; r++) {
			for (let c = 1; c < N - 1; c++) {
				let lo = -10,
					hi = 35;
				const left = h[r * N + c - 1];
				lo = Math.max(lo, left - MAX_STEP_HEIGHT);
				hi = Math.min(hi, left + MAX_STEP_HEIGHT);
				const above = h[(r - 1) * N + c];
				lo = Math.max(lo, above - MAX_STEP_HEIGHT);
				hi = Math.min(hi, above + MAX_STEP_HEIGHT);
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
	const treeTrunks: { x: number; z: number; r: number }[] = [];
	setContext('treeTrunks', treeTrunks);

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

	const IGNITION_RADIUS = 10;

	function handleImpact(position: THREE.Vector3) {
		deformTerrain(position.x, position.z);
		const now = Date.now();
		for (const t of trees) {
			if (t.burntAt != null) continue; // Already burnt
			const dx = t.x - position.x;
			const dz = t.z - position.z;
			if (dx * dx + dz * dz < IGNITION_RADIUS * IGNITION_RADIUS) t.burntAt = now;
		}
		explosions.push({ id: nextExplodeId++, position });
	}

	function removeExplosion(id: number) {
		explosions = explosions.filter((e) => e.id !== id);
	}

	let spawnPositions = $state<{ x: number; z: number; heading: number }[]>([]);
	let tankRef: { reset: (sx: number, sz: number, sh: number) => void } | undefined;

	function initGame() {
		// Compute spawn positions first so tree generation can avoid them.
		// Tanks sit on a circle at SPAWN_RADIUS, evenly spaced, with a random base
		// rotation each game for variety. Each position has up to 10% radial jitter.
		const baseAngle = Math.random() * Math.PI * 2;
		const jitter = SPAWN_RADIUS * 0.1;
		const newSpawns = Array.from({ length: TANK_COUNT }, (_, i) => {
			const angle = baseAngle + ((2 * Math.PI) / TANK_COUNT) * i;
			return {
				x: Math.cos(angle) * SPAWN_RADIUS + (Math.random() - 0.5) * 2 * jitter,
				z: Math.sin(angle) * SPAWN_RADIUS + (Math.random() - 0.5) * 2 * jitter,
				heading: -angle // CW tangent: 90° from outward radial, away from nearest edge
			};
		});
		spawnPositions = newSpawns;

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
				const jx = wx + (Math.random() - 0.5) * TREE_SPACING * 0.8;
				const jz = wz + (Math.random() - 0.5) * TREE_SPACING * 0.8;
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
					scale: 0.6 + Math.random() * 0.9,
					rotation: Math.random() * Math.PI * 2,
					numLayers: 2 + Math.floor(Math.random() * 3),
					colorIndex: Math.floor(Math.random() * 5),
					burntAt: null
				});
			}
		}
		trees = newTrees;
		treeTrunks.length = 0;
		for (const t of newTrees) treeTrunks.push({ x: t.x, z: t.z, r: 0.18 * t.scale });

		shells = [];
		explosions = [];
		tankRef?.reset(newSpawns[0].x, newSpawns[0].z, newSpawns[0].heading);
	}

	initGame();
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
	spawnX={spawnPositions[0]?.x ?? 0}
	spawnZ={spawnPositions[0]?.z ?? 0}
	spawnHeading={spawnPositions[0]?.heading ?? 0}
	bind:this={tankRef}
	onfire={handleFire}
/>

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
