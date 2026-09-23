<script lang="ts">
	let {
		open = $bindable(false),
		endpoint = '/api/feedback',
		title = 'Send Feedback'
	}: { open?: boolean; endpoint?: string; title?: string } = $props();

	let message = $state('');
	let email = $state('');
	let name = $state('');
	let website = $state(''); // honeypot — real users never see or fill this
	let submitting = $state(false);
	let submitted = $state(false);
	let error = $state('');
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	// Re-read on every open, not just once at mount, so an edit to the name on
	// the main menu is reflected even without navigating away and back. Also
	// focuses the textarea — runs after the {#if open} block has rendered, so
	// textareaEl is already bound by the time this executes.
	$effect(() => {
		if (open) {
			name = localStorage.getItem('playerName') ?? '';
			textareaEl?.focus();
		}
	});

	function close() {
		open = false;
		// Delay resetting result state so it doesn't flash while the overlay fades.
		setTimeout(() => {
			submitted = false;
			error = '';
		}, 200);
	}

	async function submit(e: Event) {
		e.preventDefault();
		if (!message.trim()) {
			error = 'Please enter a message.';
			return;
		}
		submitting = true;
		error = '';
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message, email, name, website })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				if (data.error === 'invalid_email') {
					error = "That email address doesn't look right.";
				} else if (data.error === 'message_required') {
					error = 'Please enter a message.';
				} else {
					error = 'Something went wrong on our end. Please try again in a moment.';
				}
				return;
			}
			submitted = true;
			message = '';
			email = '';
		} catch {
			error = 'Something went wrong. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if open}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
	>
		<div class="modal">
			<h2>{title}</h2>
			{#if submitted}
				<p>Thanks for the feedback!</p>
				<button class="close-btn" onclick={close}>Close</button>
			{:else}
				<form onsubmit={submit}>
					<textarea
						bind:this={textareaEl}
						bind:value={message}
						placeholder="What's on your mind?"
						rows="4"
						maxlength="4000"
					></textarea>
					<input type="text" bind:value={name} placeholder="Name (optional)" maxlength="100" />
					<input type="email" bind:value={email} placeholder="Email (optional)" maxlength="320" />
					<p class="hint">
						Add your email if you're open to me following up, in case I have questions about your
						idea.
					</p>
					<input
						type="text"
						name="website"
						bind:value={website}
						class="website-field"
						tabindex="-1"
						autocomplete="off"
					/>
					{#if error}
						<p class="error">{error}</p>
					{/if}
					<div class="button-row">
						<button class="close-btn" type="submit" disabled={submitting}>
							{submitting ? 'Sending…' : 'Send'}
						</button>
						<button class="cancel-btn" type="button" onclick={close}>Cancel</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
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
		box-sizing: border-box;
		background: #111a08;
		border: 1px solid rgba(212, 168, 50, 0.25);
		border-radius: 8px;
		padding: 2rem 2.2rem;
		max-width: 600px;
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		width: calc(100% - 2rem);
	}

	h2 {
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.6rem;
		letter-spacing: 0.1em;
		color: var(--accent);
		margin: 0 0 1.2rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	textarea,
	input[type='text'],
	input[type='email'] {
		font-family: 'Inter', sans-serif;
		font-size: 0.875rem;
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(212, 168, 50, 0.25);
		border-radius: 4px;
		padding: 0.5em 0.7em;
		resize: vertical;
	}

	textarea:focus,
	input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.website-field {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	p {
		font-size: 0.875rem;
		line-height: 1.65;
		margin: 0 0 0.9rem;
	}

	.hint {
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-faint);
		margin: -0.3rem 0 0;
	}

	.error {
		color: #e88;
	}

	.button-row {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		margin-top: 0.4rem;
	}

	.cancel-btn {
		background: none;
		border: none;
		font-family: 'Inter', sans-serif;
		font-size: 0.875rem;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0.5em;
	}

	.cancel-btn:hover {
		color: var(--text-hover);
	}

	.close-btn {
		display: block;
		margin: 0.4rem auto 0;
		font-family: 'Bebas Neue', sans-serif;
		font-size: 1.1rem;
		letter-spacing: 0.12em;
		color: #0a0f05;
		background: var(--accent);
		border: none;
		border-radius: 4px;
		padding: 0.5em 2em;
		cursor: pointer;
		transition: background 0.15s;
	}

	.button-row .close-btn {
		margin: 0;
	}

	.close-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.close-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
