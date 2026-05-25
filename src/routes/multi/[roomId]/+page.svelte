<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { mp, connect, send, leaveRoom, TANK_COLORS } from '$lib/mp.svelte.js';

	const routeRoomId = $derived(page.params.roomId ?? '');

	let playerName = $state('');
	let muted = $state(false);
	let now = $state(Date.now());
	let joinRequestSent = false;
	let wasInRoom = false;

	// ---- lifecycle ----

	onMount(() => {
		playerName = localStorage.getItem('playerName') ?? '';
		if (!playerName.trim()) {
			goto('/');
			return;
		}
		connect(playerName);

		if (mp.room?.roomId === routeRoomId) {
			joinRequestSent = true; // navigated from lobby — already in the room
		} else if (mp.connected) {
			joinRequestSent = true;
			mp.pendingRoomId = routeRoomId;
			mp.joinError = null;
			send({ type: 'request_join', roomId: routeRoomId });
		} else {
			mp.pendingRoomId = routeRoomId;
			mp.joinError = null;
		}
	});

	const ticker = setInterval(() => {
		now = Date.now();
	}, 500);
	onDestroy(() => clearInterval(ticker));

	// ---- reactive effects ----

	// Send join request once connected (direct URL navigation case)
	$effect(() => {
		if (mp.connected && mp.pendingRoomId === routeRoomId && !mp.room && !joinRequestSent) {
			joinRequestSent = true;
			send({ type: 'request_join', roomId: routeRoomId });
		}
	});

	// Navigate back to lobby when kicked or room dissolves after joining
	$effect(() => {
		if (mp.room?.roomId === routeRoomId) wasInRoom = true;
		if (wasInRoom && !mp.room && !mp.gameStart) goto('/multi');
	});

	// Navigate to game when it starts
	$effect(() => {
		if (mp.gameStart) {
			goto(`/game${muted ? '?muted=1' : ''}`);
		}
	});

	// ---- derived state ----

	const countdown = $derived(
		mp.room?.countdownEndsAt != null
			? Math.max(0, Math.ceil((mp.room.countdownEndsAt - now) / 1000))
			: null
	);

	const me = $derived(mp.room?.players.find((p) => p.clientId === mp.clientId) ?? null);

	const takenColors = $derived(
		new Set(mp.room?.players.filter((p) => p.clientId !== mp.clientId).map((p) => p.colorIndex))
	);

	const amStarter = $derived(mp.room?.startClickerIds.includes(mp.clientId ?? '') ?? false);
	const amCanceller = $derived(mp.room?.cancelClickerIds.includes(mp.clientId ?? '') ?? false);
	const amHost = $derived(me?.isHost ?? false);

	const maxAi = $derived(Math.min(4, 6 - (mp.room?.players.length ?? 1)));

	function toggleLock() {
		if (!mp.room) return;
		send({ type: 'lock_room', locked: !mp.room.locked });
	}

	const joinErrorLabel = $derived(
		mp.joinError === 'locked'
			? 'That room has already started its countdown.'
			: mp.joinError === 'full'
				? 'That room is full.'
				: mp.joinError === 'not_found'
					? 'Room not found.'
					: null
	);

	// ---- actions ----

	function leave() {
		leaveRoom();
		goto('/multi');
	}

	function pickColor(idx: number) {
		if (takenColors.has(idx)) return;
		send({ type: 'set_color', colorIndex: idx });
	}

	function setAi(n: number) {
		send({ type: 'set_ai_count', count: n });
	}

	function acceptJoin(clientId: string) {
		send({ type: 'accept_join', clientId });
		mp.pendingJoiners = mp.pendingJoiners.filter((j) => j.clientId !== clientId);
	}

	function clickStart() {
		send({ type: 'click_start' });
	}

	function clickCancel() {
		send({ type: 'click_cancel' });
	}
</script>

