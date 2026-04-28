<main>
	<div class="content">
		<h1>Tank Royale</h1>
		<p class="tagline">
			Command your tank across randomly generated terrain. Outmaneuver the enemy, master the slopes, and be the last one standing.
		</p>
		<a href="/game/" class="start-btn">Start Game</a>
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
		text-align: center;
		max-width: 560px;
		padding: 2rem;
	}

	h1 {
		font-family: 'Bebas Neue', sans-serif;
		font-size: clamp(4rem, 12vw, 8rem);
		letter-spacing: 0.06em;
		color: #d4a832;
		text-shadow:
			0 2px 4px rgba(0, 0, 0, 0.8),
			0 0 40px rgba(212, 168, 50, 0.25);
		margin: 0 0 1.2rem;
		line-height: 1;
	}

	.tagline {
		font-family: 'Inter', sans-serif;
		font-size: 1.05rem;
		font-weight: 400;
		color: #a8b89a;
		line-height: 1.65;
		margin: 0 0 2.4rem;
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
