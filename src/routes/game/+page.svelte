<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import Joystick from '$lib/Joystick.svelte';
	import type { TankHealthEntry } from '$lib/types';
	import { mp, send, connect, TANK_COLORS, type GameStart } from '$lib/mp.svelte.js';

	const startMuted = page.url.searchParams.get('muted') === '1';

	let tankHealthData = $state<TankHealthEntry[]>([]);

	// Compute names/colors/seed at module-init time so Scene.initGame() reads them on first mount.
	// onMount fires AFTER child components initialise, so any value set there arrives too late.
	// browser check guards localStorage/sessionStorage access during SSR.
	function buildGameSetup() {
		const empty = {
			gameSeed: null as number | null,
			tankNames: [] as string[],
			tankColors: [] as string[],
			// relay tankIndex → local health-bar index (only populated for multiplayer)
			relayToLocal: null as Map<number, number> | null
		};
		if (!browser) return empty;

		const localName = localStorage.getItem('playerName') ?? 'Player';

		// Prefer live mp state; fall back to sessionStorage (survives a full-page reload)
		const gs: GameStart | null =
			mp.gameStart ??
			((): GameStart | null => {
				try {
					const raw = sessionStorage.getItem('mp_gameStart');
					return raw ? (JSON.parse(raw) as GameStart) : null;
				} catch {
					return null;
				}
			})();
		const selfClientId = mp.clientId ?? sessionStorage.getItem('mp_clientId') ?? null;

		if (gs) {
			// Multiplayer — reorder so local index 0 = self, 1..n = opponents in relay-tankIndex order.
			// Use gs directly for the tank count; ?opponents= URL param is single-player only.
			const totalTanks = gs.assignments.length + gs.aiCount;
			const asgn = gs.assignments;
			const selfAsgn = asgn.find((a) => a.clientId === selfClientId);
			const names: string[] = [localName];
			const colors: string[] = [TANK_COLORS[selfAsgn?.colorIndex ?? 0] ?? '#CBFF70'];
			const relayToLocal = new Map<number, number>();
			if (selfAsgn) relayToLocal.set(selfAsgn.tankIndex, 0);
			let aiNum = 1;
			for (let relayIdx = 0; relayIdx < totalTanks; relayIdx++) {
				if (selfAsgn && relayIdx === selfAsgn.tankIndex) continue;
				const localIdx = names.length;
				const a = asgn.find((a) => a.tankIndex === relayIdx);
				if (a) {
					names.push(a.name);
					colors.push(TANK_COLORS[a.colorIndex] ?? '#CBFF70');
					relayToLocal.set(relayIdx, localIdx);
				} else {
					names.push(`AI ${aiNum++}`);
					colors.push(TANK_COLORS[localIdx] ?? '#CBFF70');
				}
			}
			return { gameSeed: gs.seed, tankNames: names, tankColors: colors, relayToLocal };
		}

		// Single-player — opponent count and seed from sessionStorage (written by /single setup page)
		let spOpponentCount = 1;
		let spSeed: number | null = null;
		try {
			const raw = sessionStorage.getItem('sp_gameStart');
			if (raw) {
				const sp = JSON.parse(raw) as { aiCount: number; seed?: number };
				spOpponentCount = Math.min(5, Math.max(0, sp.aiCount));
				spSeed = sp.seed ?? null;
			}
		} catch { /* ignore */ }
		return {
			...empty,
			gameSeed: spSeed,
			tankNames: [localName, ...Array.from({ length: spOpponentCount }, (_, i) => `AI ${i + 1}`)],
			tankColors: [] as string[]
		};
	}

	const { gameSeed, tankNames, tankColors, relayToLocal } = buildGameSetup();
	// Authoritative count from gs (multiplayer) or URL param via spOpponentCount (single-player)
	const opponentCount = tankNames.length - 1;

	// Multiplayer props for Scene — computed once from gameStart (stable after mount)
	const selfClientId = browser
		? (mp.clientId ?? sessionStorage.getItem('mp_clientId') ?? null)
		: null;
	const gs = browser
		? (mp.gameStart ??
			(() => {
				try {
					const r = sessionStorage.getItem('mp_gameStart');
					return r ? JSON.parse(r) : null;
				} catch {
					return null;
				}
			})())
		: null;
	const isHost = gs ? gs.hostClientId === selfClientId : true;
	const selfRelayIndex = gs
		? (gs.assignments.find(
				(a: { clientId: string; tankIndex: number }) => a.clientId === selfClientId
			)?.tankIndex ?? 0)
		: 0;

	let sceneRef: { quitGame: () => void } | undefined = $state();

	function handleQuit() {
		sceneRef?.quitGame();
	}

	// In-game notification when a multiplayer opponent disconnects
	let playerLeftNotif = $state<string | null>(null);
	let playerLeftTimer: ReturnType<typeof setTimeout> | null = null;

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
	let isTouch = $state(false);
	let touchActive = $state(false);
	let touchFireHeld = false;

	onMount(() => {
		isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		if (isTouch) {
			window.dispatchEvent(new CustomEvent('tank-unlock-audio'));
			touchActive = true;
		}
		// Reconnect to the relay after an F5 reload in a multiplayer game.
		// connect() is idempotent — no-op if the WS is already open (normal navigation).
		if (gs) {
			connect(localStorage.getItem('playerName') ?? 'Player');
		}
	});

	onDestroy(() => {
		if (playerLeftTimer !== null) clearTimeout(playerLeftTimer);
		mp.latestPlayerLeft = null;
		sessionStorage.removeItem('mp_gameStart');
		sessionStorage.removeItem('mp_clientId');
		sessionStorage.removeItem('sp_gameStart');
		// Tell the relay the player has left and clear stale room state so the lobby
		// doesn't redirect back to a dissolved room on the next visit.
		if (mp.room) {
			send({ type: 'leave_room' });
			mp.room = null;
			mp.pendingJoiners = [];
		}
		mp.gameStart = null;
	});

	// Handle in-game player disconnect notifications (multiplayer only)
	$effect(() => {
		const notif = mp.latestPlayerLeft;
		if (!notif) return;
		mp.latestPlayerLeft = null;

		// Mark that player's tank as destroyed so the game-over derived triggers correctly.
		// assignment.tankIndex is the relay-assigned index; relayToLocal maps it to the local bar index.
		const assignment = (gs as GameStart | null)?.assignments.find((a) => a.clientId === notif.clientId);
		if (assignment !== undefined && relayToLocal !== null) {
			const localIdx = relayToLocal.get(assignment.tankIndex);
			if (localIdx !== undefined) {
				const entry = tankHealthData[localIdx];
				if (entry && !entry.destroyed) {
					entry.health = 0;
					entry.destroyed = true;
				}
			}
		}

		// Show banner notification, auto-dismiss after 5 s
		playerLeftNotif = `${notif.name} has left the game`;
		if (playerLeftTimer !== null) clearTimeout(playerLeftTimer);
		playerLeftTimer = setTimeout(() => {
			playerLeftNotif = null;
		}, 5000);
	});

	function dispatchDrive(dx: number, dy: number) {
		window.dispatchEvent(new CustomEvent('tank-touch-drive', { detail: { dx, dy } }));
	}

	function dispatchBrake() {
		window.dispatchEvent(new CustomEvent('tank-touch-brake'));
	}

	function dispatchAim(dx: number, dy: number) {
		window.dispatchEvent(new CustomEvent('tank-touch-aim', { detail: { dx, dy } }));
	}

	function toggleZoom() {
		window.dispatchEvent(new CustomEvent('tank-touch-zoom'));
	}

	function onFireTouchStart(e: TouchEvent) {
		e.preventDefault();
		if (!touchFireHeld) {
			touchFireHeld = true;
			startCharge();
		}
	}

	function onFireTouchEnd(e: TouchEvent) {
		e.preventDefault();
		if (touchFireHeld) {
			touchFireHeld = false;
			tryFire();
		}
	}

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
					if (spaceHeld || mouseHeld || touchFireHeld) startCharge();
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
			<Scene
				{opponentCount}
				bind:tankHealthData
				{gameOver}
				{allGameOver}
				{muted}
				seed={gameSeed}
				{tankNames}
				{tankColors}
				{isHost}
				{selfRelayIndex}
				{relayToLocal}
				bind:this={sceneRef}
			/>
		{/key}
	</Canvas>

	{#if playerLeftNotif}
		<div class="player-left-notif">{playerLeftNotif}</div>
	{/if}

	{#if tankHealthData.length > 0}
		{#if tankHealthData[0]}
			<div class="player-health">
				<div class="vbar" class:dead={tankHealthData[0].destroyed}>
					<div
						class="vfill"
						style="height:{Math.max(0, tankHealthData[0].health)}%;background:{tankHealthData[0]
							.color}"
					></div>
					{#if tankHealthData[0].name}
						<span class="bar-name">{tankHealthData[0].name}</span>
					{/if}
				</div>
			</div>
		{/if}
		{#if tankHealthData.length > 1}
			<div class="opponent-health">
				{#each tankHealthData.slice(1) as d}
					<div class="vbar" class:dead={d.destroyed}>
						<div class="vfill" style="height:{Math.max(0, d.health)}%;background:{d.color}"></div>
						{#if d.name}
							<span class="bar-name">{d.name}</span>
						{/if}
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

	{#if isTouch && touchActive && !gameOver}
		<div class="touch-controls">
			<div class="left-group">
				<div class="stick-wrap">
					<Joystick onchange={dispatchDrive} label="DRIVE" taplabel="BRAKE" ontap={dispatchBrake} />
				</div>
				<div class="action-btns">
					<button class="zoom-btn" onclick={toggleZoom}>Zoom</button>
					<button
						class="fire-btn"
						ontouchstart={onFireTouchStart}
						ontouchend={onFireTouchEnd}
						ontouchcancel={onFireTouchEnd}>FIRE</button
					>
				</div>
			</div>
			<div class="stick-wrap">
				<Joystick onchange={dispatchAim} label="AIM" />
			</div>
		</div>
		<div class="touch-hud">
			<button class="touch-btn" onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
			<a href="/" class="touch-btn" onclick={handleQuit}>Quit</a>
		</div>
	{/if}

	{#if gameOver}
		<div class="overlay">
			<div class="panel">
				<div class="buttons">
					{#if !relayToLocal}
						<button onclick={restartGame}>Restart</button>
					{/if}
					<a href="/" class="button" onclick={handleQuit}>Quit</a>
				</div>
			</div>
		</div>
	{:else if isTouch && touchActive}
		<!-- touch controls rendered above -->
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
						{#if !relayToLocal}
							<button onclick={restartGame}>Restart</button>
						{/if}
						<a href="/" class="button" onclick={handleQuit}>Quit</a>
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
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.touch-controls {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 1rem 1.5rem 1.5rem;
		pointer-events: none;
		z-index: 15;
	}

	.left-group {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
		pointer-events: none;
	}

	@media (orientation: portrait) {
		.left-group {
			flex-direction: column-reverse;
			align-items: center;
		}
	}

	.stick-wrap {
		pointer-events: auto;
	}

	.fire-btn {
		width: 80px;
		height: 80px;
		padding: 0;
		border-radius: 50%;
		background: rgba(160, 30, 30, 0.7);
		border: 2px solid rgba(255, 100, 100, 0.6);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		touch-action: none;
		pointer-events: auto;
		user-select: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.action-btns {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
		pointer-events: none;
	}

	.zoom-btn {
		width: 60px;
		height: 60px;
		padding: 0;
		border-radius: 50%;
		background: rgba(30, 80, 160, 0.7);
		border: 2px solid rgba(100, 160, 255, 0.6);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		touch-action: none;
		pointer-events: auto;
		user-select: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.touch-hud {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 15;
		display: flex;
		gap: 0.4rem;
	}

	.touch-btn {
		padding: 0.3rem 0.7rem;
		font-size: 0.7rem;
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid #555;
		border-radius: 4px;
		color: #ccc;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
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

	.bar-name {
		position: absolute;
		bottom: 3px;
		left: 0;
		right: 0;
		text-align: center;
		writing-mode: vertical-lr;
		transform: rotate(180deg);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: rgba(255, 255, 255, 0.88);
		text-shadow:
			0 0 3px rgba(0, 0, 0, 0.9),
			0 1px 2px rgba(0, 0, 0, 0.7);
		overflow: hidden;
		white-space: nowrap;
		pointer-events: none;
		max-height: calc(100% - 6px);
		z-index: 1;
	}

	.player-health .bar-name {
		font-size: 14px;
	}

	.player-left-notif {
		position: absolute;
		top: 3.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(10, 10, 10, 0.8);
		border: 1px solid rgba(255, 200, 80, 0.4);
		border-radius: 5px;
		padding: 0.4rem 1rem;
		font-size: 0.8rem;
		color: #ffd060;
		pointer-events: none;
		z-index: 25;
		white-space: nowrap;
		animation: notif-fadein 0.2s ease;
	}

	@keyframes notif-fadein {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
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
