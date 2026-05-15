<main>
	<div class="content">
		<a href="/" class="back-link">← Back</a>
		<h1>Tank Royale</h1>
		<p class="subtitle">Multiplayer Mode</p>
		<p class="coming-soon">Coming soon</p>
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

	.coming-soon {
		font-family: 'Inter', sans-serif;
		font-size: 1rem;
		color: #5a6a4a;
	}
</style>
