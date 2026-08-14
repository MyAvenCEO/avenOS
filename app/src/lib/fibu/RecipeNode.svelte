<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { RecipeNodeConfig } from './recipe-config'

/**
 * One recipe step as a canvas node: kind badge, name, its transform type,
 * and the named ports as pills — inputs on top, outputs below. The shape
 * mirrors GraphNode (actors), because a step IS actor-shaped: ports are its
 * contract, the transform its behavior.
 *
 * A subflow is the exception that proves it: same port contract, but a
 * dashed violet border and an "open" affordance instead of a transform —
 * it is a whole flow standing in one box, and clicking it goes inside.
 * An `any`-port wears ∨ (either/or); an LLM-backed step wears an LLM chip.
 */
const { data }: { data: { node: RecipeNodeConfig; selected: boolean } } = $props()

const n = $derived(data.node)
const isSubflow = $derived(n.kind === 'subflow')
const isHandoff = $derived(n.kind === 'handoff')

const KIND_STYLE: Record<string, { badge: string; label: string }> = {
	input: { badge: 'bg-[#2f5d50]/12 text-[#2f5d50]', label: 'Input' },
	transform: { badge: 'bg-[#5b7a9d]/15 text-[#46617f]', label: 'Transform' },
	route: { badge: 'bg-[#a06818]/12 text-[#a06818]', label: 'Route' },
	hitl: { badge: 'bg-[#8a6238]/15 text-[#8a6238]', label: 'HITL' },
	subflow: { badge: 'bg-[#7e6ead]/15 text-[#655687]', label: 'Subflow' },
	handoff: { badge: 'bg-[#2f5d50]/15 text-[#2f5d50]', label: 'Skill' },
	output: { badge: 'bg-[#c15b40]/12 text-[#9c4832]', label: 'Output' }
}
</script>

<div
	class="w-64 rounded-xl px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] transition-all {isSubflow
		? 'border-2 border-[#7e6ead]/50 border-dashed bg-[#7e6ead]/[0.04]'
		: isHandoff
			? 'border-2 border-[#2f5d50]/50 border-dashed bg-[#2f5d50]/[0.04]'
			: 'border border-foreground/5 bg-[#fffdf7]'} {data.selected
		? 'border-primary ring-2 ring-primary/20'
		: ''}"
>
	{#if n.kind !== 'input'}
		<Handle type="target" position={Position.Left} />
	{/if}
	<div class="flex items-center gap-1.5 pb-1">
		<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {KIND_STYLE[n.kind].badge}">
			{KIND_STYLE[n.kind].label}
		</span>
		<span class="font-medium text-sm leading-tight">{n.name}</span>
	</div>
	<div class="flex items-center gap-1.5 pb-1.5">
		{#if isSubflow}
			<span class="font-mono text-[#655687] text-[0.625rem]">{n.subflow?.recipe}</span>
			<span class="ml-auto text-[#655687] text-[0.625rem]">öffnen →</span>
		{:else if isHandoff}
			<span class="font-mono text-[#2f5d50] text-[0.625rem]">{n.handoff?.skill}</span>
			<span class="ml-auto text-[#2f5d50] text-[0.625rem]">öffnen →</span>
		{:else}
			<span class="font-mono text-[0.625rem] text-foreground/40">{n.transform.type}</span>
			{#if n.llm}
				<span
					class="rounded-md bg-[#c15b40]/10 px-1.5 py-0.5 font-mono text-[#9c4832] text-[0.625rem]"
					title={n.llm.purpose}
				>
					LLM
				</span>
			{/if}
		{/if}
	</div>
	<!-- Ports where the wires are: in-ports listed down the left edge,
	     out-ports down the right, so a node reads the same way the graph
	     flows. -->
	<div class="flex gap-2">
		<ul class="flex min-w-0 flex-1 flex-col items-start gap-1">
			{#each n.inputs as port (port.name)}
				<li
					class="max-w-full truncate rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]"
					title={port.mode === 'any' ? `${port.name} — entweder/oder` : port.name}
				>
					→ {port.name}{port.mode === 'any' ? ' ∨' : ''}
				</li>
			{/each}
		</ul>
		<ul class="flex min-w-0 flex-1 flex-col items-end gap-1">
			{#each n.outputs as port (port.name)}
				<li
					class="max-w-full truncate rounded-md bg-surface-cream px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					{port.name}
					→
				</li>
			{/each}
		</ul>
	</div>
	{#if n.kind !== 'output'}
		<Handle type="source" position={Position.Right} />
	{/if}
</div>
