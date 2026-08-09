<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { Actor } from './actor'

/**
 * One actor as a graph node: name, live-dot, and its contracts as pills —
 * requires on top, produces below. When a proof is active the node wears its
 * verdict: green ring if it carries a satisfied step, red if an unsatisfied
 * one, dimmed when it plays no part.
 */
const {
	data
}: {
	data: {
		actor: Actor
		hue: (p: string) => string
		verdict: 'satisfied' | 'unsatisfied' | 'idle' | null
	}
} = $props()

const m = $derived(data.actor.manifest)
const ring = $derived(
	data.verdict === 'satisfied'
		? 'border-status-success ring-2 ring-status-success/30'
		: data.verdict === 'unsatisfied'
			? 'border-status-error ring-2 ring-status-error/30'
			: data.verdict === 'idle'
				? 'border-foreground/5 opacity-40'
				: 'border-foreground/5'
)
</script>

<div
	class="w-52 rounded-xl border bg-[#fffdf7] px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] transition-all {ring}"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 pb-1">
		<span
			class="size-1.5 shrink-0 rounded-full {data.actor.instanceState()
				? 'bg-status-success'
				: 'bg-foreground/20'}"
		></span>
		<span class="font-medium text-sm leading-tight">{m.name}</span>
		<span class="ml-auto font-mono text-[0.625rem] text-foreground/35">{m.id}</span>
	</div>
	<div class="flex flex-wrap gap-1">
		{#each data.actor.requires as r, i (`r${i}`)}
			<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.hue(r)}">{r}</span>
		{/each}
	</div>
	{#if data.actor.requires.length > 0 && data.actor.produces.length > 0}
		<div class="py-0.5 text-center text-[0.625rem] text-foreground/25">↓</div>
	{/if}
	<div class="flex flex-wrap gap-1">
		{#each data.actor.produces as p, i (`p${i}`)}
			<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.hue(p)}">{p}</span>
		{/each}
	</div>
	<Handle type="source" position={Position.Right} />
</div>