<main>
	<div class="content">

		<!-- Error / pending join states (no room yet) -->
		{#if joinErrorLabel}
			<div class="top-bar">
				<a href="/multi" class="back-link">← Lobby</a>
			</div>
			<h1>Tank Supremo</h1>
			<p class="subtitle">Multiplayer Mode</p>
			<div class="join-state error-state">
				<p class="state-msg">{joinErrorLabel}</p>
				<a href="/multi" class="btn-back-lobby">Back to Lobby</a>
			</div>

		{:else if !mp.room}
			<div class="top-bar">
				<a href="/multi" class="back-link">← Lobby</a>
				<span class="room-label">Room: <span class="room-code">{routeRoomId}</span></span>
			</div>
			<h1>Tank Supremo</h1>
			<p class="subtitle">Multiplayer Mode</p>
			<div class="join-state">
				<div class="spinner"></div>
				<p class="state-msg">Joining room <strong>{routeRoomId}</strong>…</p>
				<p class="state-hint">Waiting for a room member to accept your request.</p>
			</div>

		{:else}
			<!-- Full room view -->
			<div class="top-bar">
				<button class="back-link" onclick={leave}>← Leave</button>
				<span class="room-label">Room: <span class="room-code">{mp.room.roomId}</span></span>
				<span class="player-count">{mp.room.players.length} / {6 - mp.room.aiCount} players</span>
			</div>

			<!-- Players -->
			<section class="section">
				<h2 class="section-heading">Players</h2>
				{#each mp.room.players as player (player.clientId)}
					<div class="player-row" class:is-me={player.clientId === mp.clientId}>
						<span class="player-color-dot" style="background:{TANK_COLORS[player.colorIndex]}"></span>
						<span class="player-name">
							{player.name}
							{#if player.isHost}<span class="tag">host</span>{/if}
							{#if player.clientId === mp.clientId}<span class="tag tag-you">you</span>{/if}
						</span>
						{#if player.clientId === mp.clientId}
							<!-- Color picker for own row -->
							<div class="color-picker">
								{#each TANK_COLORS as color, idx}
									<button
										class="swatch"
										class:swatch-active={player.colorIndex === idx}
										class:swatch-taken={takenColors.has(idx)}
										style="background:{color}"
										disabled={takenColors.has(idx) || mp.room?.locked}
										title="Pick {color}"
										onclick={() => pickColor(idx)}
									></button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</section>

			<!-- AI opponents -->
			<section class="section section-ai">
				<span class="ai-label">AI Opponents</span>
				<div class="radio-group">
					{#each [0, 1, 2, 3, 4] as n}
						<label
							class="radio-chip"
							class:selected={mp.room.aiCount === n}
							class:disabled={n > maxAi || mp.room.locked}
						>
							<input
								type="radio"
								name="ai-count"
								value={n}
								checked={mp.room.aiCount === n}
								disabled={n > maxAi || mp.room.locked}
								onchange={() => setAi(n)}
							/>
							{n}
						</label>
					{/each}
				</div>
			</section>

			<!-- Mute sounds -->
			<section class="section section-ai">
				<label class="ai-label mute-label" for="mute-check">Mute Sounds</label>
				<label class="mute-toggle">
					<input id="mute-check" type="checkbox" bind:checked={muted} />
					<span class="mute-box" class:checked={muted}></span>
				</label>
			</section>

			<!-- Room access lock -->
			<section class="section section-ai">
				<span class="ai-label">Room Access</span>
				{#if amHost}
					<button
						class="btn-lock"
						class:btn-lock-on={mp.room.locked}
						disabled={mp.room.countdownEndsAt !== null}
						onclick={toggleLock}
					>
						{mp.room.locked ? 'Locked' : 'Open'}
					</button>
				{:else if mp.room.locked}
					<span class="lock-badge">Locked</span>
				{:else}
					<span class="lock-open">Open</span>
				{/if}
			</section>

			<!-- Pending join requests -->
			{#if mp.pendingJoiners.length > 0}
				<section class="section section-joiners">
					<h2 class="section-heading">Join Requests</h2>
					{#each mp.pendingJoiners as joiner (joiner.clientId)}
						<div class="joiner-row">
							<span class="joiner-name">{joiner.name} wants to join</span>
							<button class="btn-accept" onclick={() => acceptJoin(joiner.clientId)}>Accept</button>
						</div>
					{/each}
				</section>
			{/if}

			<!-- Countdown + action button -->
			<div class="action-area">
				{#if countdown !== null}
					<div class="countdown-row">
						<div class="countdown-bar-wrap">
							<div class="countdown-bar" style="width:{(countdown / 30) * 100}%"></div>
						</div>
						<span class="countdown-num">{countdown}s</span>
					</div>
					<p class="countdown-hint">
						{#if amCanceller}
							Cancelling… waiting for others.
						{:else if amStarter}
							Game starting — all starters must cancel to abort.
						{:else}
							Countdown started! Click below to commit or be removed.
						{/if}
					</p>
				{:else}
					<p class="waiting-hint">
						{mp.room.players.length < 2
							? 'Share your room code with a friend to start a game.'
							: 'All players ready? Click Start Game.'}
					</p>
				{/if}

				{#if amStarter && !amCanceller && countdown !== null}
					<button class="btn-action btn-cancel" onclick={clickCancel}>Cancel</button>
				{:else if !amCanceller}
					<button
						class="btn-action btn-start"
						disabled={mp.room.players.length < 2}
						onclick={clickStart}
					>
						Start Game
					</button>
				{:else}
					<button class="btn-action btn-start" disabled>Cancelling…</button>
				{/if}
			</div>
		{/if}

	</div>
</main>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap');

	main {
		margin: 0;
		min-height: 100vh;
		background: radial-gradient(ellipse at 60% 40%, #2a3a1a 0%, #111a08 60%, #0a0f05 100%);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 2rem 1rem 3rem;
	}

	.content {
		width: 100%;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	/* ---- Header bar ---- */

	.top-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.8rem;
	}

	.back-link {
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #7a8a6a;
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		transition: color 0.15s;
		flex-shrink: 0;
	}

	.back-link:hover {
		color: #a8b89a;
	}

	.room-label {
		flex: 1;
		text-align: center;
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #5a6a4a;
		letter-spacing: 0.04em;
	}

	.room-code {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		letter-spacing: 0.2em;
		color: #d4a832;
	}

	.player-count {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #5a6a4a;
		flex-shrink: 0;
	}

	h1 {
		font-family: 'Bebas Neue', sans-serif;
		font-size: clamp(2.5rem, 7vw, 4.5rem);
		letter-spacing: 0.06em;
		color: #d4a832;
		text-shadow:
			0 2px 4px rgba(0, 0, 0, 0.8),
			0 0 40px rgba(212, 168, 50, 0.25);
		margin: 0 0 0.1rem;
		line-height: 1;
		text-align: center;
	}

	.subtitle {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1rem;
		letter-spacing: 0.2em;
		color: #7a8a6a;
		margin: 0 0 1.8rem;
		text-align: center;
	}

	/* ---- Joining / error states ---- */

	.join-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
		padding: 2rem 1rem;
	}

	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid rgba(212, 168, 50, 0.2);
		border-top-color: #d4a832;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.state-msg {
		font-family: 'Inter', sans-serif;
		font-size: 1rem;
		color: #a8b89a;
		margin: 0;
		text-align: center;
	}

	.state-hint {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		color: #5a6a4a;
		margin: 0;
		text-align: center;
	}

	.error-state .state-msg {
		color: #c07050;
	}

	.btn-back-lobby {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		letter-spacing: 0.1em;
		color: #0a0f05;
		background: #d4a832;
		border-radius: 4px;
		padding: 0.5em 1.8em;
		text-decoration: none;
		margin-top: 0.5rem;
	}

	/* ---- Sections ---- */

	.section {
		margin-bottom: 1.4rem;
	}

	.section-heading {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 0.85rem;
		letter-spacing: 0.2em;
		color: #5a6a4a;
		margin: 0 0 0.6rem;
	}

	/* ---- Player rows ---- */

	.player-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.8rem;
		border-radius: 4px;
		margin-bottom: 0.3rem;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.player-row.is-me {
		border-color: rgba(212, 168, 50, 0.2);
		background: rgba(212, 168, 50, 0.04);
	}

	.player-color-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.player-name {
		flex: 1;
		font-family: 'Inter', sans-serif;
		font-size: 0.95rem;
		color: #a8b89a;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.tag {
		font-family: 'Inter', sans-serif;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		padding: 0.15em 0.5em;
		border-radius: 3px;
		color: #7a8a6a;
		background: rgba(122, 138, 106, 0.12);
		border: 1px solid rgba(122, 138, 106, 0.2);
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.tag-you {
		color: #d4a832;
		background: rgba(212, 168, 50, 0.1);
		border-color: rgba(212, 168, 50, 0.25);
	}

	/* ---- Color picker ---- */

	.color-picker {
		display: flex;
		gap: 5px;
		flex-shrink: 0;
	}

	.swatch {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
		transition:
			transform 0.1s,
			border-color 0.1s,
			opacity 0.15s;
	}

	.swatch:hover:not(:disabled) {
		transform: scale(1.2);
	}

	.swatch-active {
		border-color: #fff;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
	}

	.swatch-taken {
		opacity: 0.2;
		cursor: not-allowed;
	}

	/* ---- AI / mute sections ---- */

	.section-ai {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0.8rem;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 4px;
		margin-bottom: 1.4rem;
	}

	.ai-label {
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #8a9a7a;
	}

	/* ---- Radio chips ---- */

	.radio-group {
		display: flex;
		gap: 6px;
	}

	.radio-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 4px;
		border: 1px solid rgba(212, 168, 50, 0.3);
		background: rgba(212, 168, 50, 0.06);
		color: #8a9a7a;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		cursor: pointer;
		transition:
			background 0.12s,
			border-color 0.12s,
			color 0.12s,
			opacity 0.12s;
	}

	.radio-chip input {
		display: none;
	}

	.radio-chip:hover:not(.disabled) {
		background: rgba(212, 168, 50, 0.14);
		border-color: rgba(212, 168, 50, 0.5);
		color: #d4a832;
	}

	.radio-chip.selected {
		background: rgba(212, 168, 50, 0.2);
		border-color: #d4a832;
		color: #d4a832;
	}

	.radio-chip.disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	/* ---- Mute toggle ---- */

	.mute-label {
		cursor: default;
	}

	.mute-toggle {
		display: flex;
		align-items: center;
		cursor: pointer;
	}

	.mute-toggle input {
		display: none;
	}

	.mute-box {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		border: 1.5px solid rgba(212, 168, 50, 0.35);
		background: rgba(212, 168, 50, 0.06);
		transition:
			background 0.12s,
			border-color 0.12s;
		position: relative;
	}

	.mute-box.checked {
		background: rgba(212, 168, 50, 0.25);
		border-color: #d4a832;
	}

	.mute-box.checked::after {
		content: '';
		position: absolute;
		left: 4px;
		top: 1px;
		width: 5px;
		height: 9px;
		border: 2px solid #d4a832;
		border-top: none;
		border-left: none;
		transform: rotate(45deg);
	}

	/* ---- Lock toggle ---- */

	.btn-lock {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 0.3em 1em;
		border-radius: 3px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			opacity 0.15s;
		color: #8a9a7a;
		background: rgba(122, 138, 106, 0.1);
		border: 1px solid rgba(122, 138, 106, 0.25);
	}

	.btn-lock:hover:not(:disabled) {
		background: rgba(122, 138, 106, 0.2);
	}

	.btn-lock-on {
		color: #c0801a;
		background: rgba(192, 128, 26, 0.12);
		border-color: rgba(192, 128, 26, 0.35);
	}

	.btn-lock-on:hover:not(:disabled) {
		background: rgba(192, 128, 26, 0.22);
	}

	.btn-lock:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.lock-badge {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		font-weight: 500;
		color: #c0801a;
		background: rgba(192, 128, 26, 0.12);
		border: 1px solid rgba(192, 128, 26, 0.3);
		padding: 0.2em 0.7em;
		border-radius: 3px;
	}

	.lock-open {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #5a6a4a;
	}

	/* ---- Join requests ---- */

	.section-joiners {
		padding: 0.65rem 0.8rem;
		background: rgba(212, 168, 50, 0.04);
		border: 1px solid rgba(212, 168, 50, 0.15);
		border-radius: 4px;
	}

	.joiner-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.25rem 0;
	}

	.joiner-name {
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #a8b89a;
	}

	.btn-accept {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		font-weight: 600;
		color: #0a0f05;
		background: #7dce5a;
		border: none;
		border-radius: 3px;
		padding: 0.3em 0.9em;
		cursor: pointer;
		transition:
			background 0.12s,
			transform 0.1s;
	}

	.btn-accept:hover {
		background: #96e070;
		transform: translateY(-1px);
	}

	/* ---- Countdown + action area ---- */

	.action-area {
		margin-top: 0.6rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
	}

	.countdown-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.countdown-bar-wrap {
		flex: 1;
		height: 6px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 3px;
		overflow: hidden;
	}

	.countdown-bar {
		height: 100%;
		background: #d4a832;
		border-radius: 3px;
		transition: width 0.5s linear;
	}

	.countdown-num {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		color: #d4a832;
		min-width: 3ch;
		text-align: right;
	}

	.countdown-hint,
	.waiting-hint {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		color: #5a6a4a;
		margin: 0;
		text-align: center;
	}

	.btn-action {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.4rem;
		letter-spacing: 0.12em;
		border: none;
		border-radius: 4px;
		padding: 0.7em 2.6em;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s,
			opacity 0.15s;
	}

	.btn-start {
		color: #0a0f05;
		background: #d4a832;
		box-shadow: 0 4px 16px rgba(212, 168, 50, 0.35);
	}

	.btn-start:hover:not(:disabled) {
		background: #e8bf4a;
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(212, 168, 50, 0.5);
	}

	.btn-start:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.btn-cancel {
		color: #c07050;
		background: rgba(192, 112, 80, 0.12);
		border: 1px solid rgba(192, 112, 80, 0.35);
		box-shadow: none;
	}

	.btn-cancel:hover {
		background: rgba(192, 112, 80, 0.22);
		transform: translateY(-1px);
	}
</style>
