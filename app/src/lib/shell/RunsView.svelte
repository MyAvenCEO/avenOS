<script lang="ts">
import {
	currentStepIndex,
	type Flow,
	flattenFlow,
	type FlowRun,
	type NodeState,
	type RecipeNode
} from '@avenos/aven-skills'
import { createQuery } from '@tanstack/svelte-query'
import { listFlows, listRuns } from '$lib/data/client'
import { t } from '$lib/i18n'
import FlowGraph from '$lib/shell/FlowGraph.svelte'
import StepVibe from '$lib/shell/StepVibe.svelte'

// board 0083 — Runs view (3rd tab): the INSTANCE side, as a step-through explorer. Left = instance
// runs, center = the flow graph on top (click a node to step) + the step's vibe below, right = the
// detail logs of the run.
let { containerName = 'aven-vibes-runs' }: { containerName?: string } = $props()

// Flow CONFIGS load from the admin API (board 0087); RUNS are the user's REAL persisted runs
// (board 0090) — no fixtures. Keyed under ['data'] so the SSE 'data' event refetches after a run.
const flowsQuery = createQuery(() => ({ queryKey: ['flows'], queryFn: listFlows }))
const flows = $derived<Flow[]>(flowsQuery.data ?? [])
const runsQuery = createQuery(() => ({ queryKey: ['data', 'runs'], queryFn: listRuns }))
const runs = $derived<FlowRun[]>(runsQuery.data ?? [])

let selectedRunId = $state<string>('')
let selectedNodeId = $state<string | null>(null)
// Auto-select the newest run once they load (or when the selection falls out of the list).
$effect(() => {
	if (runs.length > 0 && !runs.some((r) => r.id === selectedRunId)) {
		selectedRunId = runs[0].id
		selectedNodeId = runs[0].trace[currentStepIndex(runs[0])]?.nodeId ?? null
	}
})

const selectedRun = $derived<FlowRun | null>(runs.find((r) => r.id === selectedRunId) ?? null)
// FLATTEN the flow (board 0093/0094): the trace records flattened step ids (e.g. `capture/extract`),
// so the graph + nodeById must be the flattened flow too — otherwise a clicked step can't resolve its
// node (→ no vibe) and sub-skills render collapsed. Flattening shows the sub-flow steps in full detail.
const rawFlow = $derived<Flow | null>(
	selectedRun ? (flows.find((f) => f.id === selectedRun.flowId) ?? null) : null
)
const flow = $derived<Flow | null>(rawFlow ? flattenFlow(rawFlow, flows) : null)
const nodeById = $derived(new Map((flow?.nodes ?? []).map((n) => [n.id, n])))
// One state per node, from the run's trace (last write wins) → colours the graph.
const nodeStates = $derived.by<Record<string, NodeState>>(() => {
	const m: Record<string, NodeState> = {}
	for (const s of selectedRun?.trace ?? []) m[s.nodeId] = s.state
	return m
})
const step = $derived(selectedRun?.trace.find((s) => s.nodeId === selectedNodeId) ?? null)
const node = $derived<RecipeNode | null>(step ? (nodeById.get(step.nodeId) ?? null) : null)

const RUN_DOT: Record<FlowRun['status'], string> = {
	running: 'bg-blue-500',
	done: 'bg-green-600',
	error: 'bg-red-600'
}
const STATE_DOT: Record<NodeState, string> = {
	idle: 'bg-muted-foreground/40',
	waiting: 'bg-amber-500',
	running: 'bg-blue-500',
	done: 'bg-green-600',
	error: 'bg-red-600',
	parked: 'bg-purple-500'
}

function flowName(id: string): string {
	return flows.find((f) => f.id === id)?.name ?? id
}
function selectRun(r: FlowRun): void {
	selectedRunId = r.id
	selectedNodeId = r.trace[currentStepIndex(r)]?.nodeId ?? null
}
// Clicking a node in the graph (or a log line) steps the explorer to that node.
function onSelect(id: string): void {
	selectedNodeId = id
}
</script>

<div
	class="flex h-full max-h-full min-h-[320px] w-full min-w-0 gap-3"
	data-container={containerName}
