<script lang="ts">
	import { goto } from '$app/navigation';
	import { unlockAudio } from '$lib/audioUnlock';

	let opponents = $state(1);
	let muted = $state(false);

	function startGame(e: MouseEvent) {
		e.preventDefault();
		unlockAudio();
		goto(`/game?opponents=${opponents}${muted ? '&muted=1' : ''}`);
	}
</script>

<main>
	<div class="content">
		<a href="/" class="back-link">← Back</a>
		<h1>Tank Royale</h1>
		<p class="subtitle">Single Player Mode</p>

		<div class="settings">
			<div class="setting-group">
				<span class="setting-label">AI Opponents</span>
				<div class="radio-group">
					{#each [1, 2, 3, 4, 5] as n}
						<label class="radio-chip" class:selected={opponents === n}>
							<input type="radio" name="opponents" value={n} bind:group={opponents} />
							{n}
						</label>
					{/each}
				</div>
			</div>
			<label class="mute-row">
				<input type="checkbox" bind:checked={muted} />
				<span class="mute-box" class:checked={muted}></span>
				Mute Sounds
			</label>
		</div>

		<a
			href="/game?opponents={opponents}{muted ? '&muted=1' : ''}"
			class="start-btn"
			onclick={startGame}>Start Game</a
		>
	</div>
</main>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500&display=swap');

	main {
		margin: 0;
		min-height: 100vh;
		background: radial-gradient(ellipse at 60% 40%, #2a3a1a 0%, #111a08 60%, #0a0f05 100%);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.content {
		position: relative;
		text-align: center;
		max-width: 560px;
		padding: 2rem;
	}

	.back-link {
		position: absolute;
		top: 0;
		left: 0;
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #7a8a6a;
		text-decoration: none;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: #a8b89a;
	}

	h1 {
		font-family: 'Bebas Neue', sans-serif;
		font-size: clamp(2.5rem, 7vw, 4.5rem);
		letter-spacing: 0.06em;
		color: #d4a832;
		text-shadow:
			0 2px 4px rgba(0, 0, 0, 0.8),
			0 0 40px rgba(212, 168, 50, 0.25);
		margin: 2rem 0 0.2rem;
		line-height: 1;
	}

	.subtitle {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1rem;
		letter-spacing: 0.2em;
		color: #7a8a6a;
		margin: 0 0 2rem;
	}

	.settings {
		margin-bottom: 2rem;
	}

	.setting-label {
		display: block;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 0.85rem;
		letter-spacing: 0.18em;
		color: #a8b89a;
		margin-bottom: 0.65rem;
	}

	.radio-group {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	.radio-chip {
		position: relative;
		cursor: pointer;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.35rem;
		letter-spacing: 0.1em;
		color: #7a8a6a;
		background: rgba(15, 22, 8, 0.7);
		border: 1px solid #2e3e20;
		border-radius: 4px;
		padding: 0.3em 1.2em;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
		user-select: none;
	}

	.radio-chip:hover {
		border-color: #5a6a4a;
		color: #a8b89a;
	}

	.radio-chip.selected {
		background: #d4a832;
		color: #0a0f05;
		border-color: #d4a832;
	}

	.radio-chip input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}

	.mute-row {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		font-size: 0.9rem;
		color: #a8b89a;
		user-select: none;
		margin-top: 1rem;
	}

	.mute-row:hover {
		color: #c8d8b8;
	}

	.mute-row input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.mute-box {
		width: 15px;
		height: 15px;
		border: 1px solid #3a4a2a;
		border-radius: 3px;
		background: rgba(15, 22, 8, 0.7);
		flex-shrink: 0;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.mute-row:hover .mute-box {
		border-color: #5a6a4a;
	}

	.mute-box.checked {
		background: #d4a832;
		border-color: #d4a832;
	}

	.mute-box.checked::after {
		content: '';
		display: block;
		width: 4px;
		height: 8px;
		border: 2px solid #0a0f05;
		border-top: none;
		border-left: none;
		transform: translate(5px, 1px) rotate(45deg);
	}

	.start-btn {
		display: inline-block;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.4rem;
		letter-spacing: 0.12em;
		color: #0a0f05;
		background: #d4a832;
		padding: 0.7em 2.6em;
		border-radius: 4px;
		text-decoration: none;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s;
		box-shadow: 0 4px 16px rgba(212, 168, 50, 0.35);
	}

	.start-btn:hover {
		background: #e8bf4a;
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(212, 168, 50, 0.5);
	}

	.start-btn:active {
		transform: translateY(0);
		box-shadow: 0 2px 8px rgba(212, 168, 50, 0.3);
	}
</style>
