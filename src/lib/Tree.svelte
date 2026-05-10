<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { PositionalAudio } from '@threlte/extras';
	import { onDestroy } from 'svelte';
	import Flames from './Flames.svelte';

	let {
		x,
		y,
		z,
		scale = 1,
		rotation = 0,
		numLayers = 3,
		colorIndex = 0,
		burntAt = null as number | null
	}: {
		x: number;
		y: number;
		z: number;
		scale?: number;
		rotation?: number;
		numLayers?: number;
		colorIndex?: number;
		burntAt?: number | null;
	} = $props();

	const FOLIAGE_COLORS = [0x2d5a27, 0x3a7a34, 0x1e4a1a, 0x4a8c40, 0x2d6b2b];
	const BURN_DURATION = 60_000; // ms until flames die and tree is fully charred

	const trunkH = 3.5 * scale;
	const trunkR = 0.18 * scale;
	const baseR = 1.8 * scale;
	const baseH = 2.5 * scale;

	const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH, 7);
	const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.95 });

	interface LayerData {
		geo: THREE.ConeGeometry;
		posY: number;
	}

	const layerData: LayerData[] = [];
	let layerBaseY = trunkH * 0.6;
	for (let i = 0; i < numLayers; i++) {
		const f = 1 - i * 0.22;
		const r = baseR * f;
		const h = baseH * f;
		layerData.push({ geo: new THREE.ConeGeometry(r, h, 7), posY: layerBaseY + h / 2 });
		layerBaseY += h * 0.52;
	}

	const foliageMat = new THREE.MeshStandardMaterial({
		color: FOLIAGE_COLORS[colorIndex % FOLIAGE_COLORS.length],
		roughness: 0.85
	});

	// Scratch colors for per-frame lerp — created once to avoid GC pressure
	const _origFoliage = new THREE.Color(FOLIAGE_COLORS[colorIndex % FOLIAGE_COLORS.length]);
	const _origTrunk = new THREE.Color(0x5c3d1e);
	const _charFoliage = new THREE.Color(0x1c1206);
	const _charTrunk = new THREE.Color(0x0e0905);

	// Flames anchor at the lowest (largest) foliage tier
	const firePosY = layerData[0].posY;
	// Super-linear scale boost so big trees burn more dramatically
	const flameBoost = Math.max(1, scale);

	let isBurning = $state(false);
	let isBurnt = $state(false);
	let fireSoundVolume = $state(1.0);

	useTask(() => {
		if (burntAt === null || isBurnt) return;

		const elapsed = Date.now() - burntAt;
		const burnFraction = Math.min(elapsed / BURN_DURATION, 1);

		if (!isBurning) isBurning = true;
		fireSoundVolume = 1.0 - burnFraction;

		// Char colour progresses linearly so darkening is visible from the start
		foliageMat.color.lerpColors(_origFoliage, _charFoliage, burnFraction);
		trunkMat.color.lerpColors(_origTrunk, _charTrunk, burnFraction);
		foliageMat.roughness = 0.85 + 0.15 * burnFraction;

		if (elapsed >= BURN_DURATION) {
			isBurnt = true;
			isBurning = false;
		}
	});

	onDestroy(() => {
		trunkGeo.dispose();
		trunkMat.dispose();
		foliageMat.dispose();
		layerData.forEach((l) => l.geo.dispose());
	});
</script>

<T.Group position={[x, y, z]} rotation.y={rotation}>
	<T.Mesh geometry={trunkGeo} material={trunkMat} castShadow position.y={trunkH / 2} />
	{#each layerData as layer}
		<T.Mesh geometry={layer.geo} material={foliageMat} castShadow position.y={layer.posY} />
	{/each}
	{#if burntAt !== null && !isBurnt}
		<PositionalAudio
			src="/audio/tree-on-fire.mp3"
			loop
			autoplay
			volume={fireSoundVolume}
			refDistance={25}
			maxDistance={300}
		/>
	{/if}
</T.Group>
<Flames
	{x}
	{y}
	{z}
	baseHeight={firePosY}
	burning={isBurning}
	scale={flameBoost * scale}
	burnDuration={BURN_DURATION / 1000}
/>
