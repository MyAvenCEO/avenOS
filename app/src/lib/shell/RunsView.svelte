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
import ActorConfig from '$lib/shell/ActorConfig.svelte'
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
const trace = $derived(selectedRun?.trace ?? [])
const step = $derived(trace.find((s) => s.nodeId === selectedNodeId) ?? null)
const node = $derived<RecipeNode | null>(step ? (nodeById.get(step.nodeId) ?? null) : null)
// position in the run so we can toggle through it step by step (prev/next).
const stepIdx = $derived(trace.findIndex((s) => s.nodeId === selectedNodeId))
const stepDataJson = $derived(
	step?.vibeData !== undefined ? JSON.stringify(step.vibeData, null, 2) : ''
)

const RUN_DOT: Record<FlowRun['status'], string> = {
	running: 'bg-blue-500',
	done: 'bg-green-600',
	error: 'bg-red-600'
}
const STATE_LABEL: Record<NodeState, string> = {
	idle: 'Bereit',
	waiting: 'Wartet',
	running: 'Läuft',
	done: 'Fertig',
	error: 'Fehler',
	parked: 'Geparkt'
}
const STATE_CHIP: Record<NodeState, string> = {
	idle: 'bg-muted text-muted-foreground',
	waiting: 'bg-amber-500/15 text-amber-700',
	running: 'bg-blue-500/15 text-blue-700',
	done: 'bg-green-600/15 text-green-700',
	error: 'bg-red-600/15 text-red-700',
	parked: 'bg-purple-500/15 text-purple-700'
}

function flowName(id: string): string {
	return flows.find((f) => f.id === id)?.name ?? id
}
function selectRun(r: FlowRun): void {
	selectedRunId = r.id
	selectedNodeId = r.trace[currentStepIndex(r)]?.nodeId ?? null
}
// Toggle through the run step by step (prev/next via the right aside).
function stepBy(delta: number): void {
	const i = stepIdx
	const j = i < 0 ? 0 : i + delta
	if (j >= 0 && j < trace.length) selectedNodeId = trace[j].nodeId
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
			<!-- board 0107 — no flow graph in Runs (that lives in Skills templates); step via the ↑/↓ in the
			     right aside. The center is the selected step's vibe view. -->
			<div class="min-h-0 flex-1 overflow-auto p-4">
				<StepVibe {flow} {node} {step} />
			</div>
		{/if}
	</div>

	<!-- Right: the SELECTED step's technical detail (the internal run) — toggle via the graph or ↑/↓ -->
	{#if selectedRun}
		<aside class="border-border flex w-80 shrink-0 flex-col rounded-[var(--radius-lg)] border">
			<div class="border-border flex items-center justify-between gap-2 border-b p-3">
				<div class="min-w-0">
					<p class="text-foreground truncate text-sm font-semibold">
						{node?.name ?? t('mainnet.runs.trace')}
					</p>
					{#if node?.actor}
						<p class="text-muted-foreground truncate font-mono text-[10px]">{node.actor}</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<span class="text-muted-foreground mr-1 text-[10px] tabular-nums"
						>{stepIdx + 1}/{trace.length}</span
					>
					<button
						type="button"
						class="border-border hover:bg-card rounded border px-2 py-1 text-xs disabled:opacity-40"
						onclick={() => stepBy(-1)}
						disabled={stepIdx <= 0}>↑</button
					>
					<button
						type="button"
						class="border-border hover:bg-card rounded border px-2 py-1 text-xs disabled:opacity-40"
						onclick={() => stepBy(1)}
						disabled={stepIdx < 0 || stepIdx >= trace.length - 1}>↓</button
					>
				</div>
			</div>
			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[11px] leading-relaxed">
				{#if step}
					<div class="flex items-center justify-between gap-2">
						<span class="rounded-full px-2 py-0.5 text-[10px] font-semibold {STATE_CHIP[step.state]}"
							>{STATE_LABEL[step.state]}</span
						>
						<span class="text-muted-foreground font-mono">{step.at ?? ''}</span>
					</div>
					<div class="flex items-stretch gap-2">
						<div class="min-w-0 flex-1">
							<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
								Inbox
							</p>
							{#each step.inputs ?? [] as i (i)}
								<span class="bg-muted text-foreground mb-1 block truncate rounded px-2 py-1">{i}</span>
							{/each}
						</div>
						<span class="text-muted-foreground self-center">→</span>
						<div class="min-w-0 flex-1">
							<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
								Output
							</p>
							{#each step.outputs ?? [] as o (o)}
								<span class="bg-primary/10 text-foreground mb-1 block truncate rounded px-2 py-1 font-medium"
									>{o}</span
								>
							{/each}
						</div>
					</div>
					{#if step.message}
						<div class="border-border text-muted-foreground rounded border border-dashed p-2 italic">
							{step.message}
						</div>
					{/if}
					{#if node?.llm}
						<div class="flex flex-wrap items-center gap-1">
							<span class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
								>LLM</span
							>
							<span class="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono">{node.llm.model}</span>
							{#if node.llm.vision}
								<span class="bg-muted text-foreground rounded px-1.5 py-0.5">vision</span>
							{/if}
						</div>
					{/if}
					{#if node}
						<!-- board 0099 — the actor's inspectable config: system prompt + tool-call definitions. -->
						<ActorConfig {node} />
					{/if}
					{#if step.vibe}
						<p class="text-muted-foreground/70">vibe: {step.vibe}</p>
					{/if}
					{#if stepDataJson}
						<div>
							<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
								Daten
							</p>
							<pre
								class="text-foreground bg-muted/40 max-h-72 overflow-auto rounded p-2 font-mono whitespace-pre-wrap">{stepDataJson}</pre>
						</div>
					{/if}
				{:else}
					<p class="text-muted-foreground">Schritt im Graphen wählen.</p>
				{/if}
			</div>
		</aside>
	{/if}
</div>
