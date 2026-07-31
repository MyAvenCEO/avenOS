<!--
	The day/night dial. Writes to the shared timeOfDay store, so the world and
	the sandbox always stand in the same light, and calls back so the live
	scene can move its sun immediately.
-->
<script lang="ts">
import { timeOfDay } from '../game/timeOfDay.svelte'
import Icon from './Icon.svelte'

let { onchange }: { onchange?: (hour: number) => void } = $props()

function set(value: number): void {
	timeOfDay.hour = value
	onchange?.(timeOfDay.hour)
}

/** Which part of the day we are in — drawn, not typed. */
const phase = $derived(
	timeOfDay.hour < 6 || timeOfDay.hour >= 20
		? 'moon'
		: timeOfDay.hour < 8 || timeOfDay.hour >= 18
			? 'dusk'
			: 'sun'
) as 'moon' | 'dusk' | 'sun'
</script>

<div class="hud-pill pointer-events-auto !gap-3">
	<Icon name={phase} class="h-4 w-4 opacity-70" />
	<input
		type="range"
		min="0"
		max="24"
		step="0.25"
		aria-label="time of day"
		value={timeOfDay.hour}
		oninput={(e) => set(Number(e.currentTarget.value))}
		onwheel={(e) => e.preventDefault()}
	>
	<span class="hud-label tabular-nums">{timeOfDay.label}</span>
</div>

<style>
input[type="range"] {
	width: 9rem;
	appearance: none;
	height: 0.3rem;
	border-radius: 999px;
	background: linear-gradient(
		90deg,
		#2b3f5e 0%,
		#cfa88f 25%,
		#cde9ec 45%,
		#cde9ec 62%,
		#e8b48c 76%,
		#2b3f5e 100%
	);
	cursor: pointer;
}
input[type="range"]::-webkit-slider-thumb {
	appearance: none;
	width: 0.85rem;
	height: 0.85rem;
	border-radius: 999px;
	background: var(--color-cloud, #fff);
	border: 2px solid var(--color-ink, #333);
	cursor: grab;
}
input[type="range"]::-moz-range-thumb {
	width: 0.85rem;
	height: 0.85rem;
	border-radius: 999px;
	background: var(--color-cloud, #fff);
	border: 2px solid var(--color-ink, #333);
	cursor: grab;
}
</style>
