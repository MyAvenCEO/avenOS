<script lang="ts">
import type { Flow, RecipeNode } from '@avenos/aven-skills'
import { isComposite } from '@avenos/aven-skills'
import { createQuery } from '@tanstack/svelte-query'
import { listFlows } from '$lib/data/client'
import FlowGraph from '$lib/shell/FlowGraph.svelte'

// board 0119k — the FLOWS tab: the routed skill's node tree full-screen (same read-model + FlowGraph
// as the DB Skills explorer, no left/right asides). A composite node navigates into its sub-skill;
// a skill switcher rides across the top so the whole map is browsable.

let { skillId = null }: { skillId?: string | null } = $props()

const flowsQuery = createQuery(() => ({ queryKey: ['flows'], queryFn: listFlows }))
const flows = $derived<Flow[]>((flowsQuery.data ?? []) as Flow[])

let picked = $state<string | null>(null)
// Follow the routed skill until the user picks one explicitly here.
const activeId = $derived(picked ?? skillId ?? (flows[0]?.id ?? null))
const flow = $derived<Flow | null>(flows.find((f) => f.id === activeId) ?? null)
const nodeById = $derived(new Map((flow?.nodes ?? []).map((n) => [n.id, n])))

let selectedNodeId = $state<string | null>(null)
function onSelect(id: string): void {
	const n = nodeById.get(id) as RecipeNode | undefined
	if (n && isComposite(n) && n.flowRef) {
		picked = n.flowRef // dive into the sub-skill
		selectedNodeId = null
	} else {
		selectedNodeId = id
	}
}
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- skill switcher: same brand chrome as the tabs/nav -->
	<div
		class="font-display flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-2 text-[10px] font-bold tracking-wider uppercase"
	>
		{#each flows as f, i (f.id)}
			{#if i > 0}<span class="select-none opacity-25" aria-hidden="true">|</span>{/if}
			<button
				type="button"
				class="transition-opacity hover:opacity-80 {activeId === f.id ? 'opacity-95' : 'opacity-40'}"
				onclick={() => {
					picked = f.id
					selectedNodeId = null
				}}
			>
				{f.name ?? f.id}
			</button>
		{/each}
	</div>
	<div class="border-border bg-surface-card min-h-0 flex-1 overflow-hidden rounded-[var(--radius-xl)] border">
		{#if flow}
			{#key flow.id}
				<FlowGraph {flow} {selectedNodeId} {onSelect} />
			{/key}
		{:else}
			<div class="text-muted-foreground flex h-full items-center justify-center text-sm">
				No flow for this skill.
			</div>
		{/if}
	</div>
</div>
