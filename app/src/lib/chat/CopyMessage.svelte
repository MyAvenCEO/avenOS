<script lang="ts">
import { onDestroy } from 'svelte'

let { text }: { text: string } = $props()
let state = $state<'idle' | 'copying' | 'copied' | 'failed'>('idle')
let reset: ReturnType<typeof setTimeout> | undefined
let disposed = false
onDestroy(() => {
	disposed = true
	clearTimeout(reset)
})

async function copy() {
	if (state === 'copying') return
	clearTimeout(reset)
	state = 'copying'
	try {
		// Copy the message source, not rendered text, tool traces or feedback.
		await navigator.clipboard.writeText(text)
		if (disposed) return
		state = 'copied'
		reset = setTimeout(() => {
			state = 'idle'
		}, 2000)
	} catch {
		if (!disposed) state = 'failed'
	}
}
</script>

<button
	type="button"
	aria-label="Copy message"
	title={state === 'copied' ? 'Copied' : 'Copy message'}
	disabled={state === 'copying'}
	onclick={copy}
>
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if state === 'copied'}
			<path d="m5 12 4 4L19 6" />
		{:else}
			<rect x="8" y="8" width="12" height="13" rx="2" />
			<path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
		{/if}
	</svg>
</button>
<span class:failure={state === 'failed'} role="status">
	{state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy. Try again or select the text to copy manually.' : ''}
</span>

<style>
button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 34px;
	min-height: 34px;
	padding: 0.45rem;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	color: inherit;
	background: transparent;
	cursor: pointer;
	opacity: 0.65;
}
button:hover:not(:disabled) {
	opacity: 1;
	background: var(--color-surface-card);
	border-color: var(--color-border);
}
button:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 2px;
}
button:disabled {
	cursor: wait;
}
span {
	font-size: 0.75rem;
}
span:empty {
	display: none;
}
.failure {
	color: var(--color-error-ink, #a13822);
}
@media (pointer: coarse) {
	button {
		min-width: 44px;
		min-height: 44px;
	}
}
</style>
