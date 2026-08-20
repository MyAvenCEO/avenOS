<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { FlowNodeDef } from './skill'

/**
 * One workflow node as an n8n-style card: kind badge, name, one-line
 * subtitle, and the recipe ports — requires down the left, provides down
 * the right, exactly where the derived wires attach. Triggers wear the
 * green entrance look; a door is another skill standing in one dashed box.
 */
const {
	data
}: {
	data: { node: FlowNodeDef; selected: boolean; door?: boolean }
} = $props()

const n = $derived(data.node)
const verb = $derived(n.type.split(':')[0])

const BADGE: Record<string, string> = {
	trigger: 'bg-[#2f5d50]/12 text-[#2f5d50]',
	llm: 'bg-[#c15b40]/12 text-[#9c4832]',
	route: 'bg-[#a06818]/12 text-[#a06818]',
	op: 'bg-[#5b7a9d]/15 text-[#46617f]',
	view: 'bg-[#7e6ead]/15 text-[#655687]',
	human: 'bg-[#8a6238]/15 text-[#8a6238]'
}
</script>

<div
	class="w-60 rounded-xl px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] transition-all {data.door
		? 'border-2 border-[#2f5d50]/50 border-dashed bg-[#2f5d50]/[0.04]'
		: n.kind === 'trigger'
			? 'border border-[#2f5d50]/40 bg-[#fffdf7]'
			: 'border border-foreground/5 bg-[#fffdf7]'} {data.selected
		? 'border-primary ring-2 ring-primary/20'
		: ''}"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 pb-1">
		<span
			class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.door
				? 'bg-[#2f5d50]/15 text-[#2f5d50]'
				: (BADGE[verb] ?? BADGE.op)}"
		>
			{data.door ? 'skill' : verb}
		</span>
		<span class="font-medium text-sm leading-tight">{data.door ? `→ ${n.name}` : n.name}</span>
		{#if n.live}
			<span class="ml-auto size-1.5 rounded-full bg-status-success" title="live"></span>
		{/if}
	</div>
	<p class="pb-1.5 text-[0.6875rem] text-foreground/50 leading-snug">{n.about}</p>
	<div class="flex gap-2">
		<ul class="flex min-w-0 flex-1 flex-col items-start gap-1">
			{#each n.requires ?? [] as f (f)}
				<li
					class="max-w-full truncate rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					→ {f}
				</li>
			{/each}
		</ul>
		<ul class="flex min-w-0 flex-1 flex-col items-end gap-1">
			{#each n.provides ?? [] as f (f)}
				<li
					class="max-w-full truncate rounded-md bg-surface-cream px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					{f}
					→
				</li>
			{/each}
		</ul>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
