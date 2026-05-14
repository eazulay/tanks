<script lang="ts">
	import * as THREE from 'three';
	import { useTask, useThrelte } from '@threlte/core';
	import { onDestroy, untrack } from 'svelte';

	let {
		x,
		y,
		z,
		baseHeight = 0.5,
		burning = false,
		flameCount = 6,
		scale = 1.0,
		burnDuration = 0
	}: {
		x: number;
		y: number;
		z: number;
		baseHeight?: number;
		burning?: boolean;
		flameCount?: number;
		scale?: number;
		burnDuration?: number;
	} = $props();

	const _scale = untrack(() => scale);

	const { scene, renderer, camera } = useThrelte();

	interface FlameData {
		mesh: THREE.Mesh;
		mat: THREE.MeshStandardMaterial;
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
		const geo = new THREE.ConeGeometry(d.r * _scale, d.h * _scale, 6);
		const warm = Math.random() > 0.5;
		const mat = new THREE.MeshStandardMaterial({
			color: warm ? 0xffaa00 : 0xff5500,
			emissive: warm ? 0xff6600 : 0xff2200,
			emissiveIntensity: 2.0,
			transparent: true,
			opacity: 0.9,
			depthWrite: false
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(d.x * _scale, (d.h * _scale) / 2, d.z * _scale);
		flames.push({ mesh, mat, phase: d.phase, speed: 5 + Math.random() * 5 });
		group.add(mesh);
	}

	const light = new THREE.PointLight(0xff6600, 0, 22 * Math.max(1, _scale), 1.5);
	light.position.set(0, 2.5 * _scale, 0);
	group.add(light);
	group.visible = false;
	scene.add(group);

	const FADE_OUT = 1.5; // seconds to fade after burning stops

	let elapsed = 0;
	let fadeElapsed = 0;
	let isFading = false;
	let compiled = false;

	useTask((delta) => {
		if (!compiled && camera.current) {
			compiled = true;
			renderer.compile(group, camera.current);
		}

		if (burning) {
			if (isFading) isFading = false;
			elapsed += delta;
			if (!group.visible) group.visible = true;
		} else if (isFading) {
			elapsed += delta;
			fadeElapsed += delta;
			if (fadeElapsed >= FADE_OUT) {
				isFading = false;
				group.visible = false;
				elapsed = 0;
				return;
			}
		} else {
			if (group.visible) {
				// Transition: flames were on, start fading
				isFading = true;
				fadeElapsed = 0;
			} else {
				elapsed = 0;
				return;
			}
		}

		group.position.set(x, y + baseHeight, z);

		const burnIntensity =
			burnDuration > 0 ? Math.max(0, 1 - Math.pow(elapsed / burnDuration, 3)) : 1.0;
		const fadeMultiplier = isFading ? Math.max(0, 1 - fadeElapsed / FADE_OUT) : 1.0;
		const intensity = burnIntensity * fadeMultiplier;

		for (let i = 0; i < flames.length; i++) {
			const f = flames[i];
			if (i >= flameCount) {
				if (f.mesh.visible) f.mesh.visible = false;
				continue;
			}
			f.mesh.visible = true;
			const s1 = Math.sin(elapsed * f.speed + f.phase);
			const s2 = Math.sin(elapsed * f.speed * 1.7 + f.phase + 1.0);
			f.mesh.scale.y = (0.75 + 0.4 * s1) * (0.5 + 0.5 * intensity);
			f.mesh.scale.x = 0.65 + 0.35 * Math.abs(s2);
			f.mesh.scale.z = 0.65 + 0.35 * Math.abs(s2);
			f.mat.opacity = (0.65 + 0.3 * Math.sin(elapsed * 13 + f.phase)) * intensity;
			f.mat.emissiveIntensity = 2.0 * intensity;
		}
		light.intensity =
			7 * (0.7 + 0.3 * Math.sin(elapsed * 10)) * (flameCount / flames.length) * intensity;
	});

	onDestroy(() => {
		for (const f of flames) {
			f.mesh.geometry.dispose();
			f.mat.dispose();
		}
		scene.remove(group);
	});
</script>
