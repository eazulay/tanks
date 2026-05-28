<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { updateName } from '$lib/mp.svelte.js';
	import Footer from '$lib/Footer.svelte';

	let playerName = $state('');
	let _ready = false;

	onMount(() => {
		playerName = localStorage.getItem('playerName') ?? '';
		_ready = true;
	});

	$effect(() => {
		if (_ready) {
			localStorage.setItem('playerName', playerName);
			updateName(playerName);
		}
	});

	const canMulti = $derived(playerName.trim().length > 0);
</script>

<main>
	<div class="content">
		<h1>Tank Supremo</h1>
		<p class="tagline">
			Command your tank across randomly generated terrain. Outmanoeuvre the enemy, master the
			slopes, and be the last one standing.
		</p>
		<div class="name-row">
			<label for="name-input">Your Name</label>
			<input
				id="name-input"
				type="text"
				bind:value={playerName}
				placeholder="Required for multiplayer"
				maxlength="20"
				autocomplete="off"
				spellcheck="false"
			/>
		</div>
		<div class="mode-buttons">
			<a href="/single" class="mode-btn">Single Player</a>
			<button class="mode-btn" disabled={!canMulti} onclick={() => goto('/multi')}>
				Multiplayer
			</button>
		</div>
		<p class="background-link">
			<a href="https://lnkd.in/efyrcuDc" target="_blank" rel="noopener noreferrer"
				>The story behind this game</a
			>
		</p>
	</div>
</main>
<Footer />

<style>
	main {
		margin: 0;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.content {
		text-align: center;
		max-width: 560px;
		padding: 2rem 2rem 1rem;
	}

	h1 {
		font-size: clamp(4rem, 12vw, 8rem);
		margin: 0 0 1.2rem;
	}

	.tagline {
		font-size: 1.04rem;
		font-weight: 400;
		line-height: 1.65;
		margin: 0 0 2rem;
	}

	.name-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		margin-bottom: 2.2rem;
	}

	.name-row label {
		font-size: 1rem;
		letter-spacing: 0.1em;
	}

	.name-row input {
		font-size: 1rem;
		color: #e8e0c8;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(212, 168, 50, 0.4);
		border-radius: 4px;
		padding: 0.5em 1em;
		width: 220px;
		text-align: center;
		outline: none;
		transition: border-color 0.15s;
	}

	.name-row input::placeholder {
		color: rgba(168, 184, 154, 0.65);
	}

	.name-row input:focus {
		border-color: var(--accent);
	}

	.mode-buttons {
		display: flex;
		gap: 1rem;
		justify-content: center;
		flex-wrap: wrap;
	}

	.mode-btn {
		display: inline-block;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.4rem;
		letter-spacing: 0.12em;
		color: #0a0f05;
		background: var(--accent);
		padding: 0.7em 2.6em;
		border-radius: 4px;
		text-decoration: none;
		border: none;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s;
		box-shadow: 0 4px 16px rgba(212, 168, 50, 0.35);
	}

	.mode-btn:hover {
		background: var(--accent-hover);
		transform: translateY(-2px);
		box-shadow: 0 6px 24px rgba(212, 168, 50, 0.5);
	}

	.mode-btn:active {
		transform: translateY(0);
		box-shadow: 0 2px 8px rgba(212, 168, 50, 0.3);
	}

	button.mode-btn:disabled {
		background: #3a3a2a;
		color: #5a5a4a;
		box-shadow: none;
		cursor: not-allowed;
		transform: none;
	}

	button.mode-btn:disabled:hover {
		background: #3a3a2a;
		transform: none;
		box-shadow: none;
	}

	.background-link {
		margin-top: 2rem;
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.background-link a {
		color: var(--accent);
		text-decoration: none;
	}

	.background-link a:hover {
		text-decoration: underline;
		color: var(--accent-hover);
	}
</style>
