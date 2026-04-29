<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask, useThrelte } from '@threlte/core';
	import { getContext, onDestroy } from 'svelte';

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
	const { scene } = useThrelte();

	const GRAVITY = 10;
	const SPLASH_MAX_RADIUS = 6;
	const SPLASH_RING_DURATION = 2.0;
	const SPLASH_DELAYS = [0, 0.4, 0.8];

	const pos = position.clone();
	const vel = velocity.clone();
	let prevY = pos.y;

	const _up = new THREE.Vector3(0, 1, 0);
	const _dir = new THREE.Vector3();
	const _q = new THREE.Quaternion();

	let groupRef: THREE.Group | null = null;

	interface RingState {
		mesh: THREE.Mesh;
		mat: THREE.MeshBasicMaterial;
		delay: number;
	}
	interface SplashInstance {
		rings: RingState[];
		elapsed: number;
	}
	const splashes: SplashInstance[] = [];

	function startSplash(x: number, z: number) {
		const rings: RingState[] = SPLASH_DELAYS.map((delay) => {
			const mat = new THREE.MeshBasicMaterial({
				color: '#88bbcc',
				transparent: true,
				opacity: 0.7,
				side: THREE.DoubleSide
			});
			const mesh = new THREE.Mesh(new THREE.RingGeometry(0, 0.01, 64), mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.position.set(x, 0.05, z);
			scene.add(mesh);
			return { mesh, mat, delay };
		});
		splashes.push({ rings, elapsed: 0 });
	}

	function cleanupSplash(splash: SplashInstance) {
		for (const ring of splash.rings) {
			scene.remove(ring.mesh);
			ring.mesh.geometry.dispose();
		}
	}

	onDestroy(() => {
		for (const splash of splashes) cleanupSplash(splash);
	});

	useTask((delta) => {
		// Update all active splashes
		for (let i = splashes.length - 1; i >= 0; i--) {
			const splash = splashes[i];
			splash.elapsed += delta;
			let allDone = true;
			for (const ring of splash.rings) {
				const t = splash.elapsed - ring.delay;
				if (t < 0) {
					allDone = false;
					continue;
				}
				const progress = t / SPLASH_RING_DURATION;
				if (progress >= 1) {
					ring.mesh.visible = false;
					continue;
				}
				allDone = false;
				const radius = progress * SPLASH_MAX_RADIUS;
				ring.mesh.geometry.dispose();
				ring.mesh.geometry = new THREE.RingGeometry(radius, radius + 0.3, 64);
				ring.mat.opacity = 0.7 * (1 - progress);
			}
			if (allDone) {
				cleanupSplash(splash);
				splashes.splice(i, 1);
			}
		}

		// Physics
		vel.y -= GRAVITY * delta;
		pos.x += vel.x * delta;
		pos.y += vel.y * delta;
		pos.z += vel.z * delta;

		// Disappear once the shell has fallen well below the firing height (out of view)
		if (pos.y < position.y - 15) {
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
				pos.y = groundY;
				onimpact?.(pos.clone());
				onremove?.();
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
	<T.Mesh castShadow>
		<T.CylinderGeometry args={[0.035, 0.055, 0.38, 8]} />
		<T.MeshStandardMaterial
			color="#c87830"
			metalness={0.8}
			roughness={0.3}
			emissive="#7a3a08"
			emissiveIntensity={0.4}
		/>
	</T.Mesh>
</T.Group>
