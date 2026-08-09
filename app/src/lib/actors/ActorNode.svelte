<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { Actor } from './actor'

/**
 * One actor as a Svelte Flow node: name, tags, and its Prolog contracts as
 * pills — requires on top, produces below, each functor wearing one hashed
 * color everywhere it appears so producer and consumer link by eye even
 * before the edges are read.
 */
const { data }: { data: { actor: Actor; hue: (p: string) => string } } = $props()

const m = $derived(data.actor.manifest)
</script>

<div
	class="w-52 rounded-xl border border-foreground/5 bg-[#fffdf7] px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)]"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-baseline gap-2 pb-1">
		<span class="font-medium text-sm leading-tight">{m.name}</span>
		<span class="font-mono text-[0.625rem] text-foreground/35">{m.id}</span>
	</div>
	{#if m.methods.length > 0}
		<p class="pb-1 text-[0.625rem] text-foreground/40">{m.methods.length} Methoden</p>
	{/if}
	<div class="flex flex-wrap gap-1">
		{#each data.actor.requires as r (r)}
			<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.hue(r)}">{r}</span>
		{/each}
	</div>
	{#if data.actor.requires.length > 0 && data.actor.produces.length > 0}
		<div class="py-0.5 text-center text-[0.625rem] text-foreground/25">↓</div>
	{/if}
	<div class="flex flex-wrap gap-1">
		{#each data.actor.produces as p (p)}
			<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.hue(p)}">{p}</span>
		{/each}
	</div>
	<Handle type="source" position={Position.Right} />
</div>
