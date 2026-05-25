<script>
	let open = $state(false);
</script>

<footer>
	© 2026 Eyal Azulay. All rights reserved.
	<button class="policy-link" onclick={() => (open = true)}>Privacy Policy</button>
</footer>

{#if open}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Privacy Policy"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	>
		<div class="modal">
			<h2>Privacy Policy</h2>
			<p>
				Tank Supremo stores your chosen player name and game preferences (such as opponent count and
				mute setting) in your browser's local storage. This data never leaves your device and is not
				transmitted to any server.
			</p>
			<p>
				When you play multiplayer, your player name and your device's IP address are processed
				transiently by the game server solely to route game traffic. No personal data is logged,
				stored persistently, or shared with any third party, except Cloudflare which processes
					traffic in transit (see below).
			</p>
			<p>
				No cookies or client-side tracking are used. This site is served through Cloudflare, which
					processes visitor IP addresses for routing, security, and aggregated anonymous analytics.
					See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare's Privacy Policy</a>.
			</p>
			<button class="close-btn" onclick={() => (open = false)}>Close</button>
		</div>
	</div>
{/if}

<style>
	footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		text-align: center;
		padding: 0.6rem;
		font-family: 'Inter', sans-serif;
		font-size: 0.72rem;
		color: rgba(168, 184, 154, 0.7);
		pointer-events: none;
		user-select: none;
	}

	.policy-link {
		pointer-events: all;
		background: none;
		border: none;
		font-family: 'Inter', sans-serif;
		font-size: 0.72rem;
		color: rgba(168, 184, 154, 0.7);
		cursor: pointer;
		padding: 0;
		margin-left: 0.6rem;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.policy-link:hover {
		color: rgba(212, 168, 50, 0.85);
	}

	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: #111a08;
		border: 1px solid rgba(212, 168, 50, 0.25);
		border-radius: 8px;
		padding: 2rem 2.2rem;
		max-width: 480px;
		width: calc(100% - 2rem);
		font-family: 'Inter', sans-serif;
		color: #a8b89a;
	}

	h2 {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.6rem;
		letter-spacing: 0.1em;
		color: #d4a832;
		margin: 0 0 1.2rem;
	}

	p {
		font-size: 0.875rem;
		line-height: 1.65;
		margin: 0 0 0.9rem;
	}

	p:last-of-type {
		margin-bottom: 1.4rem;
	}

	p a {
		color: #d4a832;
		text-underline-offset: 2px;
	}

	p a:hover {
		color: #e8bf4a;
	}

	.close-btn {
		display: block;
		margin: 0 auto;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		letter-spacing: 0.12em;
		color: #0a0f05;
		background: #d4a832;
		border: none;
		border-radius: 4px;
		padding: 0.5em 2em;
		cursor: pointer;
		transition: background 0.15s;
	}

	.close-btn:hover {
		background: #e8bf4a;
	}
</style>
