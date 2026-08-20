<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { Actor } from './model'

/**
 * One actor as a canvas node: gestalt badge, name, its verb, and the
 * declared capabilities as pills — requires down the left, provides down
 * the right, exactly where the derived wires attach. A coordinator is a
 * dashed violet door: a whole actor colony standing in one box, click
 * to walk in.
 */
const { data }: { data: { actor: Actor; selected: boolean; door?: boolean } } = $props()

const a = $derived(data.actor)
const m = $derived(a.manifest)
const isCoordinator = $derived((a.members?.length ?? 0) > 0)
const verb = $derived(m.type?.split(':')[0] ?? 'coordinator')

const BADGE: Record<string, string> = {
	ingest: 'bg-[#2f5d50]/12 text-[#2f5d50]',
	source: 'bg-[#2f5d50]/12 text-[#2f5d50]',
	llm: 'bg-[#c15b40]/12 text-[#9c4832]',
	route: 'bg-[#a06818]/12 text-[#a06818]',
	human: 'bg-[#8a6238]/15 text-[#8a6238]',
	transform: 'bg-[#5b7a9d]/15 text-[#46617f]',
	check: 'bg-[#5b7a9d]/15 text-[#46617f]',
	sink: 'bg-[#c15b40]/12 text-[#9c4832]',
	coordinator: 'bg-[#7e6ead]/15 text-[#655687]'
}
</script>

<div
	class="w-64 rounded-xl px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] transition-all {data.door
		? 'border-2 border-[#2f5d50]/50 border-dashed bg-[#2f5d50]/[0.04]'
		: isCoordinator
			? 'border-2 border-[#7e6ead]/50 border-dashed bg-[#7e6ead]/[0.04]'
			: 'border border-foreground/5 bg-[#fffdf7]'} {data.selected
		? 'border-primary ring-2 ring-primary/20'
		: ''}"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 pb-1">
		<span
			class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.door
				? 'bg-[#2f5d50]/15 text-[#2f5d50]'
				: (BADGE[verb] ?? BADGE.transform)}"
		>
			{data.door ? 'skill' : verb}
		</span>
		<span class="font-medium text-sm leading-tight">{data.door ? `→ ${m.name}` : m.name}</span>
	</div>
	<div class="flex items-center gap-1.5 pb-1.5">
		{#if data.door}
			<span class="font-mono text-[#2f5d50] text-[0.625rem]">inferred boundary</span>
			<span class="ml-auto text-[#2f5d50] text-[0.625rem]">open →</span>
		{:else if isCoordinator}
			<span class="font-mono text-[#655687] text-[0.625rem]">{a.members?.length} members</span>
			<span class="ml-auto text-[#655687] text-[0.625rem]">open →</span>
		{:else}
			<span class="font-mono text-[0.625rem] text-foreground/40">{m.type}</span>
			{#if m.llm}
				<span
					class="rounded-md bg-[#c15b40]/10 px-1.5 py-0.5 font-mono text-[#9c4832] text-[0.625rem]"
					title={m.llm.purpose}
				>
					LLM
				</span>
			{/if}
		{/if}
	</div>
	<div class="flex gap-2">
		<ul class="flex min-w-0 flex-1 flex-col items-start gap-1">
			{#each m.requires ?? [] as f (f)}
				<li
					class="max-w-full truncate rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					→ {f}
				</li>
			{/each}
		</ul>
		<ul class="flex min-w-0 flex-1 flex-col items-end gap-1">
			{#each m.provides ?? [] as f (f)}
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
