<script lang="ts">
	import * as THREE from 'three';
	import { useTask, useThrelte } from '@threlte/core';
	import { onDestroy } from 'svelte';

	let {
		x,
		y,
		z,
		baseHeight = 0.5,
		burning = false,
		flameCount = 6
	}: {
		x: number;
		y: number;
		z: number;
		baseHeight?: number;
		burning?: boolean;
		flameCount?: number;
	} = $props();

	const { scene } = useThrelte();

	interface FlameData {
		mesh: THREE.Mesh;
		phase: number;
		speed: number;
	}

	const defs = [
		{ x: 0, z: 0, h: 3.0, r: 0.32, phase: 0.0 },
		{ x: 0.8, z: 0.6, h: 1.8, r: 0.22, phase: 1.1 },
		{ x: -0.8, z: 0.6, h: 1.6, r: 0.2, phase: 2.3 },
		{ x: 0.7, z: -0.9, h: 2.1, r: 0.26, phase: 0.7 },
		{ x: -0.7, z: -0.9, h: 1.5, r: 0.19, phase: 1.9 },
		{ x: 0, z: 0.9, h: 1.4, r: 0.18, phase: 3.1 }
	];

	const group = new THREE.Group();
	const flames: FlameData[] = [];

	for (const d of defs) {
		const geo = new THREE.ConeGeometry(d.r, d.h, 6);
		const col = Math.random() > 0.5 ? '#ff8800' : '#ffcc00';
		const mat = new THREE.MeshBasicMaterial({
			color: col,
			transparent: true,
			opacity: 0.92,
			depthWrite: false
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(d.x, d.h / 2, d.z);
		flames.push({ mesh, phase: d.phase, speed: 5 + Math.random() * 5 });
		group.add(mesh);
	}

	const light = new THREE.PointLight(0xff6600, 0, 22, 1.5);
	light.position.set(0, 2.5, 0);
	group.add(light);
	group.visible = false;
	scene.add(group);

	let elapsed = 0;

	useTask((delta) => {
		if (!burning) {
			if (group.visible) group.visible = false;
			elapsed = 0;
			return;
		}
		group.visible = true;
		elapsed += delta;
		group.position.set(x, y + baseHeight, z);
		for (let i = 0; i < flames.length; i++) {
			const f = flames[i];
			if (i >= flameCount) {
				if (f.mesh.visible) f.mesh.visible = false;
				continue;
			}
			f.mesh.visible = true;
			const s1 = Math.sin(elapsed * f.speed + f.phase);
			const s2 = Math.sin(elapsed * f.speed * 1.7 + f.phase + 1.0);
			f.mesh.scale.y = 0.75 + 0.4 * s1;
			f.mesh.scale.x = 0.65 + 0.35 * Math.abs(s2);
			f.mesh.scale.z = 0.65 + 0.35 * Math.abs(s2);
		}
		light.intensity = 7 * (0.7 + 0.3 * Math.sin(elapsed * 10)) * (flameCount / flames.length);
	});

	onDestroy(() => {
		for (const f of flames) {
			f.mesh.geometry.dispose();
			(f.mesh.material as THREE.Material).dispose();
		}
		scene.remove(group);
	});
</script>
