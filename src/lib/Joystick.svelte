<script lang="ts">
	let {
		onchange,
		label = '',
		taplabel = '',
		ontap
	}: {
		onchange: (dx: number, dy: number) => void;
		label?: string;
		taplabel?: string;
		ontap?: () => void;
	} = $props();

	const OUTER_R = 68;
	const INNER_R = 26;
	const MAX_TRAVEL = OUTER_R - INNER_R;
	const TAP_THRESHOLD = MAX_TRAVEL * 0.25;

	let knobX = $state(0);
	let knobY = $state(0);
	let touchId = $state<number | null>(null);
	let baseX = 0;
	let baseY = 0;
	let maxDisplacement = 0;

	function onStart(e: TouchEvent) {
		e.preventDefault();
		if (touchId !== null) return;
		const t = e.changedTouches[0];
		touchId = t.identifier;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		baseX = r.left + r.width / 2;
		baseY = r.top + r.height / 2;
		maxDisplacement = 0;
		update(t);
	}

	function onMove(e: TouchEvent) {
		e.preventDefault();
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier === touchId) {
				update(t);
				return;
			}
		}
	}

	function onEnd(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier === touchId) {
				touchId = null;
				knobX = 0;
				knobY = 0;
				onchange(0, 0);
				if (maxDisplacement < TAP_THRESHOLD) ontap?.();
				return;
			}
		}
	}

	function update(t: Touch) {
		const dx = t.clientX - baseX;
		const dy = t.clientY - baseY;
		const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
		maxDisplacement = Math.max(maxDisplacement, dist);
		const clamped = Math.min(dist, MAX_TRAVEL);
		knobX = (dx / dist) * clamped;
		knobY = (dy / dist) * clamped;
		onchange((dx / dist) * (clamped / MAX_TRAVEL), (dy / dist) * (clamped / MAX_TRAVEL));
	}
</script>

<div
	class="base"
	role="group"
	aria-label="joystick"
	ontouchstart={onStart}
	ontouchmove={onMove}
	ontouchend={onEnd}
	ontouchcancel={onEnd}
>
	<div
		class="knob"
		class:active={touchId !== null}
		style="transform: translate({knobX}px, {knobY}px)"
	></div>
	{#if taplabel}
		<span class="taplabel">{taplabel}</span>
	{/if}
	{#if label}
		<span class="label">{label}</span>
	{/if}
</div>

<style>
	.base {
		width: 136px;
		height: 136px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		border: 2px solid rgba(255, 255, 255, 0.25);
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
		user-select: none;
		position: relative;
		flex-shrink: 0;
	}

	.knob {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.35);
		border: 2px solid rgba(255, 255, 255, 0.55);
		position: absolute;
		pointer-events: none;
	}

	.knob.active {
		background: rgba(255, 255, 255, 0.6);
	}

	.taplabel {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		transform: translateY(-50%);
		text-align: center;
		font-size: 10px;
		font-family: sans-serif;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: rgba(0, 0, 0, 0.7);
		pointer-events: none;
		user-select: none;
	}

	.label {
		position: absolute;
		bottom: 10px;
		left: 0;
		right: 0;
		text-align: center;
		font-size: 13px;
		font-family: sans-serif;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: rgba(255, 255, 255, 0.8);
		pointer-events: none;
		user-select: none;
	}
</style>
