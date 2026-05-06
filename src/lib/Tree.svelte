<script lang="ts">
	import * as THREE from 'three';
	import { T, useThrelte, useTask } from '@threlte/core';
	import { onDestroy } from 'svelte';

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

	// --- Fire effect — imperative Three.js, added directly to scene to skip Svelte reactivity ---
	const { scene } = useThrelte();

	// Anchor flames at the lowest (largest) foliage tier
	const firePosY = layerData[0].posY;

	const fireGroup = new THREE.Group();
	fireGroup.position.set(x, y, z);
	fireGroup.visible = false;

	interface FlameData {
		mesh: THREE.Mesh;
		mat: THREE.MeshStandardMaterial;
		phase: number;
	}

	// Flames grow super-linearly on larger trees: scale < 1 keeps proportions as-is,
	// scale > 1 gets an extra multiplier so big trees burn more dramatically.
	const flameBoost = Math.max(1, scale);

	const flameData: FlameData[] = [];
	for (let i = 0; i < 5; i++) {
		const central = i === 0;
		const coneR = (central ? baseR * 0.45 : baseR * (0.18 + Math.random() * 0.18)) * flameBoost;
		const coneH = (central ? baseH * 1.5 : baseH * (0.5 + Math.random() * 0.5)) * flameBoost;
		const geo = new THREE.ConeGeometry(coneR, coneH, 6);
		const warm = i % 2 === 0;
		const mat = new THREE.MeshStandardMaterial({
			color: warm ? 0xffaa00 : 0xff5500,
			emissive: warm ? 0xff6600 : 0xff2200,
			emissiveIntensity: 3,
			transparent: true,
			opacity: 0.9,
			depthWrite: false
		});
		const mesh = new THREE.Mesh(geo, mat);
		const spreadAngle = (i / 5) * Math.PI * 2;
		const spreadR = central ? 0 : baseR * 0.35 * flameBoost;
		mesh.position.set(
			Math.cos(spreadAngle) * spreadR,
			firePosY + coneH * 0.5,
			Math.sin(spreadAngle) * spreadR
		);
		fireGroup.add(mesh);
		flameData.push({ mesh, mat, phase: i * 1.257 }); // 2π/5
	}

	// Warm point light for fire glow — range and peak intensity scale with flameBoost
	const fireLight = new THREE.PointLight(0xff6600, 0, 22 * flameBoost, 2);
	fireLight.position.set(x, y + firePosY, z);

	scene.add(fireGroup);
	scene.add(fireLight);

	let fireTime = 0;
	let isBurnt = false;

	useTask((delta) => {
		if (burntAt === null || isBurnt) return;

		const elapsed = Date.now() - burntAt;
		const burnFraction = Math.min(elapsed / BURN_DURATION, 1);
		// Cubic falloff: stays near full intensity most of the burn, fades fast at the end
		const intensity = 1 - Math.pow(burnFraction, 3);

		if (!fireGroup.visible) fireGroup.visible = true;
		fireTime += delta;

		for (const f of flameData) {
			const flicker =
				0.7 +
				0.3 * Math.sin(fireTime * 8 + f.phase) +
				0.12 * Math.sin(fireTime * 19 + f.phase * 1.7);
			f.mesh.scale.y = flicker * (0.5 + 0.5 * intensity);
			f.mesh.scale.x = f.mesh.scale.z = 0.75 + 0.25 * Math.sin(fireTime * 5 + f.phase + 1.3);
			f.mat.opacity = (0.65 + 0.3 * Math.sin(fireTime * 13 + f.phase)) * intensity;
			f.mat.emissiveIntensity = 3 * intensity;
		}
		fireLight.intensity = (2.5 * flameBoost + Math.sin(fireTime * 7) * 0.5) * intensity;

		// Char colour progresses linearly so darkening is visible from the start of the burn
		const colorT = burnFraction;
		foliageMat.color.lerpColors(_origFoliage, _charFoliage, colorT);
		trunkMat.color.lerpColors(_origTrunk, _charTrunk, colorT);
		foliageMat.roughness = 0.85 + 0.15 * colorT;

		if (elapsed >= BURN_DURATION) {
			isBurnt = true;
			fireGroup.visible = false;
			fireLight.intensity = 0;
		}
	});

	onDestroy(() => {
		scene.remove(fireGroup);
		scene.remove(fireLight);
		for (const f of flameData) {
			f.mesh.geometry.dispose();
			f.mat.dispose();
		}
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
</T.Group>
