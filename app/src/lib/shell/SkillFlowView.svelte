<script lang="ts">
import type { Flow, RecipeNode } from '@avenos/aven-skills'
import { isComposite } from '@avenos/aven-skills'
import { createQuery } from '@tanstack/svelte-query'
import { listFlows } from '$lib/data/client'
import FlowGraph from '$lib/shell/FlowGraph.svelte'

// board 0119k — the FLOWS tab: the node tree of the skill SELECTED IN THE LEFT ASIDE (no own
// switcher — one selection source). Same read-model + FlowGraph as the DB Skills explorer; a
// composite node dives into its sub-skill (transient — reset when the aside selection changes).

let { skillId = null }: { skillId?: string | null } = $props()

const flowsQuery = createQuery(() => ({ queryKey: ['flows'], queryFn: listFlows }))
const flows = $derived<Flow[]>((flowsQuery.data ?? []) as Flow[])

// composite-dive override; cleared whenever the left aside picks a different skill.
let dived = $state<string | null>(null)
$effect(() => {
	void skillId
	dived = null
})
const activeId = $derived(dived ?? skillId ?? (flows[0]?.id ?? null))
const flow = $derived<Flow | null>(flows.find((f) => f.id === activeId) ?? null)
const nodeById = $derived(new Map((flow?.nodes ?? []).map((n) => [n.id, n])))

let selectedNodeId = $state<string | null>(null)
function onSelect(id: string): void {
	const n = nodeById.get(id) as RecipeNode | undefined
	if (n && isComposite(n) && n.flowRef) {
		dived = n.flowRef // dive into the sub-skill
		selectedNodeId = null
	} else {
		selectedNodeId = id
	}
}
</script>

<div class="flex h-full min-h-0 flex-col">
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
