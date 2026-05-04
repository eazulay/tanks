<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { getContext, onDestroy } from 'svelte';
	import Splash from './Splash.svelte';

	let {
		position,
		velocity,
		onremove,
		onimpact
	}: {
		position: THREE.Vector3;
		velocity: THREE.Vector3;
		onremove?: () => void;
		onimpact?: (position: THREE.Vector3) => void;
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const isInBounds: (wx: number, wz: number) => boolean = getContext('isInBounds');

	const GRAVITY = 10;
	const WATER_DRAG = 0.8; // fraction of velocity remaining after 1 s underwater

	const pos = position.clone();
	const vel = velocity.clone();
	let prevY = pos.y;

	const shellGeo = new THREE.CylinderGeometry(0.035, 0.055, 0.38, 8);
	const shellMat = new THREE.MeshStandardMaterial({
		color: '#c87830',
		metalness: 0.8,
		roughness: 0.3,
		emissive: '#7a3a08',
		emissiveIntensity: 0.4
	});

	onDestroy(() => {
		shellGeo.dispose();
		shellMat.dispose();
	});

	const _up = new THREE.Vector3(0, 1, 0);
	const _dir = new THREE.Vector3();
	const _q = new THREE.Quaternion();

	let groupRef: THREE.Group | null = null;
	let done = false;

	interface SplashEntry {
		id: number;
		x: number;
		z: number;
	}

	let splashes = $state<SplashEntry[]>([]);
	let nextSplashId = 0;

	function startSplash(x: number, z: number) {
		splashes.push({ id: nextSplashId++, x, z });
	}

	function removeSplash(id: number) {
		splashes = splashes.filter((s) => s.id !== id);
	}

	useTask((delta) => {
		// Shell hit terrain — keep task alive until splashes finish, then remove
		if (done) {
			if (splashes.length === 0) onremove?.();
			return;
		}

		// Physics
		if (isInBounds(pos.x, pos.z) && pos.y <= 0 && getTerrainHeight(pos.x, pos.z) < 0) {
			const drag = Math.pow(WATER_DRAG, delta);
			vel.x *= drag;
			vel.y *= drag;
			vel.z *= drag;
		}
		vel.y -= GRAVITY * delta;
		pos.x += vel.x * delta;
		pos.y += vel.y * delta;
		pos.z += vel.z * delta;

		// Out-of-bounds shells have no terrain-impact detection, so clean up by Y drop
		if (!isInBounds(pos.x, pos.z) && pos.y < position.y - 15) {
			onremove?.();
			return;
		}

		if (groupRef) {
			groupRef.position.set(pos.x, pos.y, pos.z);
			_dir.copy(vel).normalize();
			_q.setFromUnitVectors(_up, _dir);
			groupRef.quaternion.copy(_q);
		}

		if (isInBounds(pos.x, pos.z)) {
			// Splash on any crossing of the water surface (y=0) in a water area
			if (getTerrainHeight(pos.x, pos.z) < 0) {
				if ((prevY > 0 && pos.y <= 0) || (prevY <= 0 && pos.y > 0)) {
					startSplash(pos.x, pos.z);
				}
			}
			prevY = pos.y;

			const groundY = getTerrainHeight(pos.x, pos.z);
			if (pos.y <= groundY) {
				onimpact?.(pos.clone());
				done = true;
				if (groupRef) groupRef.visible = false;
				return;
			}
		}
	});
</script>

<T.Group
	oncreate={(ref) => {
		groupRef = ref;
	}}
	position={[position.x, position.y, position.z]}
>
	<T.Mesh castShadow geometry={shellGeo} material={shellMat} />
</T.Group>

{#each splashes as s (s.id)}
	<Splash x={s.x} z={s.z} onremove={() => removeSplash(s.id)} />
{/each}
