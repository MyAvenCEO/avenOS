<script lang="ts">
import type { Edge, Node } from '@xyflow/svelte'
import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import { setContext } from 'svelte'

import { BOARD_STEP_CONTEXT_KEY } from '$lib/board/board-flow-context'
import { buildBoardGraph, inspectBoardNode } from '$lib/board/build-board-graph'
import SkillAgentLaneNode from '$lib/board/SkillAgentLaneNode.svelte'
import SkillShellNode from '$lib/board/SkillShellNode.svelte'
import {
	type AgentSkillPlaygroundConfig,
	childStepId,
	collectStepIds,
	defaultSkillPlaygroundConfig,
	initialStepStates,
	type ProcessStepLifecycle,
	parseAgentSkillPlaygroundConfig,
	reconcileStepStates
} from '$lib/board/skill-playground-config'

const nodeTypes = {
	agentLane: SkillAgentLaneNode,
	skillShell: SkillShellNode
}

let canvasFocusNodeId = $state<string | null>(null)

let flowText = $state(JSON.stringify(defaultSkillPlaygroundConfig, null, 2))
let parseError = $state<string | null>(null)
let config = $state<AgentSkillPlaygroundConfig>(defaultSkillPlaygroundConfig)
let stepStates = $state<Record<string, ProcessStepLifecycle>>(
	initialStepStates(collectStepIds(defaultSkillPlaygroundConfig))
)
let selectedStepId = $state<string | null>(defaultSkillPlaygroundConfig.skill.steps[0]?.id ?? null)

let nodes = $state.raw<Node[]>([])
let edges = $state.raw<Edge[]>([])

function pickRowStepFromLaneGraph(stepId: string) {
	selectedStepId = stepId
}

setContext(BOARD_STEP_CONTEXT_KEY, pickRowStepFromLaneGraph)

const fullStateJson = $derived(JSON.stringify({ config, stepStates }, null, 2))

function pushGraph() {
	const built = buildBoardGraph(config, stepStates)
	nodes = built.nodes
	edges = built.edges
}

$effect(() => {
	void config
	void stepStates
	pushGraph()
})

function applyFlowJson() {
	parseError = null
	let parsed: unknown
	try {
		parsed = JSON.parse(flowText)
	} catch (e) {
		parseError = e instanceof Error ? e.message : 'Invalid JSON'
		return
	}
	const result = parseAgentSkillPlaygroundConfig(parsed)
	if (!result.ok) {
		parseError = result.error
		return
	}
	config = result.config
	stepStates = reconcileStepStates(result.config, stepStates)
	flowText = JSON.stringify(result.config, null, 2)
	const all = collectStepIds(result.config)
	const mainFirst = result.config.skill.steps[0]?.id
	canvasFocusNodeId = null
	if (selectedStepId && !all.includes(selectedStepId)) {
		selectedStepId = mainFirst ?? null
	}
}

function resetSimulation() {
	stepStates = initialStepStates(collectStepIds(config))
}

const lifecycleOptions: ProcessStepLifecycle[] = ['idle', 'running', 'blocked', 'success', 'error']

function setStepState(id: string, st: ProcessStepLifecycle) {
	stepStates = { ...stepStates, [id]: st }
}

function onNodeClick({ node }: { node: { id: string } }) {
	selectedStepId = null
	canvasFocusNodeId = node.id
}

const selectedInspect = $derived.by(() => {
	const c = config
	if (selectedStepId) return inspectBoardNode(c, selectedStepId)
	if (canvasFocusNodeId) return inspectBoardNode(c, canvasFocusNodeId)
	return null
})

const selectedState = $derived(selectedStepId ? (stepStates[selectedStepId] ?? 'idle') : null)
</script>

<svelte:head> <title>Inbox · Process · Report — AvenOS /board</title> </svelte:head>

<div
	lang="en"
	class="min-h-screen bg-[#e4e9f5] text-foreground font-sans antialiased flex flex-col"
