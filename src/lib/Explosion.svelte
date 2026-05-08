<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { getContext, onDestroy } from 'svelte';
	import Splash from './Splash.svelte';

	let {
		position,
		craterDepth = 0.6,
		tankExplosion = false,
		debrisColor = '#4a3f38',
		onrockland,
		onsheetland,
		onremove
	}: {
		position: THREE.Vector3;
		craterDepth?: number;
		tankExplosion?: boolean;
		debrisColor?: string;
		onrockland?: (wx: number, wz: number, amount: number) => void;
		onsheetland?: (
			x: number,
			y: number,
			z: number,
			rx: number,
			ry: number,
			rz: number,
			sx: number,
			sy: number,
			sz: number
		) => void;
		onremove?: () => void;
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const isInBounds: (wx: number, wz: number) => boolean = getContext('isInBounds');

	const FIREBALL_DURATION = 0.6;
	const FIREBALL_MAX_RADIUS = tankExplosion ? 3.5 : 2.5;
	const GRAVITY = 10;
	const WATER_DRAG = 0.6;
	const DEBRIS_COUNT = 10;
	const DEBRIS_MAX_TIME = 3.5;
	const raisePerRock = craterDepth / DEBRIS_COUNT;

	const fireballGeo = new THREE.SphereGeometry(1, 16, 12);
	const fireballMat = new THREE.MeshBasicMaterial({ color: '#ff6600', transparent: true });
	let fireballRef: THREE.Mesh | null = null;

	// Geometry and material differ by explosion type
	const debrisGeo = tankExplosion
		? new THREE.BoxGeometry(1, 1, 1)
		: new THREE.IcosahedronGeometry(1, 0);
	const debrisMat = tankExplosion
		? new THREE.MeshStandardMaterial({ color: debrisColor, roughness: 0.5, metalness: 0.8 })
		: new THREE.MeshStandardMaterial({ color: '#7a6050', roughness: 0.9, metalness: 0 });

	interface Debris {
		mesh: THREE.Mesh | null;
		pos: THREE.Vector3;
		prevY: number;
		vel: THREE.Vector3;
		angVel: THREE.Vector3;
		scaleX: number;
		scaleY: number;
		scaleZ: number;
		initRotX: number;
		initRotY: number;
		done: boolean;
	}

	const debris: Debris[] = Array.from({ length: DEBRIS_COUNT }, () => {
		const azimuth = Math.random() * Math.PI * 2;
		const elev = Math.random() * Math.PI * 0.55 + 0.08;
		const speed = tankExplosion ? 7 + Math.random() * 18 : 4 + Math.random() * 16;
		const angSpeed = tankExplosion ? 20 : 12;

		let scaleX: number, scaleY: number, scaleZ: number;
		if (tankExplosion) {
			// Thin rectangular sheets — wide and tall, very thin in Z
			scaleX = 0.30 + Math.random() * 0.50;
			scaleY = 0.20 + Math.random() * 0.40;
			scaleZ = 0.03 + Math.random() * 0.02;
		} else {
			const size = 0.04 + Math.random() * 0.14;
			scaleX = size * (0.6 + Math.random() * 0.8);
			scaleY = size * (0.6 + Math.random() * 0.8);
			scaleZ = size * (0.6 + Math.random() * 0.8);
		}

		return {
			mesh: null,
			pos: position.clone(),
			prevY: position.y,
			vel: new THREE.Vector3(
				Math.cos(azimuth) * Math.cos(elev) * speed,
				Math.sin(elev) * speed,
				Math.sin(azimuth) * Math.cos(elev) * speed
			),
			angVel: new THREE.Vector3(
				(Math.random() - 0.5) * angSpeed,
				(Math.random() - 0.5) * angSpeed,
				(Math.random() - 0.5) * angSpeed
			),
			scaleX,
			scaleY,
			scaleZ,
			initRotX: Math.random() * Math.PI * 2,
			initRotY: Math.random() * Math.PI * 2,
			done: false
		};
	});

	let elapsed = 0;

	interface SplashEntry {
		id: number;
		x: number;
		z: number;
	}
	let splashes = $state<SplashEntry[]>([]);
	let nextSplashId = 0;

	function removeSplash(id: number) {
		splashes = splashes.filter((s) => s.id !== id);
	}

	onDestroy(() => {
		fireballGeo.dispose();
		fireballMat.dispose();
		debrisGeo.dispose();
		debrisMat.dispose();
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

		// Debris: ballistic physics + spin, land on actual terrain surface
		const ft = Math.min(elapsed / FIREBALL_DURATION, 1);
		let allDebrisDone = true;
		for (const piece of debris) {
			if (piece.done) continue;
			allDebrisDone = false;
			const prevY = piece.prevY;
			if (
				isInBounds(piece.pos.x, piece.pos.z) &&
				piece.pos.y <= 0 &&
				getTerrainHeight(piece.pos.x, piece.pos.z) < 0
			) {
				const drag = Math.pow(WATER_DRAG, delta);
				piece.vel.x *= drag;
				piece.vel.y *= drag;
				piece.vel.z *= drag;
			}
			piece.vel.y -= GRAVITY * delta;
			piece.pos.x += piece.vel.x * delta;
			piece.pos.y += piece.vel.y * delta;
			piece.pos.z += piece.vel.z * delta;
			piece.prevY = piece.pos.y;
			if (piece.mesh) {
				piece.mesh.position.copy(piece.pos);
				piece.mesh.rotation.x += piece.angVel.x * delta;
				piece.mesh.rotation.y += piece.angVel.y * delta;
				piece.mesh.rotation.z += piece.angVel.z * delta;
			}
			let landed = elapsed > DEBRIS_MAX_TIME;
			if (!landed && elapsed > 0.15 && isInBounds(piece.pos.x, piece.pos.z)) {
				if (getTerrainHeight(piece.pos.x, piece.pos.z) < 0) {
					if ((prevY > 0 && piece.pos.y <= 0) || (prevY <= 0 && piece.pos.y > 0)) {
						splashes.push({ id: nextSplashId++, x: piece.pos.x, z: piece.pos.z });
					}
				}
				if (piece.pos.y <= getTerrainHeight(piece.pos.x, piece.pos.z)) {
					landed = true;
					// Metal sheets don't fill a crater — only terrain rocks do
					if (!tankExplosion) onrockland?.(piece.pos.x, piece.pos.z, raisePerRock);
				}
			}
			if (landed) {
				piece.done = true;
				if (piece.mesh) piece.mesh.visible = false;
				if (tankExplosion && onsheetland) {
					const px = piece.pos.x, pz = piece.pos.z;
					const eps = 0.3;
					const dhdx =
						(getTerrainHeight(px + eps, pz) - getTerrainHeight(px - eps, pz)) / (2 * eps);
					const dhdz =
						(getTerrainHeight(px, pz + eps) - getTerrainHeight(px, pz - eps)) / (2 * eps);
					const normal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
					// Rotate local Z-axis (thin side) to face terrain normal, then spin randomly
					const tiltQ = new THREE.Quaternion().setFromUnitVectors(
						new THREE.Vector3(0, 0, 1),
						normal
					);
					const spinQ = new THREE.Quaternion().setFromAxisAngle(
						normal,
						Math.random() * Math.PI * 2
					);
					const euler = new THREE.Euler().setFromQuaternion(
						new THREE.Quaternion().multiplyQuaternions(spinQ, tiltQ)
					);
					const py = getTerrainHeight(px, pz) + piece.scaleZ * 0.5;
					onsheetland(px, py, pz, euler.x, euler.y, euler.z, piece.scaleX, piece.scaleY, piece.scaleZ);
				}
			}
		}

		if (ft >= 1 && allDebrisDone && splashes.length === 0) {
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

{#each debris as piece}
	<T.Mesh
		oncreate={(ref) => {
			piece.mesh = ref;
		}}
		geometry={debrisGeo}
		material={debrisMat}
		position={[piece.pos.x, piece.pos.y, piece.pos.z]}
		rotation={[piece.initRotX, piece.initRotY, 0]}
		scale={[piece.scaleX, piece.scaleY, piece.scaleZ]}
		castShadow
	/>
{/each}

{#each splashes as s (s.id)}
	<Splash x={s.x} z={s.z} onremove={() => removeSplash(s.id)} />
{/each}
