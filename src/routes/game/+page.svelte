<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import { page } from '$app/state';

	const opponentCount = Math.min(
		3,
		Math.max(1, parseInt(page.url.searchParams.get('opponents') ?? '1', 10))
	);
	const startMuted = page.url.searchParams.get('muted') === '1';

	interface TankHealthEntry {
		health: number;
		destroyed: boolean;
		color: string;
	}
	let tankHealthData = $state<TankHealthEntry[]>([]);

	const RELOAD_TIME = 2000;
	const FIRE_FADE_DURATION = 1000;

	let restartKey = $state(0);
	let locked = $state(false);
	let chargeLevel = $state(0);
	let chargeVisible = $state(false);
	let chargeOpacity = $state(1);
	let chargeStart: number | null = null;
	let chargeFull = false;
	let chargeFullTime: number | null = null;
	let fadeStart = $state<number | null>(null);
	let spaceHeld = false;
	let mouseHeld = false;
	let reloadProgress = $state(1);
	let reloadStart = $state<number | null>(null);
	let muted = $state(startMuted);

	function toggleMute() {
		muted = !muted;
	}

	let gameOver = $derived(
		tankHealthData.length > 0 &&
			(tankHealthData[0]?.destroyed || tankHealthData.filter((d) => !d.destroyed).length <= 1)
	);
	let playerWon = $derived(gameOver && !tankHealthData[0]?.destroyed);
	// Opponents keep fighting each other until only one survives
	let allGameOver = $derived(
		tankHealthData.length > 0 && tankHealthData.filter((d) => !d.destroyed).length <= 1
	);

	function restartGame() {
		restartKey++;
		resetCharge();
		reloadStart = null;
		reloadProgress = 1;
	}

	function startCharge() {
		if (chargeStart === null && fadeStart === null && reloadProgress >= 1 && !gameOver) {
			chargeStart = performance.now();
			chargeVisible = true;
			chargeFull = false;
			chargeFullTime = null;
		}
	}

	function tryFire() {
		if (chargeVisible && fadeStart === null) {
			window.dispatchEvent(new CustomEvent('tank-fire', { detail: { chargeLevel } }));
			chargeStart = null;
			chargeFull = false;
			chargeFullTime = null;
			fadeStart = performance.now();
		} else if (!chargeVisible) {
			resetCharge();
		}
	}

	function resetCharge() {
		chargeStart = null;
		chargeLevel = 0;
		chargeVisible = false;
		chargeOpacity = 1;
		chargeFull = false;
		chargeFullTime = null;
		fadeStart = null;
	}

	// Charge + reload bar update loop — runs every display frame via requestAnimationFrame
	$effect(() => {
		let rafId: number;
		function tick(now: number) {
			if (fadeStart !== null) {
				const elapsed = now - fadeStart;
				chargeOpacity = Math.max(0, 1 - elapsed / FIRE_FADE_DURATION);
				if (elapsed >= FIRE_FADE_DURATION) {
					chargeVisible = false;
					chargeOpacity = 1;
					fadeStart = null;
					reloadStart = now;
					reloadProgress = 0;
				}
			} else if (chargeStart !== null) {
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
				if (reloadProgress >= 1) {
					reloadStart = null;
					if (spaceHeld || mouseHeld) startCharge();
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
			if (e.code === 'Space' && !spaceHeld) {
				e.preventDefault();
				spaceHeld = true;
				startCharge();
			}
			if (e.code === 'KeyM') toggleMute();
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

	$effect(() => {
		if (gameOver && document.pointerLockElement !== null) {
			document.exitPointerLock();
		}
	});
</script>

<div class="game-container">
	<Canvas shadows>
		{#key restartKey}
			<Scene {opponentCount} bind:tankHealthData {gameOver} {allGameOver} {muted} />
		{/key}
	</Canvas>

	{#if tankHealthData.length > 0}
		{#if tankHealthData[0]}
			<div class="player-health">
				<div class="vbar" class:dead={tankHealthData[0].destroyed}>
					<div
						class="vfill"
						style="height:{Math.max(0, tankHealthData[0].health)}%;background:{tankHealthData[0]
							.color}"
					></div>
				</div>
			</div>
		{/if}
		{#if tankHealthData.length > 1}
			<div class="opponent-health">
				{#each tankHealthData.slice(1) as d}
					<div class="vbar" class:dead={d.destroyed}>
						<div class="vfill" style="height:{Math.max(0, d.health)}%;background:{d.color}"></div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	{#if gameOver}
		<div class="gameover-text" class:won={playerWon}>
			{playerWon ? 'You Won' : 'Game Over'}
		</div>
	{/if}

	{#if chargeVisible && !gameOver}
		<div class="charge-wrap" style="opacity: {chargeOpacity}">
			<div
				class="charge-bar"
				class:full={chargeLevel >= 1 && fadeStart === null}
				style="width: {chargeLevel * 100}%"
			></div>
			<span class="charge-label">Velocity</span>
		</div>
	{/if}

	{#if reloadStart !== null && !gameOver}
		<div class="reload-wrap">
			<div class="reload-bar" style="width: {(1 - reloadProgress) * 100}%"></div>
			<span class="reload-label">Reloading</span>
		</div>
	{/if}

	{#if gameOver}
		<div class="overlay">
			<div class="panel">
				<div class="buttons">
					<button onclick={restartGame}>Restart</button>
					<a href="/" class="button">Quit</a>
				</div>
			</div>
		</div>
	{:else if locked}
		<div class="overlay">
			<p class="hint">
				WASD · drive &nbsp;|&nbsp; X · stop &nbsp;|&nbsp; Mouse / arrows · aim &nbsp;|&nbsp; Z ·
				zoom &nbsp;|&nbsp; Hold LMB / Space · charge, release · fire &nbsp;|&nbsp; M ·
				{muted ? 'unmute' : 'mute'} &nbsp;|&nbsp; Esc · release mouse
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
						<li>Z · zoom (5× finer aim)</li>
						<li>Hold LMB / Space · charge, release · fire</li>
						<li>M · mute / unmute</li>
						<li>Esc · release mouse</li>
					</ul>
					<div class="buttons">
						<button class="green-btn" onclick={() => document.documentElement.requestPointerLock()}
							>Mouse Control</button
						>
						<button onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
						<button onclick={restartGame}>Restart</button>
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

	.gameover-text {
		position: absolute;
		top: 38%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 5rem;
		font-weight: 700;
		color: #ffb0b0;
		text-shadow:
			0 0 40px rgba(0, 0, 0, 0.9),
			0 4px 12px rgba(0, 0, 0, 0.7);
		pointer-events: none;
		z-index: 30;
		letter-spacing: 0.06em;
		text-align: center;
		user-select: none;
	}

	.gameover-text.won {
		color: #b8ffaa;
	}

	.player-health {
		position: absolute;
		top: 50%;
		right: 2rem;
		transform: translateY(-50%);
		pointer-events: none;
		z-index: 10;
	}

	.opponent-health {
		position: absolute;
		top: 2rem;
		left: 2rem;
		display: flex;
		gap: 7px;
		align-items: flex-end;
		pointer-events: none;
		z-index: 10;
	}

	.vbar {
		width: 14px;
		height: 90px;
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 4px;
		overflow: hidden;
		position: relative;
	}

	.player-health .vbar {
		width: 22px;
		height: 50vh;
	}

	.vbar.dead {
		opacity: 0.3;
	}

	.vfill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
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
		text-shadow:
			0 0 4px #000,
			0 0 2px #000;
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
		text-shadow:
			0 0 4px #000,
			0 0 2px #000;
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
