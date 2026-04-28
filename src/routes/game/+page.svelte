<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';

	let restartKey = $state(0);
	let locked = $state(false);
	let chargeLevel = $state(0);
	let chargeVisible = $state(false);
	let chargeStart: number | null = null;
	let chargeFull = false;
	let chargeFullTime: number | null = null;
	let spaceHeld = false;
	let mouseHeld = false;

	function startCharge() {
		if (chargeStart === null) {
			chargeStart = performance.now();
			chargeVisible = true;
			chargeFull = false;
			chargeFullTime = null;
		}
	}

	function tryFire() {
		if (chargeVisible) {
			window.dispatchEvent(new CustomEvent('tank-fire', { detail: { chargeLevel } }));
		}
		resetCharge();
	}

	function resetCharge() {
		chargeStart = null;
		chargeLevel = 0;
		chargeVisible = false;
		chargeFull = false;
		chargeFullTime = null;
	}

	// Charge bar update loop — runs every display frame via requestAnimationFrame
	$effect(() => {
		let rafId: number;
		function tick(now: number) {
			if (chargeStart !== null) {
				chargeLevel = Math.min(1, (now - chargeStart) / 2000);
				if (chargeLevel >= 1 && !chargeFull) {
					chargeFull = true;
					chargeFullTime = now;
				}
				if (chargeFull && chargeFullTime !== null && now - chargeFullTime >= 500) {
					resetCharge();
				}
			}
			rafId = requestAnimationFrame(tick);
		}
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	$effect(() => {
		const onChange = () => {
			locked = document.pointerLockElement !== null;
			if (!locked && mouseHeld) {
				mouseHeld = false;
				if (!spaceHeld) resetCharge();
			}
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.code === 'KeyR') restartKey++;
			if (e.code === 'Space' && !spaceHeld) {
				e.preventDefault();
				spaceHeld = true;
				startCharge();
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.code === 'Space' && spaceHeld) {
				spaceHeld = false;
				tryFire();
				mouseHeld = false;
			}
		};
		const onMouseDown = (e: MouseEvent) => {
			if (e.button === 0 && locked && !mouseHeld) {
				mouseHeld = true;
				startCharge();
			}
		};
		const onMouseUp = (e: MouseEvent) => {
			if (e.button === 0 && mouseHeld) {
				mouseHeld = false;
				tryFire();
				spaceHeld = false;
			}
		};
		document.addEventListener('pointerlockchange', onChange);
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('mousedown', onMouseDown);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			document.removeEventListener('pointerlockchange', onChange);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('mouseup', onMouseUp);
		};
	});
</script>

<div class="game-container">
	<Canvas shadows>
		<Scene {restartKey} />
	</Canvas>

	{#if chargeVisible}
		<div class="charge-wrap">
			<div class="charge-bar" class:full={chargeLevel >= 1} style="width: {chargeLevel * 100}%"></div>
		</div>
	{/if}

	{#if locked}
		<div class="overlay">
			<p class="hint">
				Mouse / arrows · aim &nbsp;|&nbsp; Hold LMB / Space · charge, release · fire &nbsp;|&nbsp; Esc
				· release mouse
			</p>
		</div>
	{:else}
		<div class="overlay">
			<div class="panel">
				<div class="buttons">
					<button
						class="green-btn"
						onclick={() => document.documentElement.requestPointerLock()}
						>Use Mouse Control</button
					>
					<button
						class="green-btn"
						onclick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))}
						>Camera (C)</button
					>
				</div>
				<div class="buttons">
					<button onclick={() => restartKey++}>Restart (R)</button>
					<a href="/" class="button">Quit</a>
				</div>
				<p class="controls">
					WASD · drive &nbsp;|&nbsp; Mouse / arrows · aim &nbsp;|&nbsp; Hold LMB / Space · charge,
					release · fire &nbsp;|&nbsp; Esc · release mouse
				</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.game-container {
		position: relative;
		width: 100%;
		height: 100svh;
	}

	.charge-wrap {
		position: absolute;
		top: 1.2rem;
		left: 50%;
		transform: translateX(-50%);
		width: 220px;
		height: 14px;
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid #888;
		border-radius: 7px;
		overflow: hidden;
		z-index: 20;
		pointer-events: none;
	}

	.charge-bar {
		height: 100%;
		background: linear-gradient(to right, #4a9a2a, #c8c020);
	}

	.charge-bar.full {
		background: #e0c000;
		animation: pulse 0.2s ease-in-out infinite alternate;
	}

	@keyframes pulse {
		from {
			opacity: 0.75;
		}
		to {
			opacity: 1;
		}
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: 1.5rem;
		z-index: 10;
		pointer-events: none;
	}

	.panel {
		background: rgba(15, 15, 15, 0.72);
		border: 1px solid #555;
		border-radius: 8px;
		padding: 1.5rem 2rem;
		text-align: center;
		color: #eee;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		pointer-events: auto;
	}

	.buttons {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}

	.controls {
		margin: 0;
		font-size: 0.75rem;
		color: #999;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: #bbb;
		background: rgba(15, 15, 15, 0.5);
		padding: 0.4rem 0.8rem;
		border-radius: 5px;
		pointer-events: none;
	}

	.green-btn {
		background: #4a6a2a;
		border-color: #7a9a4a;
	}

	.green-btn:hover {
		background: #5a7a3a;
	}

	button,
	.button {
		padding: 0.4rem 1.1rem;
		font-size: 0.9rem;
		cursor: pointer;
		border-radius: 5px;
		background: #3a3a3a;
		border: 1px solid #666;
		text-decoration: none;
		color: #eee;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	button:hover,
	.button:hover {
		background: #505050;
	}
</style>
