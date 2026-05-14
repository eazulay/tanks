// AudioContext created inside a user gesture on the landing page.
// Persists across SvelteKit client-side navigation so the game page can
// hand it to Three.js before the Canvas renders, avoiding iOS audio lock.
export let unlockedCtx: AudioContext | null = null;

export function unlockAudio() {
	if (typeof window !== 'undefined' && typeof AudioContext !== 'undefined') {
		unlockedCtx = new AudioContext();
	}
}
