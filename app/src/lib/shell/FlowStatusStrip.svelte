<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import type { Flow } from '@avenos/aven-skills'
import { listFlows } from '$lib/data/client'

// board 0118d — the LIVE FLOW STRIP: when a turn routes to a skill, its flow (the same read-model
// the Skills explorer renders) shows at the top of the screen with per-step states, driven by the
// SAME tool events as the activity chips — so the user always knows where in the workflow we are.

type ToolStatus = {
	id: string
	name: string
	detail: string
	status: 'running' | 'done' | 'error'
}
type FlowNode = { id: string; name?: string; actor?: string; flowRef?: string }

let {
	skillId,
	toolActivity
}: {
	skillId: string
	toolActivity: ToolStatus[]
} = $props()

const flowsQuery = createQuery(() => ({ queryKey: ['flows'], queryFn: listFlows }))
const flow = $derived<Flow | null>(
	((flowsQuery.data ?? []) as Flow[]).find((f) => f.id === skillId) ?? null
)
const nodes = $derived(
	(((flow?.nodes ?? []) as FlowNode[]) || []).filter((n) => n.id !== 'dispatch')
)

/** Map a tool event onto a flow node: by actor name, node id, or (for the shared data_crud actor)
 *  the action verb leading the chip detail ("create transaction" → node `create`). */
function matches(tl: ToolStatus, n: FlowNode): boolean {
	if (tl.name === n.actor || tl.name === n.id) return true
	if (n.actor === 'data_crud' && tl.name === 'data_crud')
		return String(tl.detail ?? '')
			.trim()
			.toLowerCase()
			.startsWith(String(n.id).toLowerCase())
	return false
}
function stateOf(n: FlowNode): 'running' | 'done' | 'error' | 'idle' {
	if (toolActivity.some((tl) => tl.status === 'running' && matches(tl, n))) return 'running'
	if (toolActivity.some((tl) => tl.status === 'error' && matches(tl, n))) return 'error'
	if (toolActivity.some((tl) => tl.status === 'done' && matches(tl, n))) return 'done'
	return 'idle'
}
</script>

{#if flow && nodes.length > 0}
	<div class="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-4">
		<div
			class="border-border bg-card/95 pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border px-3 py-1.5 shadow-sm backdrop-blur"
		>
			<span class="text-foreground pr-1 text-[11px] font-semibold whitespace-nowrap">
				{flow.name ?? skillId}
			</span>
			{#each nodes as n, i (n.id)}
				{@const st = stateOf(n)}
				{#if i > 0}
					<span class="text-muted-foreground/40 text-[10px]">→</span>
				{/if}
				<span
					class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap {st ===
					'running'
						? 'bg-primary/10 text-foreground font-semibold'
						: st === 'done'
							? 'text-foreground'
							: st === 'error'
								? 'text-destructive'
								: 'text-muted-foreground/70'}"
					title={n.actor ?? n.flowRef ?? n.id}
				>
					{#if st === 'running'}
						<span class="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full"></span>
					{:else if st === 'done'}
						<span class="text-primary">✓</span>
					{:else if st === 'error'}
						<span>✕</span>
					{/if}
					{n.name ?? n.id}{#if n.flowRef}<span class="text-primary/70">▸</span>{/if}
				</span>
			{/each}
		</div>
	</div>
{/if}
