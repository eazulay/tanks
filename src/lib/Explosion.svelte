<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { getContext, onDestroy } from 'svelte';

	let {
		position,
		craterDepth = 0.6,
		onrockland,
		onremove
	}: {
		position: THREE.Vector3;
		craterDepth?: number;
		onrockland?: (wx: number, wz: number, amount: number) => void;
		onremove?: () => void;
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const isInBounds: (wx: number, wz: number) => boolean = getContext('isInBounds');

	const FIREBALL_DURATION = 0.6;
	const FIREBALL_MAX_RADIUS = 2.5;
	const GRAVITY = 10;
	const ROCK_COUNT = 10;
	const ROCK_MAX_TIME = 3.5;
	const raisePerRock = craterDepth / ROCK_COUNT;

	// Created in script so opacity can be mutated per-frame
	const fireballGeo = new THREE.SphereGeometry(1, 16, 12);
	const fireballMat = new THREE.MeshBasicMaterial({ color: '#ff6600', transparent: true });
	let fireballRef: THREE.Mesh | null = null;

	// Shared across all rock meshes
	const rockGeo = new THREE.IcosahedronGeometry(1, 0);
	const rockMat = new THREE.MeshStandardMaterial({
		color: '#7a6050',
		roughness: 0.9,
		metalness: 0
	});

	interface Rock {
		mesh: THREE.Mesh | null;
		pos: THREE.Vector3;
		vel: THREE.Vector3;
		angVel: THREE.Vector3;
		scaleX: number;
		scaleY: number;
		scaleZ: number;
		initRotX: number;
		initRotY: number;
		done: boolean;
	}

	const rocks: Rock[] = Array.from({ length: ROCK_COUNT }, () => {
		const azimuth = Math.random() * Math.PI * 2;
		const elev = Math.random() * Math.PI * 0.55 + 0.08;
		const speed = 4 + Math.random() * 16;
		const size = 0.04 + Math.random() * 0.14;
		return {
			mesh: null,
			pos: position.clone(),
			vel: new THREE.Vector3(
				Math.cos(azimuth) * Math.cos(elev) * speed,
				Math.sin(elev) * speed,
				Math.sin(azimuth) * Math.cos(elev) * speed
			),
			angVel: new THREE.Vector3(
				(Math.random() - 0.5) * 12,
				(Math.random() - 0.5) * 12,
				(Math.random() - 0.5) * 12
			),
			scaleX: size * (0.6 + Math.random() * 0.8),
			scaleY: size * (0.6 + Math.random() * 0.8),
			scaleZ: size * (0.6 + Math.random() * 0.8),
			initRotX: Math.random() * Math.PI * 2,
			initRotY: Math.random() * Math.PI * 2,
			done: false
		};
	});

	let elapsed = 0;

	onDestroy(() => {
		fireballGeo.dispose();
		fireballMat.dispose();
		rockGeo.dispose();
		rockMat.dispose();
	});

	const { stop } = useTask((delta) => {
		elapsed += delta;

		// Fireball: expand via sin curve while fading
		if (fireballRef) {
			const ft = Math.min(elapsed / FIREBALL_DURATION, 1);
			if (ft < 1) {
				fireballRef.scale.setScalar(Math.max(FIREBALL_MAX_RADIUS * Math.sin(ft * Math.PI), 0.01));
				fireballMat.opacity = 1 - ft;
			} else {
				fireballRef.visible = false;
			}
		}

		// Rocks: ballistic physics + spin, land on actual terrain surface
		const ft = Math.min(elapsed / FIREBALL_DURATION, 1);
		let allRocksDone = true;
		for (const rock of rocks) {
			if (rock.done) continue;
			allRocksDone = false;
			rock.vel.y -= GRAVITY * delta;
			rock.pos.x += rock.vel.x * delta;
			rock.pos.y += rock.vel.y * delta;
			rock.pos.z += rock.vel.z * delta;
			if (rock.mesh) {
				rock.mesh.position.copy(rock.pos);
				rock.mesh.rotation.x += rock.angVel.x * delta;
				rock.mesh.rotation.y += rock.angVel.y * delta;
				rock.mesh.rotation.z += rock.angVel.z * delta;
			}
			let landed = elapsed > ROCK_MAX_TIME;
			if (!landed && isInBounds(rock.pos.x, rock.pos.z)) {
				if (rock.pos.y <= getTerrainHeight(rock.pos.x, rock.pos.z)) {
					landed = true;
					onrockland?.(rock.pos.x, rock.pos.z, raisePerRock);
				}
			}
			if (landed) {
				rock.done = true;
				if (rock.mesh) rock.mesh.visible = false;
			}
		}

		if (ft >= 1 && allRocksDone) {
			stop();
			onremove?.();
		}
	});
</script>

<T.Mesh
	oncreate={(ref) => {
		fireballRef = ref;
	}}
	geometry={fireballGeo}
	material={fireballMat}
	position={[position.x, position.y, position.z]}
/>

{#each rocks as rock}
	<T.Mesh
		oncreate={(ref) => {
			rock.mesh = ref;
		}}
		geometry={rockGeo}
		material={rockMat}
		position={[rock.pos.x, rock.pos.y, rock.pos.z]}
		rotation={[rock.initRotX, rock.initRotY, 0]}
		scale={[rock.scaleX, rock.scaleY, rock.scaleZ]}
		castShadow
	/>
{/each}
