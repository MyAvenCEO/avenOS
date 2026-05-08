<script lang="ts">
import { contextHeadingParts } from '$lib/aven/context-heading-display'

	let {
		heading,
		compact = false
	}: {
		heading: string
		compact?: boolean
	} = $props()

	const p = $derived(contextHeadingParts(heading))
</script>

<span
	class="inline-flex flex-wrap items-baseline gap-1.5 {compact
		? 'font-mono text-[10px] font-semibold tracking-tight'
		: ''}"
>
	{#each p.segments as seg (seg.label + seg.className)}
		<span
			class="inline-flex shrink-0 rounded-md border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide {seg.className}"
			>{seg.label}</span
		>
	{/each}
	{#if p.tail}
		<span class="min-w-0 normal-case wrap-break-word opacity-85">{p.tail}</span>
	{/if}
</span>
