<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { PositionalAudio } from '@threlte/extras';
	import { getContext, onDestroy } from 'svelte';
	import Splash from './Splash.svelte';
	import type { TankBody } from './types';

	let {
		position,
		velocity,
		excludeBodyUid = undefined,
		tracked = false,
		onremove,
		onimpact
	}: {
		position: THREE.Vector3;
		velocity: THREE.Vector3;
		excludeBodyUid?: number;
		tracked?: boolean;
		onremove?: () => void;
		onimpact?: (position: THREE.Vector3) => void;
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const isInBounds: (wx: number, wz: number) => boolean = getContext('isInBounds');
	const shellFollow = getContext<{ pos: THREE.Vector3 | null }>('shellFollow');
	const tankBodies = getContext<TankBody[]>('tankBodies');
	type TreeVol = { x: number; z: number; y: number; top: number; canopyR: number };
	const forNearbyTreeVolumes =
		getContext<(x: number, z: number, fn: (vol: TreeVol) => boolean) => void>(
			'forNearbyTreeVolumes'
		);
	let whistleRef: { stop: () => unknown } | undefined;

	const GRAVITY = 10;
	const HIT_RADIUS = 2.5;
	const WATER_DRAG = 0.8; // fraction of velocity remaining after 1 s underwater
	// Firer self-hit exclusion grace window.
	// The height gate (HIT_HEIGHT) applies to ALL tanks so shells passing high above any tank
	// don't register a hit.
	const FIRER_GRACE = 0.3;
	const HIT_HEIGHT = 3.0; // shell must be within ±3 m of body.y to register a hit

	const pos = position.clone();
	const vel = velocity.clone();
	let prevY = pos.y;
	let firerGraceTimer = FIRER_GRACE;

	// Share our live position vector with the shell tracker — Tank's camera reads it when zoomed.
	// pos is updated in-place each frame, so shellFollow.pos stays in sync automatically.
	// Scene will overwrite this reference with the impact-point clone when the shell lands,
	// and null it out when the full sequence (explosion) completes.
	if (tracked && shellFollow) shellFollow.pos = pos;

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

	// Closest-approach tracker: one entry per tank whose hit cylinder the shell is currently inside.
	// The hit is not declared until the shell starts moving away (dist > minDist) or exits the cylinder,
	// so minDist reflects the actual closest pass rather than always measuring at the outer boundary.
	interface PendingHit {
		body: TankBody;
		minDist: number;
		minWx: number;
		minWz: number;
	}
	const pendingHits: PendingHit[] = [];

	function flushPendingHit(): boolean {
		for (let i = 0; i < pendingHits.length; i++) {
			const p = pendingHits[i];
			if (p.body.hitAt === null) {
				p.body.lastHit = { dist: p.minDist, wx: p.minWx, wz: p.minWz };
				pendingHits.splice(i, 1);
				done = true;
				if (groupRef) groupRef.visible = false;
				return true;
			}
		}
		pendingHits.length = 0;
		return false;
	}

	// Write the terrain/tree impact point to the firer's body so the AI can compute a correction
	function recordImpact() {
		if (excludeBodyUid === undefined) return;
		for (const body of tankBodies) {
			if (body.uid === excludeBodyUid) {
				body.lastShellImpact = { x: pos.x, z: pos.z };
				return;
			}
		}
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
			whistleRef?.stop();
			if (splashes.length === 0) onremove?.();
			return;
		}

		if (firerGraceTimer > 0) firerGraceTimer -= delta;

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
			if (flushPendingHit()) return;
			onremove?.();
			return;
		}

		if (groupRef) {
			groupRef.position.set(pos.x, pos.y, pos.z);
			_dir.copy(vel).normalize();
			_q.setFromUnitVectors(_up, _dir);
			groupRef.quaternion.copy(_q);
		}

		// Tank hit detection — closest-approach tracking.
		// Declaring on first cylinder entry always records dist ≈ HIT_RADIUS (boundary), so instead
		// we track minDist while inside and declare only when the shell starts moving away or exits.
		if (tankBodies) {
			// Advance existing pending approaches
			for (let i = pendingHits.length - 1; i >= 0; i--) {
				const p = pendingHits[i];
				if (p.body.hitAt !== null) {
					pendingHits.splice(i, 1);
					continue;
				}
				const dx = pos.x - p.body.x;
				const dz = pos.z - p.body.z;
				const dist = Math.sqrt(dx * dx + dz * dz);
				const inCylinder = dist < HIT_RADIUS && Math.abs(pos.y - p.body.y) < HIT_HEIGHT;
				if (inCylinder && dist < p.minDist) {
					p.minDist = dist;
					p.minWx = pos.x;
					p.minWz = pos.z;
				} else {
					// Moving away or exited — closest point reached, register hit
					p.body.lastHit = { dist: p.minDist, wx: p.minWx, wz: p.minWz };
					pendingHits.splice(i, 1);
					done = true;
					if (groupRef) groupRef.visible = false;
					return;
				}
			}
			// Check for shells newly entering a tank's hit cylinder
			for (const body of tankBodies) {
				if (body.hitAt !== null) continue;
				if (pendingHits.some((p) => p.body === body)) continue;
				const dx = pos.x - body.x;
				const dz = pos.z - body.z;
				const distSq = dx * dx + dz * dz;
				if (distSq < HIT_RADIUS * HIT_RADIUS && Math.abs(pos.y - body.y) < HIT_HEIGHT) {
					// Firer grace: UID comparison (not object ref — Svelte $state proxies break ===)
					if (excludeBodyUid !== undefined && body.uid === excludeBodyUid && firerGraceTimer > 0)
						continue;
					pendingHits.push({ body, minDist: Math.sqrt(distSq), minWx: pos.x, minWz: pos.z });
				}
			}
		}

		// Tree canopy hit detection — spatial grid lookup, checks only nearby cells
		if (forNearbyTreeVolumes) {
			forNearbyTreeVolumes(pos.x, pos.z, (vol) => {
				const dx = pos.x - vol.x;
				const dz = pos.z - vol.z;
				if (dx * dx + dz * dz < vol.canopyR * vol.canopyR && pos.y > vol.y && pos.y < vol.top) {
					recordImpact();
					onimpact?.(pos.clone());
					done = true;
					if (groupRef) groupRef.visible = false;
					return true;
				}
				return false;
			});
			if (done) return;
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
				// If already inside a tank's cylinder, register a tank hit instead of a terrain explosion
				if (flushPendingHit()) return;
				recordImpact();
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
	<PositionalAudio
		src="/audio/shell-fly.mp3"
		loop
		autoplay
		bind:this={whistleRef}
		refDistance={80}
		maxDistance={600}
		volume={1}
	/>
</T.Group>

{#each splashes as s (s.id)}
	<Splash x={s.x} z={s.z} onremove={() => removeSplash(s.id)} />
{/each}
