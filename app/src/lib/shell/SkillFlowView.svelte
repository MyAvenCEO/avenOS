<script lang="ts">
import type { Flow, RecipeNode } from '@avenos/aven-skills'
import { isComposite } from '@avenos/aven-skills'
import { createQuery } from '@tanstack/svelte-query'
import { listFlows } from '$lib/data/client'
import FlowGraph from '$lib/shell/FlowGraph.svelte'

// board 0119k — the FLOWS tab: the node tree of the skill SELECTED IN THE LEFT ASIDE (no own
// switcher — one selection source). Same read-model + FlowGraph as the DB Skills explorer; a
// composite node dives into its sub-skill (transient — reset when the aside selection changes).

let {
	skillId = null,
	onNodeSelect
}: {
	skillId?: string | null
	/** emits the selected LEAF node's actor id + the skill it lives in + the NODE itself (it carries
	 * step-level overrides like vibe/hitl that overlay the shared actor config). */
	onNodeSelect?: (actorName: string | null, inSkill: string | null, node?: RecipeNode | null) => void
} = $props()

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
		onNodeSelect?.(null, null, null)
	} else {
		selectedNodeId = id
		// the node id is the WORKFLOW STEP (read/create/edit/delete); the implementing ACTOR is
		// n.actor (e.g. data_crud) — that's what carries the config. The node rides along for its
		// step-level overrides (vibe/hitl).
		onNodeSelect?.(n?.actor ?? id, activeId, n ?? null)
	}
}
// clear the detail selection whenever the shown skill changes.
$effect(() => {
	void activeId
	selectedNodeId = null
	onNodeSelect?.(null, null, null)
})
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="border-border bg-surface-cream min-h-0 flex-1 overflow-hidden rounded-[var(--radius-xl)] border">
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