>
	<header class="shrink-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
		<div
			class="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8"
		>
			<div>
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40">
					Playground
				</p>
				<h1 class="text-lg font-semibold tracking-tight">Inbox · Process · Report</h1>
				<p class="mt-1 max-w-3xl text-[12px] text-foreground/60 leading-relaxed">
					<strong class="text-foreground/85">Compact lanes.</strong>
					Each actor is one card — labelled inbox / tell / Report ports — with Process rows as
					compact
					<code class="font-mono text-[11px]">title · state</code>
					lines (scroll inside the card).
					<span class="text-foreground/78">
						Stack: Human (bottom), orchestrator next, OCR worker, field worker at top.
					</span>
					<code class="font-mono text-[11px]">Report</code>
					<code class="font-mono text-[11px]">ask → parent</code>
					returns via Human root. Edit JSON —
					<a
						class="underline underline-offset-4"
						href="https://svelteflow.dev/"
						target="_blank"
						rel="noreferrer"
						>Svelte Flow</a
					>.
				</p>
			</div>
			<nav
				class="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
			>
				<a href="/" class="rounded-full border border-border px-3 py-1.5 hover:bg-indigo-500/10"
					>Home</a
				>
				<a href="/me" class="rounded-full border border-border px-3 py-1.5 hover:bg-indigo-500/10"
					>Schreibtisch</a
				>
			</nav>
		</div>
	</header>

	<main
		class="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-4 px-5 py-4 sm:px-8 sm:py-6 min-h-0"
	>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="rounded-full bg-indigo-950 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-900"
				onclick={applyFlowJson}
			>
				Apply JSON
			</button>
			<button
				type="button"
				class="rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-indigo-500/10"
				onclick={resetSimulation}
			>
				Reset step states
			</button>
		</div>

		{#if parseError}
			<p
				class="text-sm font-medium text-red-800 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2"
			>
				{parseError}
			</p>
		{/if}

		<div
			class="grid flex-1 min-h-[420px] grid-cols-1 gap-4 xl:grid-cols-[1fr_380px] xl:min-h-[560px]"
		>
			<div
				class="min-h-[420px] overflow-hidden rounded-2xl border border-indigo-900/25 bg-white/50 xl:min-h-0 shadow-sm"
			>
				<SvelteFlow
					{nodes}
					{edges}
					{nodeTypes}
					fitView
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={true}
					class="h-full min-h-[420px] board-flow"
					onnodeclick={onNodeClick}
					style="--xy-background-color-props: transparent;"
				>
					<Controls />
					<Background variant={BackgroundVariant.Dots} gap={17} size={1} />
					<MiniMap
						nodeColor={() => '#1e3a8a'}
						maskColor="rgb(226,232,246,0.65)"
						class="[&_.svelte-flow__minimap]:rounded-lg"
					/>
				</SvelteFlow>
			</div>

			<div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
				<div class="tech-card space-y-3">
					<p class="tech-label">Selection</p>
					{#if selectedInspect?.kind === 'shell'}
						<p class="text-sm font-semibold capitalize">{selectedInspect.shell} face</p>
						{#if selectedInspect.shell === 'report' && selectedInspect.reportStub}
							<pre
								class="mt-2 max-h-48 overflow-auto rounded-lg border border-border/60 bg-black/[0.03] p-2 font-mono text-[10px] leading-relaxed"
							>{JSON.stringify(selectedInspect.reportStub, null, 2)}</pre>
						{:else}
							<p class="text-[11px] text-foreground/60 leading-snug">
								Unified Report egress envelope: modality · target (+ payload at runtime).
							</p>
						{/if}
					{:else if selectedInspect?.kind === 'lane'}
						<p class="text-[10px] font-mono uppercase tracking-wider text-indigo-800/82">
							Agent lane · {selectedInspect.ref}
						</p>
						<p class="text-sm font-semibold">{selectedInspect.displayTitle}</p>
						{#if selectedInspect.sub}
							<p class="mt-1 text-[11px] text-foreground/60 leading-snug">{selectedInspect.sub}</p>
						{/if}
						{#if selectedInspect.rows.length}
							<p class="tech-label mb-2 mt-3">Process rows (tap a line inside the lane card)</p>
							<ul class="max-h-40 space-y-1 overflow-y-auto text-[11px]">
								{#each selectedInspect.rows as rw (rw.stepId)}
									<button
										type="button"
										class="flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left hover:border-indigo-500/38 hover:bg-indigo-500/[0.08]"
										onclick={() => {
											selectedStepId = rw.stepId
										}}
									>
										<span class="min-w-0 flex-1 truncate">{rw.title}</span>
										<code class="shrink-0 font-mono text-[9px] opacity-65">{rw.stepId}</code>
									</button>
								{/each}
							</ul>
						{:else}
							<p class="mt-3 text-[11px] text-foreground/50">
								Human carries no inlined Process chips — escalate back through Report into this root
								inbox.
							</p>
						{/if}
					{:else if selectedInspect?.kind === 'band'}
						<p class="text-sm font-semibold">Legacy Process band Id</p>
						<p class="text-[11px] text-foreground/65 leading-snug">
							Obsolete on this simplified canvas — preserved for JSON inspectors only —
							<span class="font-mono">{selectedInspect.scope}</span>
						</p>
					{:else if selectedInspect?.kind === 'process'}
						{#if selectedInspect.childMapKey}
							<p class="font-mono text-[10px] text-indigo-800/80">
								child agent · map “{selectedInspect.childMapKey}”
							</p>
						{/if}
						<p class="text-sm font-semibold">{selectedInspect.step.title}</p>
						<p class="text-[11px] text-foreground/55">
							{#if selectedInspect.step.kind === 'deterministic'}
								deterministic · tool <span class="font-mono">{selectedInspect.step.toolName}</span>
							{:else}
								creative
								{#if selectedInspect.step.delegatesToChild}
									<span class="font-mono">
										· delegates→{selectedInspect.step.delegatesToChild}
									</span>
								{/if}
								{#if selectedInspect.step.llmPrompt}
									<span class="block mt-1 line-clamp-3">{selectedInspect.step.llmPrompt}</span>
								{/if}
							{/if}
						</p>
						<label
							for="step-state-select"
							class="block text-[11px] font-bold uppercase tracking-wider opacity-50"
							>Simulated state</label
						>
						<select
							id="step-state-select"
							class="w-full rounded-lg border border-border bg-white/40 px-2 py-2 text-sm"
							value={selectedState ?? 'idle'}
							onchange={(e) => {
								const v = (e.currentTarget as HTMLSelectElement).value as ProcessStepLifecycle
								if (selectedStepId) setStepState(selectedStepId, v)
							}}
						>
							{#each lifecycleOptions as opt}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
						<div class="grid gap-2 sm:grid-cols-2">
							<div>
								<p class="tech-label mb-1">inputSchema</p>
								<pre
									class="max-h-40 overflow-auto rounded-lg border border-border/60 bg-black/[0.03] p-2 font-mono text-[10px] leading-relaxed"
								>{JSON.stringify(selectedInspect.step.inputSchema, null, 2)}</pre>
							</div>
							<div>
								<p class="tech-label mb-1">outputSchema</p>
								<pre
									class="max-h-40 overflow-auto rounded-lg border border-border/60 bg-black/[0.03] p-2 font-mono text-[10px] leading-relaxed"
								>{JSON.stringify(selectedInspect.step.outputSchema, null, 2)}</pre>
							</div>
						</div>
					{:else}
						<p class="text-sm text-foreground/55">
							Click a lane card · Report facet · then a Process line (inside the lane, or sidebar
							list).
						</p>
					{/if}
				</div>

				<div>
					<p class="tech-label mb-2">Agent + skill JSON (editable)</p>
					<textarea
						class="h-64 w-full resize-y rounded-xl border border-border bg-white/55 px-3 py-2 font-mono text-[10px] leading-relaxed outline-none focus:ring-2 focus:ring-indigo-500/40"
						bind:value={flowText}
						spellcheck="false"
						autocomplete="off"
					></textarea>
				</div>
				<div>
					<p class="tech-label mb-2">Full playground state (read-only)</p>
					<textarea
						readonly
						class="h-40 w-full resize-y rounded-xl border border-border bg-black/[0.04] px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground/90"
						value={fullStateJson}
					></textarea>
				</div>
			</div>
		</div>

		<details class="tech-card text-sm text-foreground/75">
			<summary class="cursor-pointer font-semibold text-foreground">
				All Process rows — quick state
			</summary>
			<section class="mt-3 space-y-3">
				<p class="text-[11px] font-semibold uppercase tracking-wider opacity-55">Primary agent</p>
				<ul class="space-y-2">
					{#each config.skill.steps as st (st.id)}
						<li class="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2">
							<span class="font-mono text-[11px] opacity-50">{st.id}</span>
							<span class="text-[13px]">{st.title}</span>
							<span
								class="rounded bg-indigo-950/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-950"
							>
								{st.kind === 'deterministic' ? 'D' : 'C'}
							</span>
							<select
								class="ml-auto rounded-md border border-border bg-white/35 px-2 py-1 text-[11px]"
								value={stepStates[st.id] ?? 'idle'}
								onchange={(e) => {
									const v = (e.currentTarget as HTMLSelectElement).value as ProcessStepLifecycle
									setStepState(st.id, v)
								}}
							>
								{#each lifecycleOptions as opt}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
						</li>
					{/each}
				</ul>
				{#if config.childAgents}
					{#each Object.entries(config.childAgents) as [ mapKey, sn ] (mapKey)}
						<div>
							<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider opacity-55">
								Delegated · <span class="font-mono">{sn.id}</span>
							</p>
							<ul class="space-y-2">
								{#each sn.steps as st (st.id)}
									{@const nid = childStepId(mapKey, st.id)}
									<li class="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2">
										<span class="font-mono text-[11px] opacity-50">{nid}</span>
										<span class="text-[13px]">{st.title}</span>
										<span
											class="rounded bg-indigo-950/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-950"
										>
											{st.kind === 'deterministic' ? 'D' : 'C'}
										</span>
										<select
											class="ml-auto rounded-md border border-border bg-white/35 px-2 py-1 text-[11px]"
											value={stepStates[nid] ?? 'idle'}
											onchange={(e) => {
												const v = (e.currentTarget as HTMLSelectElement)
													.value as ProcessStepLifecycle
												setStepState(nid, v)
											}}
										>
											{#each lifecycleOptions as opt}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/if}
			</section>
		</details>
	</main>
</div>

<style>
:global(body) {
	background-color: #e4e9f5;
}

:global(.board-flow .svelte-flow__edge-path) {
	stroke-linecap: round;
}

:global(.board-flow .svelte-flow__controls button) {
	background: #eef2fc;
	border-color: #c7cff0;
	color: #1e2740;
}

:global(.board-flow .svelte-flow__controls button:hover) {
	background: #e0e7fa;
}

:global(.board-flow .svelte-flow__attribution) {
	opacity: 0.45;
}
</style>