>
	<!-- Left: instance runs -->
	<aside class="border-border flex w-56 shrink-0 flex-col rounded-[var(--radius-lg)] border">
		<p class="border-border border-b p-3 text-sm font-semibold">{t('mainnet.runs.title')}</p>
		<div class="min-h-0 flex-1 overflow-y-auto p-1.5">
			{#each runs as r (r.id)}
				<button
					type="button"
					class="mb-1 block w-full rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors {r.id ===
					selectedRunId
						? 'bg-primary/10 text-foreground'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => selectRun(r)}
				>
					<span class="flex items-center gap-1.5">
						<span class="size-2 shrink-0 rounded-full {RUN_DOT[r.status]}"></span>
						<span class="truncate text-[13px] font-medium">{r.label}</span>
					</span>
					<span class="text-muted-foreground ml-3.5 block truncate text-[10px]"
						>{flowName(r.flowId)}
						{#if r.startedAt}
							· {r.startedAt}
						{/if}</span
					>
				</button>
			{/each}
		</div>
	</aside>

	<!-- Center: flow graph (step-through) on top, the step's vibe below -->
	<div
		class="border-border flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border"
	>
		{#if !selectedRun || !flow}
			<p class="text-muted-foreground p-8 text-center text-sm">{t('mainnet.runs.pick')}</p>
		{:else}
			<div class="border-border flex items-center justify-between gap-2 border-b p-3">
				<div class="min-w-0">
					<h2 class="text-foreground truncate text-base font-semibold">{selectedRun.label}</h2>
					<p class="text-muted-foreground truncate text-xs">
						{flow.name}
						{#if node}
							· {node.name}
						{/if}
					</p>
				</div>
				<span class="text-muted-foreground shrink-0 text-[10px] tracking-wide uppercase"
					>{t('mainnet.runs.current')}</span
				>
			</div>
			<!-- Top: the actual node flow — click a node to step through. -->
			<div class="border-border h-64 shrink-0 border-b">
				<FlowGraph {flow} {nodeStates} {selectedNodeId} {onSelect} draggable={false} />
			</div>
			<!-- Below: the vibe view of the selected step. -->
			<div class="min-h-0 flex-1 overflow-auto p-4">
				<StepVibe {flow} {node} {step} />
			</div>
		{/if}
	</div>

	<!-- Right: the run's detail logs -->
	{#if selectedRun}
		<aside class="border-border flex w-80 shrink-0 flex-col rounded-[var(--radius-lg)] border">
			<p class="border-border border-b p-3 text-sm font-semibold">{t('mainnet.runs.trace')}</p>
			<div
				class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
			>
				{#each selectedRun.trace as s, i (i)}
					<button
						type="button"
						class="block w-full rounded-[var(--radius)] p-2 text-left transition-colors {s.nodeId ===
						selectedNodeId
							? 'bg-primary/10'
							: 'hover:bg-card'}"
						onclick={() => (selectedNodeId = s.nodeId)}
					>
						<span class="text-foreground flex items-center gap-2">
							<span class="text-muted-foreground w-9 shrink-0">{s.at ?? ''}</span>
							<span class="size-2 shrink-0 rounded-full {STATE_DOT[s.state]}"></span>
							<span class="truncate font-semibold">{nodeById.get(s.nodeId)?.name ?? s.nodeId}</span>
							<span class="text-muted-foreground ml-auto shrink-0">{s.state}</span>
						</span>
						{#if s.inputs?.length}
							<span class="text-muted-foreground mt-0.5 block pl-11">⬇ {s.inputs.join(', ')}</span>
						{/if}
						{#if s.outputs?.length}
							<span class="text-muted-foreground block pl-11">⬆ {s.outputs.join(', ')}</span>
						{/if}
						{#if s.message}
							<span class="text-muted-foreground block pl-11 italic">{s.message}</span>
						{/if}
						{#if s.vibe}
							<span class="text-muted-foreground/70 block pl-11">vibe: {s.vibe}</span>
						{/if}
					</button>
				{/each}
			</div>
		</aside>
	{/if}
</div>
