<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { onDestroy } from 'svelte';

	let { x, z, onremove }: { x: number; z: number; onremove?: () => void } = $props();

	const SPLASH_MAX_RADIUS = 6;
	const SPLASH_RING_WIDTH = 0.3;
	const SPLASH_RING_DURATION = 2.0;
	const SPLASH_DELAYS = [0, 0.4, 0.8];
	const THETA_SEGS = 64;

	// One geometry per ring, updated in-place each frame so ring width stays constant.
	// Sharing one geometry across rings is not possible — each has a different radius.
	const geos = SPLASH_DELAYS.map(
		() => new THREE.RingGeometry(0.001, SPLASH_RING_WIDTH, THETA_SEGS)
	);
	const mats = SPLASH_DELAYS.map(
		() =>
			new THREE.MeshBasicMaterial({
				color: '#ffffff',
				transparent: true,
				opacity: 0,
				depthWrite: false,
				depthTest: false,
				side: THREE.DoubleSide
			})
	);

	const meshRefs: (THREE.Mesh | null)[] = [null, null, null];
	let elapsed = 0;

	// RingGeometry vertex layout (phiSegments=1 default):
	//   vertices 0 .. THETA_SEGS     → inner ring
	//   vertices THETA_SEGS+1 .. end → outer ring
	function updateRingRadius(geo: THREE.RingGeometry, inner: number) {
		const outer = inner + SPLASH_RING_WIDTH;
		const pos = geo.attributes.position as THREE.BufferAttribute;
		for (let i = 0; i <= THETA_SEGS; i++) {
			const angle = (i / THETA_SEGS) * Math.PI * 2;
			const cos = Math.cos(angle),
				sin = Math.sin(angle);
			pos.setXY(i, inner * cos, inner * sin);
			pos.setXY(THETA_SEGS + 1 + i, outer * cos, outer * sin);
		}
		pos.needsUpdate = true;
	}

	onDestroy(() => {
		geos.forEach((g) => g.dispose());
		mats.forEach((m) => m.dispose());
	});

	useTask((delta) => {
		elapsed += delta;
		let allDone = true;
		for (let i = 0; i < SPLASH_DELAYS.length; i++) {
			const t = elapsed - SPLASH_DELAYS[i];
			if (t < 0) {
				allDone = false;
				continue;
			}
			const progress = t / SPLASH_RING_DURATION;
			if (progress >= 1) {
				if (meshRefs[i]) meshRefs[i]!.visible = false;
				continue;
			}
			allDone = false;
			if (meshRefs[i]) {
				updateRingRadius(geos[i], Math.max(progress * SPLASH_MAX_RADIUS, 0.001));
				meshRefs[i]!.visible = true;
			}
			mats[i].opacity = 0.7 * (1 - progress);
		}
		if (allDone) onremove?.();
	});
</script>

{#each SPLASH_DELAYS as _delay, i}
	<T.Mesh
		oncreate={(ref) => {
			meshRefs[i] = ref;
		}}
		geometry={geos[i]}
		material={mats[i]}
		rotation.x={-Math.PI / 2}
		position={[x, 0, z]}
		renderOrder={1}
		visible={false}
	/>
{/each}
