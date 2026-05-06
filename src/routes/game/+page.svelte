<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';

	const RELOAD_TIME = 4000;

	let restartKey = $state(0);
	let locked = $state(false);
	let chargeLevel = $state(0);
	let chargeVisible = $state(false);
	let chargeStart: number | null = null;
	let chargeFull = false;
	let chargeFullTime: number | null = null;
	let spaceHeld = false;
	let mouseHeld = false;
	let reloadProgress = $state(1);
	let reloadStart: number | null = null;

	function startCharge() {
		if (chargeStart === null && reloadProgress >= 1) {
			chargeStart = performance.now();
			chargeVisible = true;
			chargeFull = false;
			chargeFullTime = null;
		}
	}

	function tryFire() {
		if (chargeVisible) {
			window.dispatchEvent(new CustomEvent('tank-fire', { detail: { chargeLevel } }));
			reloadStart = performance.now();
			reloadProgress = 0;
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

	// Charge + reload bar update loop — runs every display frame via requestAnimationFrame
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
			if (reloadStart !== null) {
				reloadProgress = Math.min(1, (now - reloadStart) / RELOAD_TIME);
				if (reloadProgress >= 1) reloadStart = null;
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
			if (e.code === 'KeyR') {
				restartKey++;
				reloadStart = null;
				reloadProgress = 1;
			}
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
		{#key restartKey}
			<Scene />
		{/key}
	</Canvas>

	{#if chargeVisible}
		<div class="charge-wrap">
			<div class="charge-bar" class:full={chargeLevel >= 1} style="width: {chargeLevel * 100}%"></div>
			<span class="charge-label">Velocity</span>
		</div>
	{/if}

	{#if reloadProgress < 1}
		<div class="reload-wrap">
			<div class="reload-bar" style="width: {(1 - reloadProgress) * 100}%"></div>
			<span class="reload-label">Reloading</span>
		</div>
	{/if}

	{#if locked}
		<div class="overlay">
			<p class="hint">
				WASD · drive &nbsp;|&nbsp; X · stop &nbsp;|&nbsp; Mouse / arrows · aim &nbsp;|&nbsp; Z · zoom
				&nbsp;|&nbsp; Hold LMB / Space · charge, release · fire &nbsp;|&nbsp; Esc · release mouse
			</p>
		</div>
	{:else}
		<div class="overlay">
			<div class="panel">
				<div class="layout">
					<ul class="controls">
						<li>WASD · drive</li>
						<li>X · stop</li>
						<li>Mouse / arrows · aim</li>
						<li>Z · zoom (4× finer aim)</li>
						<li>Hold LMB / Space · charge, release · fire</li>
						<li>Esc · release mouse</li>
					</ul>
					<div class="buttons">
						<button
							class="green-btn"
							onclick={() => document.documentElement.requestPointerLock()}
							>Mouse Control</button
						>
						<button onclick={() => restartKey++}>Restart (R)</button>
						<a href="/" class="button">Quit</a>
					</div>
				</div>
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
		height: 18px;
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

	.charge-label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #eee;
		text-shadow: 0 0 4px #000, 0 0 2px #000;
		text-transform: uppercase;
	}

	.charge-bar.full {
		background: #e0c000;
		animation: pulse 0.2s ease-in-out infinite alternate;
	}

	.reload-wrap {
		position: absolute;
		top: 1.2rem;
		left: 50%;
		transform: translateX(-50%);
		width: 220px;
		height: 18px;
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid #888;
		border-radius: 7px;
		overflow: hidden;
		z-index: 20;
		pointer-events: none;
	}

	.reload-bar {
		position: absolute;
		inset: 0;
		right: auto;
		height: 100%;
		background: linear-gradient(to right, #8b2000, #c05000);
	}

	.reload-label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #eee;
		text-shadow: 0 0 4px #000, 0 0 2px #000;
		text-transform: uppercase;
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
		color: #eee;
		pointer-events: auto;
	}

	.layout {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.controls {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.75rem;
		color: #999;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
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
