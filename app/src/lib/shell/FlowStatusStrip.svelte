<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import type { Flow } from '@avenos/aven-skills'
import { listFlows } from '$lib/data/client'
import StatusCard from '$lib/intents/StatusCard.svelte'
import type { CardStatus } from '$lib/intents/types'

// board 0118d/e — the LIVE FLOW ASIDE (moved from the top strip; design borrowed from the testnet
// "intents" screen: StatusCard rows with colored side strips, mirrored for the right edge). When a
// turn routes to a skill, its flow (the same read-model as the Skills explorer) appears on the
// right with live per-step states — an OVERLAY, so the main stage stays centered.

type ToolStatus = {
	id: string
	name: string
	detail: string
	status: 'running' | 'done' | 'error'
	startedAt?: number
}
type FlowNode = { id: string; name?: string; actor?: string; flowRef?: string; note?: string }

let {
	skillId,
	toolActivity,
	nowMs
}: {
	skillId: string
	toolActivity: ToolStatus[]
	nowMs: number
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
function toolFor(n: FlowNode): ToolStatus | null {
	const matches = (tl: ToolStatus): boolean => {
		if (tl.name === n.actor || tl.name === n.id) return true
		if (n.actor === 'data_crud' && tl.name === 'data_crud')
			return String(tl.detail ?? '')
				.trim()
				.toLowerCase()
				.startsWith(String(n.id).toLowerCase())
		return false
	}
	return (
		toolActivity.find((tl) => tl.status === 'running' && matches(tl)) ??
		toolActivity.find((tl) => tl.status === 'error' && matches(tl)) ??
		toolActivity.find((tl) => tl.status === 'done' && matches(tl)) ??
		null
	)
}
function statusOf(tl: ToolStatus | null): CardStatus {
	if (!tl) return 'archived' // pending — the quiet driftwood strip
	if (tl.status === 'running') return 'running'
	if (tl.status === 'error') return 'error'
	return 'success'
}
function secondsOf(tl: ToolStatus | null): number {
	if (!tl || tl.status !== 'running' || !tl.startedAt) return 0
	return Math.max(0, Math.round((nowMs - tl.startedAt) / 1000))
}
</script>

{#if flow && nodes.length > 0}
	<aside
		class="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-60 flex-col pt-3 pr-2 pb-40 md:flex"
	>
		<div class="flex items-center justify-end gap-1.5 px-1 pb-1.5">
			<span class="font-display text-foreground/40 text-[10px] font-bold tracking-wider uppercase">
				{flow.name ?? skillId}
			</span>
		</div>
		<div class="pointer-events-auto flex min-h-0 flex-col gap-1.5 overflow-y-auto">
			{#each nodes as n (n.id)}
				{@const tl = toolFor(n)}
				<StatusCard
					status={statusOf(tl)}
					totalSeconds={secondsOf(tl)}
					title={(n.name ?? n.id) + (n.flowRef ? ' ▸' : '')}
					description={tl?.detail ?? n.note ?? n.actor ?? ''}
					selected={tl?.status === 'running'}
					showTimer={true}
					mirror={true}
					extraClass="w-full"
				/>
			{/each}
		</div>
	</aside>
{/if}
