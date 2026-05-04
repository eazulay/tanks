<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';

	let { x, z, onremove }: { x: number; z: number; onremove?: () => void } = $props();

	const SPLASH_MAX_RADIUS = 6;
	const SPLASH_RING_DURATION = 2.0;
	const SPLASH_DELAYS = [0, 0.4, 0.8];

	interface Ring { delay: number; radius: number; opacity: number; }

	let rings = $state<Ring[]>(SPLASH_DELAYS.map((delay) => ({ delay, radius: 0, opacity: 0 })));
	let elapsed = 0;

	useTask((delta) => {
		elapsed += delta;
		let allDone = true;
		for (const ring of rings) {
			const t = elapsed - ring.delay;
			if (t < 0) { allDone = false; continue; }
			const progress = t / SPLASH_RING_DURATION;
			if (progress >= 1) continue;
			allDone = false;
			ring.radius = progress * SPLASH_MAX_RADIUS;
			ring.opacity = 0.7 * (1 - progress);
		}
		if (allDone) onremove?.();
	});
</script>

{#each rings as ring (ring.delay)}
	{#if ring.opacity > 0}
		<T.Mesh rotation.x={-Math.PI / 2} position={[x, 0.05, z]}>
			<T.RingGeometry args={[ring.radius, ring.radius + 0.3, 64]} />
			<T.MeshBasicMaterial color="#ffffff" transparent opacity={ring.opacity} depthWrite={false} side={THREE.DoubleSide} />
		</T.Mesh>
	{/if}
{/each}
