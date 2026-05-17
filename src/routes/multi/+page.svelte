<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { mp, connect, send, TANK_COLORS } from '$lib/mp.svelte.js';

	let playerName = $state('');

	onMount(() => {
		playerName = localStorage.getItem('playerName') ?? '';
		if (!playerName.trim()) {
			goto('/');
			return;
		}
		mp.kicked = false;
		mp.gameStart = null;
		connect(playerName);
	});

	// Navigate into the room as soon as we join one
	$effect(() => {
		if (mp.room) goto('/multi/' + mp.room.roomId);
	});

	function createRoom() {
		mp.joinError = null;
		mp.pendingRoomId = null;
		send({ type: 'create_room' });
	}

	function requestJoin(roomId: string) {
		if (mp.pendingRoomId === roomId) return;
		mp.pendingRoomId = roomId;
		mp.joinError = null;
		send({ type: 'request_join', roomId });
	}

	function clearPending() {
		send({ type: 'cancel_join' });
		mp.pendingRoomId = null;
		mp.joinError = null;
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
</script>

<main>
	<div class="content">
		<div class="top-bar">
			<a href="/" class="back-link">← Back</a>
			{#if playerName}
				<span class="playing-as">Playing as <strong>{playerName}</strong></span>
			{/if}
		</div>

		<h1>Tank Royale</h1>
		<p class="subtitle">Multiplayer Mode</p>

		<div class="status-row">
			<span class="dot" class:dot-on={mp.connected}></span>
			<span class="status-label">{mp.connected ? 'Connected' : 'Connecting…'}</span>
		</div>

		<p class="rooms-info">
			Create a room and share the code with friends, or request to join an existing one — the host
			decides who gets in. Fill empty slots with AI bots, then start when you're ready.
		</p>

		<div class="rooms-panel">
			{#if mp.rooms.length === 0}
				<p class="empty-msg">No open rooms. Create one to get started.</p>
			{:else}
				{#each mp.rooms as room (room.roomId)}
					<div class="room-row">
						<span class="room-code">{room.roomId}</span>
						<span class="room-players">
							{#each room.players as p}
								<span
									class="player-dot"
									style="background:{TANK_COLORS[p.colorIndex]}"
									title={p.name}
								></span>
							{/each}
							<span class="player-names"
								>{room.players.map((p) => p.name).join(', ')}{room.aiCount > 0
									? ` +${room.aiCount} AI`
									: ''}</span
							>
						</span>
						<span class="room-actions">
							{#if room.locked}
								<span class="badge-locked">Locked</span>
							{:else if room.playerCapacity === 0}
								<span class="badge-full">Full</span>
							{:else if mp.pendingRoomId === room.roomId}
								<span class="pending-label">Waiting…</span>
							{:else}
								<button
									class="btn-join"
									disabled={!mp.connected || mp.pendingRoomId !== null}
									onclick={() => requestJoin(room.roomId)}
								>
									Join
								</button>
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>

		{#if mp.pendingRoomId && !mp.joinError}
			<p class="pending-msg">
				Waiting for a member of <strong>{mp.pendingRoomId}</strong> to accept…
				<button class="btn-text" onclick={clearPending}>Cancel</button>
			</p>
		{/if}

		{#if joinErrorLabel}
			<p class="error-msg">
				{joinErrorLabel} <button class="btn-text" onclick={clearPending}>Dismiss</button>
			</p>
		{/if}

		<button
			class="btn-create"
			disabled={!mp.connected || mp.pendingRoomId !== null}
			onclick={createRoom}
		>
			+ Create Room
		</button>
	</div>
</main>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap');

	main {
		margin: 0;
		min-height: 100vh;
		background: radial-gradient(ellipse at 60% 40%, #2a3a1a 0%, #111a08 60%, #0a0f05 100%);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.content {
		width: 100%;
		max-width: 560px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.top-bar {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.6rem;
	}

	.back-link {
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #7a8a6a;
		text-decoration: none;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: #a8b89a;
	}

	.playing-as {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		color: #5a6a4a;
	}

	.playing-as strong {
		color: #a8b89a;
		font-weight: 600;
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
	}

	.subtitle {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1rem;
		letter-spacing: 0.2em;
		color: #7a8a6a;
		margin: 0 0 1.2rem;
	}

	.status-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.6rem;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #3a4a2a;
		transition: background 0.3s;
	}

	.dot-on {
		background: #7dce5a;
		box-shadow: 0 0 6px rgba(125, 206, 90, 0.6);
	}

	.status-label {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #5a6a4a;
	}

	.rooms-info {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		color: #a8b89a;
		text-align: center;
		margin: 0 0 1.4rem;
		line-height: 1.55;
	}

	/* ---- Room list ---- */

	.rooms-panel {
		width: 100%;
		border: 1px solid rgba(212, 168, 50, 0.15);
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.03);
		min-height: 54px;
		margin-bottom: 1rem;
		overflow: hidden;
	}

	.empty-msg {
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #4a5a3a;
		text-align: center;
		padding: 1.8rem 1rem;
		margin: 0;
	}

	.room-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		transition: background 0.12s;
	}

	.room-row:last-child {
		border-bottom: none;
	}

	.room-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.room-code {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1rem;
		letter-spacing: 0.15em;
		color: #d4a832;
		min-width: 68px;
	}

	.room-players {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.player-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.player-names {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		color: #8a9a7a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.room-actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.btn-join {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 0.95rem;
		letter-spacing: 0.1em;
		color: #0a0f05;
		background: #d4a832;
		border: none;
		border-radius: 3px;
		padding: 0.3em 1.1em;
		cursor: pointer;
		transition:
			background 0.12s,
			opacity 0.12s;
	}

	.btn-join:hover:not(:disabled) {
		background: #e8bf4a;
	}

	.btn-join:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.badge-locked,
	.badge-full {
		font-family: 'Inter', sans-serif;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.06em;
		padding: 0.2em 0.6em;
		border-radius: 3px;
	}

	.badge-locked {
		color: #c0801a;
		background: rgba(192, 128, 26, 0.15);
		border: 1px solid rgba(192, 128, 26, 0.3);
	}

	.badge-full {
		color: #7a8a6a;
		background: rgba(122, 138, 106, 0.12);
		border: 1px solid rgba(122, 138, 106, 0.25);
	}

	.pending-label {
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #6a7a5a;
		font-style: italic;
	}

	/* ---- Feedback messages ---- */

	.pending-msg,
	.error-msg {
		font-family: 'Inter', sans-serif;
		font-size: 0.85rem;
		margin: 0 0 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.pending-msg {
		color: #8a9a7a;
	}

	.error-msg {
		color: #c07050;
	}

	.btn-text {
		background: none;
		border: none;
		font-family: 'Inter', sans-serif;
		font-size: 0.8rem;
		color: #5a6a4a;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.btn-text:hover {
		color: #8a9a7a;
	}

	/* ---- Create Room button ---- */

	.btn-create {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.4rem;
		letter-spacing: 0.12em;
		color: #0a0f05;
		background: #d4a832;
		border: none;
		border-radius: 4px;
		padding: 0.7em 2.6em;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s,
			opacity 0.15s;
		box-shadow: 0 4px 16px rgba(212, 168, 50, 0.35);
		margin-top: 0.4rem;
	}

	.btn-create:hover:not(:disabled) {
		background: #e8bf4a;
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(212, 168, 50, 0.5);
	}

	.btn-create:active:not(:disabled) {
		transform: translateY(0);
		box-shadow: 0 2px 8px rgba(212, 168, 50, 0.3);
	}

	.btn-create:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>
