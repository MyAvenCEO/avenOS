<script lang="ts">
import ActorGraph from './ActorGraph.svelte'
import { type Actor, functor } from './actor'
import { bus, type ProofStep, type Run, type TraceEntry } from './bus'
import { registryTick } from './reactivity.svelte'
import { isVariable, resolve } from './term'
import { isWindow } from './window.actor.svelte'

/**
 * The actor explorer: every actor in the registry on the left, everything
 * knowable about the selected one on the right — in two deliberately
 * separate cards, because template and instance are two different concepts.
 *
 * The TEMPLATE is the class: the manifest — identity, contracts, methods —
 * timeless, true even for actors nothing has instantiated yet. The INSTANZ
 * is this particular running one: its live state right now. Stubs have a
 * template and no instance, and the explorer says so instead of blurring
 * the two.
 *
 * Relations are derived, never stored: who feeds this actor and whom it
 * feeds falls out of unifying produces against requires across the registry.
 */

let selected = $state<Actor>(bus.actors()[0])

/** A stable, calm palette; a functor hashes to one hue everywhere. */
const PALETTE = [
	'bg-[#d4a373]/20 text-[#8a6238]',
	'bg-[#7e6ead]/15 text-[#655687]',
	'bg-[#2f5d50]/12 text-[#2f5d50]',
	'bg-[#5b7a9d]/15 text-[#46617f]',
	'bg-[#c15b40]/12 text-[#9c4832]',
	'bg-[#a06818]/12 text-[#a06818]'
]

function hue(p: string): string {
	const name = functor(p)
	let h = 0
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
	return PALETTE[h % PALETTE.length]
}

const feeders = $derived(bus.edges().filter((e) => e.to === selected.manifest.id))
const fed = $derived(bus.edges().filter((e) => e.from === selected.manifest.id))
const instance = $derived(selected.instanceState())

/**
 * The one detail filter (right aside): which lens renders. The manifest —
 * the actor's template, the only stored truth — is where reading starts.
 */
type ExplorerView = 'manifest' | 'graph' | 'instance' | 'view' | 'proof' | 'trace' | 'ask'
let view = $state<ExplorerView>('manifest')
const VIEWS: { key: ExplorerView; label: string }[] = [
	{ key: 'manifest', label: 'Manifest' },
	{ key: 'graph', label: 'Graph' },
	{ key: 'instance', label: 'Instance' },
	{ key: 'view', label: 'View' },
	{ key: 'proof', label: 'Proof' },
	{ key: 'trace', label: 'Trace' },
	{ key: 'ask', label: 'ask()' }
]
const show = (k: ExplorerView) => view === k
let focusGraph = $state(true)

// ---- the prover: pick any predicate as a goal, get its SLD proof tree
let goal = $state('')
let proof = $state<ProofStep | null>(null)

function prove(g: string) {
	goal = g
	proof = bus.prove(g)
}

function proveCustom(event: SubmitEvent) {
	event.preventDefault()
	if (goal.trim() !== '') proof = bus.prove(goal.trim())
}

// ---- the trace: poll-refreshed biography of the bus
let traceTick = $state(0)
let traceOnlySelected = $state(true)
$effect(() => {
	const timer = setInterval(() => {
		traceTick++
	}, 1500)
	return () => clearInterval(timer)
})
/**
 * Runs and trace are the SAME events — a run is a group of step entries.
 * The stream shows each run once (as a collapsible group, payload detail
 * from bus.runs()) in the position of its newest step, everything else flat.
 */
type ActivityRow = { kind: 'entry'; e: TraceEntry } | { kind: 'run'; run: Run; at: number }
const activityRows = $derived.by<ActivityRow[]>(() => {
	void traceTick
	const runsById = new Map(bus.runs().map((r) => [r.id, r]))
	const rows: ActivityRow[] = []
	const seenRuns = new Set<string>()
	for (const e of [...bus.traceLog].reverse()) {
		if (e.kind === 'step' && e.run) {
			if (seenRuns.has(e.run)) continue
			seenRuns.add(e.run)
			const run = runsById.get(e.run)
			if (run) rows.push({ kind: 'run', run, at: e.at })
			else rows.push({ kind: 'entry', e })
			continue
		}
		rows.push({ kind: 'entry', e })
	}
	return (
		traceOnlySelected
			? rows.filter((row) =>
					row.kind === 'run'
						? row.run.steps.some((step) => step.actor === selected.manifest.id)
						: row.e.from === selected.manifest.id ||
							row.e.to.split(',').includes(selected.manifest.id)
				)
			: rows
	).slice(0, 30)
})

/** Constant bindings only — `M = hoch` is information, `M = X@chat` is noise. */
function constantBindings(step: ProofStep): [string, string][] {
	return Object.entries(step.bindings)
		.map(([variable, value]) => [variable, resolve(value, step.bindings)] as [string, string])
		.filter(([variable, value]) => !isVariable(value) && !variable.includes('@'))
}

// ---- the engine: run the proven plan for real, watch the runs pile up
let factsText = $state('')
let running = $state(false)
let runError = $state('')

async function runGoal() {
	const g = goal.trim()
	if (g === '' || running) return
	runError = ''
	let facts: Record<string, unknown> = {}
	if (factsText.trim() !== '') {
		try {
			facts = JSON.parse(factsText)
		} catch {
			runError = 'facts is not valid JSON'
			return
		}
	}
	running = true
	try {
		await bus.satisfy(g, facts)
		proof = bus.prove(g)
		traceTick++
	} finally {
		running = false
	}
}

// ---- the interview
let question = $state('')
let answer = $state('')
let busy = $state(false)

async function ask(event: SubmitEvent) {
	event.preventDefault()
	if (question.trim() === '' || busy) return
	busy = true
	answer = ''
	try {
		answer = await bus.ask(selected.manifest.id, question)
	} finally {
		busy = false
	}
}
</script>

{#snippet pill(predicate: string)}
	<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(predicate)}">
		{predicate}
	</span>
{/snippet}

{#snippet proofNode(step: ProofStep)}
	<!-- One node of the proof tree: goal, verdict, and how it was grounded. -->
	<div class="flex flex-col gap-1">
		<div class="flex flex-wrap items-center gap-1.5">
			<span
				class="{step.satisfied ? 'text-status-success' : 'text-status-error'} font-mono text-xs"
			>
				{step.satisfied ? '✓' : '✗'}
			</span>
			{@render pill(step.predicate)}
			{#if step.negated}
				<span class="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[0.625rem] text-foreground/50">
					negation as failure
				</span>
			{:else if step.external}
				<span class="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[0.625rem] text-foreground/50">
					external fact
				</span>
			{:else if step.actor}
				<span class="text-[0.6875rem] text-foreground/50">
					⊢ {bus.get(step.actor)?.manifest.name ?? step.actor}
				</span>
			{/if}
			{#if !step.satisfied}
				<span class="text-[0.6875rem] text-status-error">unsatisfied</span>
			{/if}
			{#each constantBindings(step) as [variable, value] (variable)}
				<span
					class="rounded-md bg-primary/5 px-1.5 py-0.5 font-mono text-[0.625rem] text-primary/70"
				>
					{variable}
					= {value}
				</span>
			{/each}
		</div>
		{#if step.children.length > 0}
			<div class="ml-4 flex flex-col gap-1 border-foreground/10 border-l pl-3">
				{#each step.children as child, i (`${child.predicate}${i}`)}
					{@render proofNode(child)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 gap-5 text-foreground">
	<!-- Every actor in the registry, the running and the merely declared alike. -->
	<nav class="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto text-sm">
		<p class="px-2 pb-1 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">
			Actors {registryTick.v >= 0 ? '' : ''}
		</p>
		{#each bus.actors() as actor (actor.manifest.id)}
			{@const live = actor.instanceState() !== null}
			<button
				type="button"
				onclick={() => {
					selected = actor
					answer = ''
				}}
				class="rounded-xl px-3 py-2 text-left transition-colors {selected.manifest.id ===
				actor.manifest.id
					? 'border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
					: 'opacity-60 hover:opacity-100'}"
			>
				<span class="flex items-center gap-1.5 leading-tight">
					<span
						class="size-1.5 shrink-0 rounded-full {live ? 'bg-status-success' : 'bg-foreground/20'}"
						title={live ? 'instance running' : 'template only'}
					></span>
					{actor.manifest.name}
				</span>
				<span class="block pl-3 text-[0.6875rem] text-foreground/40">
					{actor.manifest.tags.join(' · ')}
				</span>
			</button>
		{/each}
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
		<!-- The graph: the registry's derived truth as a picture — same
		     unification as the edges and the prover; a proof lights its path. -->
		{#if show('graph')}
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Graph</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						derived from the contracts — nothing is wired by hand
					</span>
					<button
						type="button"
						onclick={() => {
							focusGraph = !focusGraph
						}}
						title="Show only the selected actor and its direct partners; clicking a neighbor centers it"
						class="ml-auto rounded-full border px-2.5 py-0.5 text-xs transition-colors {focusGraph
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-foreground/10 opacity-60 hover:opacity-100'}"
					>
						Focus
					</button>
				</div>
				<ActorGraph
					{proof}
					{selected}
					focus={focusGraph}
					onselect={(actor) => {
						selected = actor
						answer = ''
					}}
				/>
			</section>
		{/if}

		{#if show('manifest')}
			<!-- ------------------------------------------------ TEMPLATE (the class) -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-baseline justify-between gap-3 pb-1">
					<h3 class="font-semibold text-sm">Manifest</h3>
					<span class="font-mono text-[0.6875rem] text-foreground/35">{selected.manifest.id}</span>
				</div>
				<p class="pb-3 text-foreground/60 text-sm leading-relaxed">
					{selected.manifest.description}
				</p>

				<div class="flex flex-wrap items-center gap-1 pb-3">
					{#each selected.manifest.tags as t (t)}
						<span
							class="rounded-md border border-foreground/10 px-1.5 py-0.5 text-[0.6875rem] text-foreground/60"
						>
							{t}
						</span>
					{/each}
				</div>

				<!-- THE INTERFACE — one concept, two halves. The dataflow half
				     (requires → produces, driving unification and the prover) and
				     the callable half (named entries with schema + declared event)
				     are the same set: Actor.requires/produces already aggregate
				     both levels, and an entry carries its own contract. Always
				     rendered — a message-only actor is not section-less. -->
				<h4 class="pb-1 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">Interface</h4>
				<div class="flex flex-wrap items-center gap-1.5 pb-1 text-xs">
					<span class="text-foreground/40">Dataflow:</span>
					{#if selected.requires.length > 0 || selected.produces.length > 0}
						{#each selected.requires as r, i (`r${i}`)}
							{@render pill(r)}
						{/each}
						<span class="text-foreground/30">→</span>
						{#each selected.produces as p, i (`p${i}`)}
							{@render pill(p)}
						{/each}
					{:else}
						<span class="text-foreground/40">none — reachable by message only</span>
					{/if}
				</div>
				<!-- The relations are the contract, unified against the registry —
				     derived here, never stored: the actor's neighborhood as a
				     clickable mini graph, feeders → self → fed. -->
				<div class="flex flex-wrap items-center gap-1.5 pb-3 text-[0.6875rem]">
					{#each feeders as edge, i (`f${i}`)}
						<button
							type="button"
							onclick={() => {
								const a = bus.get(edge.from)
								if (a) {
									selected = a
									answer = ''
								}
							}}
							class="rounded-full border border-foreground/10 px-2 py-0.5 font-medium text-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
						>
							{bus.get(edge.from)?.manifest.name}
						</button>
						<span class="font-mono text-foreground/35">—{edge.predicate}→</span>
					{:else}
						<span class="text-foreground/35">outside</span>
						<span class="font-mono text-foreground/35">→</span>
					{/each}
					<span
						class="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 font-semibold text-foreground/85"
					>
						{selected.manifest.name}
					</span>
					{#each fed as edge, i (`t${i}`)}
						<span class="font-mono text-foreground/35">—{edge.predicate}→</span>
						<button
							type="button"
							onclick={() => {
								const a = bus.get(edge.to)
								if (a) {
									selected = a
									answer = ''
								}
							}}
							class="rounded-full border border-foreground/10 px-2 py-0.5 font-medium text-foreground/70 transition-colors hover:border-primary/40 hover:text-foreground"
						>
							{bus.get(edge.to)?.manifest.name}
						</button>
					{:else}
						<span class="font-mono text-foreground/35">→</span>
						<span class="text-foreground/35">outside</span>
					{/each}
					{#if selected.manifest.methods.length > 0}
						<span class="pl-1 text-foreground/35">
							· all {selected.manifest.methods.length} entries reachable through the chat
						</span>
					{/if}
				</div>

				{#if selected.manifest.methods.length > 0}
					<div class="flex flex-col gap-2">
						{#each selected.manifest.methods as method (method.name)}
							<div class="rounded-xl border border-foreground/5 bg-surface-soft/60 px-3 py-2">
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="font-medium font-mono text-xs">{method.name}</span>
									{#each method.requires ?? [] as r, i (`r${i}`)}
										{@render pill(r)}
									{/each}
									{#if (method.requires?.length ?? 0) > 0 || (method.produces?.length ?? 0) > 0}
										<span class="text-[0.6875rem] text-foreground/30">→</span>
									{/if}
									{#each method.produces ?? [] as p, i (`p${i}`)}
										{@render pill(p)}
									{/each}
								</div>
								<p class="pt-1 text-[0.75rem] text-foreground/50 leading-relaxed">
									{method.description}
								</p>
								{#if Object.keys((method.parameters as { properties?: Record<string, unknown> }).properties ?? {}).length > 0}
									<details class="pt-1">
										<summary
											class="cursor-pointer font-mono text-[0.6875rem] text-foreground/35 hover:text-foreground/60"
										>
											Schema:
											{Object.keys(
											(method.parameters as { properties?: Record<string, unknown> }).properties ??
												{}
										).join(' · ')}
										</summary>
										<pre
											class="mt-1 overflow-x-auto rounded-lg bg-foreground/[0.04] p-2 font-mono text-[0.625rem] leading-relaxed"
										>{JSON.stringify(
											method.parameters,
											null,
											2
										)}</pre>
									</details>
								{/if}
								{#if method.event}
									<p class="pt-1 font-mono text-[0.6875rem] text-foreground/40">
										→ <span class="font-semibold text-foreground/60">{method.event.send}</span>
										— declared event; ONE generic adapter reduces it in the sandbox (Logic below).
										The same clause serves voice, UI and the proof engine.
									</p>
								{:else if selected.handlerSource(method.name)}
									<details class="pt-1">
										<summary
											class="cursor-pointer font-mono text-[0.6875rem] text-foreground/35 hover:text-foreground/60"
										>
											Code — the running handler, read from the function itself
										</summary>
										<pre
											class="mt-1 overflow-x-auto rounded-lg bg-foreground/[0.04] p-2 font-mono text-[0.625rem] leading-relaxed"
										>{selected.handlerSource(
											method.name
										)}</pre>
									</details>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-foreground/40 text-xs">
						No methods — this actor is pure transformation; its contract is the whole interface.
					</p>
				{/if}

				<!-- The sandboxed program — where the behaviour actually lives. Part
			     of the manifest, so it lives HERE, not in a section of its own. -->
				{#if selected.manifest.vibe}
					<details class="pt-3">
						<summary
							class="cursor-pointer font-mono text-[0.6875rem] text-foreground/35 hover:text-foreground/60"
						>
							Logic — the sandboxed program (QuickJS): initState, reduce and shape run there, never
							in the host
						</summary>
						<pre
							class="mt-1 max-h-96 overflow-auto rounded-lg bg-foreground/[0.04] p-2 font-mono text-[0.625rem] leading-relaxed"
						>{selected.manifest.vibe.logic.trim()}</pre>
					</details>
				{/if}

				<!-- The manifest raw — the only stored truth; everything above is a
			     rendering of it, so the JSON belongs to the same section. -->
				<details class="pt-2">
					<summary
						class="cursor-pointer font-mono text-[0.6875rem] text-foreground/35 hover:text-foreground/60"
					>
						Manifest as JSON — the only stored truth; tools, edges, stages and this panel are
						derived from it
					</summary>
					<pre
						class="mt-1 max-h-72 overflow-auto rounded-lg bg-foreground/[0.04] p-2 font-mono text-[0.625rem] leading-relaxed"
					>{JSON.stringify(
						selected.manifest,
						null,
						2
					)}</pre>
				</details>
			</section>
		{/if}

		{#if show('instance')}
			<!-- --------------------------------------------- INSTANZ (the running one) -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Instance</h3>
					<span
						class="size-1.5 rounded-full {instance ? 'bg-status-success' : 'bg-foreground/20'}"
					></span>
				</div>
				{#if instance}
					<dl class="flex flex-col text-sm">
						{#each Object.entries(instance) as [key, value] (key)}
							<div
								class="flex items-baseline justify-between gap-4 border-b border-foreground/5 py-1.5 last:border-0"
							>
								<dt class="text-[0.6875rem] text-foreground/40">{key}</dt>
								<dd class="text-right font-medium">{value}</dd>
							</div>
						{/each}
						<div
							class="flex items-baseline justify-between gap-4 border-b border-foreground/5 py-1.5"
						>
							<dt class="text-[0.6875rem] text-foreground/40">Mailbox</dt>
							<dd class="text-right font-medium">{selected.pending} waiting</dd>
						</div>
						<div class="flex items-baseline justify-between gap-4 py-1.5">
							<dt class="text-[0.6875rem] text-foreground/40">Handler errors</dt>
							<dd class="text-right font-medium {selected.failures > 0 ? 'text-status-error' : ''}">
								{selected.failures}{selected.lastError ? ` · ${selected.lastError}` : ''}
							</dd>
						</div>
					</dl>
				{:else}
					<p class="text-foreground/40 text-sm">
						Template only — no running instance yet. The contract is declared; the engine executes
						it on demand.
					</p>
				{/if}
			</section>
		{/if}

		{#if show('view')}
			<!-- ------------------------------------- FACE: the actor's own window -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-1">
					<h3 class="font-semibold text-sm">View</h3>
					<span
						class="size-1.5 rounded-full {isWindow(selected) ? 'bg-status-success' : 'bg-foreground/20'}"
					></span>
				</div>
				{#if isWindow(selected)}
					{@const View = selected.component as import('svelte').Component<{
					actor: typeof selected.subject
				}>}
					<p class="pb-2 text-[0.6875rem] text-foreground/40">
						This window is an actor itself: it consumes the state of
						{selected.subject.manifest.name}
						and paints it — live, here:
					</p>
					<div class="max-h-[32rem] overflow-y-auto rounded-xl border border-foreground/10 p-3">
						<!-- The window's props ride along — they are what make the
						     Kanban-Board window a BOARD and not another list. -->
						<View actor={selected.subject} {...selected.props} />
					</div>
				{:else}
					{@const win = bus.actors().filter(isWindow).find((a) => a.subject === selected)}
					{#if win}
						<p class="text-foreground/40 text-sm">
							This actor does not paint itself — its window is its own actor:
							<button
								type="button"
								onclick={() => {
								selected = win
								answer = ''
							}}
								class="underline underline-offset-4 hover:text-foreground"
							>
								{win.manifest.name}
							</button>
						</p>
					{:else}
						<p class="text-foreground/40 text-sm">
							No window — this actor works invisibly; its state is readable above.
						</p>
					{/if}
				{/if}
			</section>
		{/if}

		{#if show('proof')}
			<!-- --------------------------------- BEWEIS: SLD backward chaining, live -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex flex-wrap items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Proof</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						Pick a goal — the solver searches backwards for producers and proves their needs, with
						backtracking; not(…) is negation as failure.
					</span>
				</div>
				<div class="flex flex-wrap items-center gap-1.5 pb-2">
					{#each selected.produces as p, i (`g${i}`)}
						<button
							type="button"
							onclick={() => prove(p)}
							class="rounded-full border border-foreground/10 px-2 py-0.5 font-mono text-[0.6875rem] transition-colors hover:border-primary/40 {goal ===
						p
							? 'border-primary/50'
							: ''}"
						>
							⊢ {p}
						</button>
					{/each}
					<form onsubmit={proveCustom} class="flex items-center gap-1.5">
						<input
							bind:value={goal}
							placeholder="own goal, e.g. reply(R) or not(x(Y))"
							class="w-56 rounded-full border border-foreground/5 bg-surface-soft/60 px-3 py-1 font-mono text-[0.6875rem] outline-none placeholder:text-foreground/30"
						>
						<button
							type="submit"
							class="rounded-full bg-primary px-3 py-1 text-[0.6875rem] text-primary-foreground"
						>
							prove
						</button>
					</form>
				</div>
				{#if proof}
					{@render proofNode(proof)}
				{/if}

				<!-- Run: the plan above, walked for real — postorder messages,
			     runtime backtracking, llm-actors over the injected model. -->
				<div class="flex flex-wrap items-center gap-1.5 pt-3">
					<input
						bind:value={factsText}
						placeholder={'external facts as JSON, e.g. {"request": {"text": "…"}}'}
						class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-3 py-1 font-mono text-[0.6875rem] outline-none placeholder:text-foreground/30"
					>
					<button
						type="button"
						onclick={runGoal}
						disabled={goal.trim() === '' || running}
						class="rounded-full bg-primary px-3 py-1 text-[0.6875rem] text-primary-foreground transition-opacity disabled:opacity-30"
					>
						{running ? 'running…' : 'Run'}
					</button>
					{#if runError}
						<span class="text-[0.6875rem] text-status-error">{runError}</span>
					{/if}
				</div>
			</section>
		{/if}

		{#if show('trace')}
			<!-- ------------------------- TRACE: the bus's biography, per actor -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Trace</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						everything that crossed the bus — runs grouped, backtracking visible
					</span>
					<button
						type="button"
						onclick={() => {
						traceOnlySelected = !traceOnlySelected
					}}
						class="ml-auto rounded-full border px-2 py-0.5 text-[0.6875rem] transition-colors {traceOnlySelected
						? 'border-primary/40 text-primary/80'
						: 'border-foreground/10 opacity-60 hover:opacity-100'}"
					>
						only {selected.manifest.name}
					</button>
				</div>
				{#if activityRows.length === 0}
					<p class="text-foreground/40 text-xs">
						Nothing yet — talk to the system, or run a goal above.
					</p>
				{:else}
					<div class="flex max-h-72 flex-col gap-0.5 overflow-y-auto font-mono text-[0.6875rem]">
						{#each activityRows as row (row.kind === 'run' ? row.run.id : row.e.seq)}
							{#if row.kind === 'run'}
								<details class="rounded-lg border border-foreground/5 px-2 py-1">
									<summary class="flex cursor-pointer items-center gap-2">
										<span
											class={row.run.status === 'ok' ? 'text-status-success' : 'text-status-error'}
										>
											{row.run.status === 'ok' ? '✓' : '✗'}
										</span>
										<span class="text-foreground/50">{row.run.id}</span>
										<span class="min-w-0 flex-1 truncate">⊢ {row.run.goal}</span>
										<span class="text-foreground/35">{row.run.steps.length} steps</span>
									</summary>
									<div class="flex flex-col gap-0.5 py-1 pl-5">
										{#each row.run.steps as step, i (`${row.run.id}s${i}`)}
											<div class="flex items-start gap-2">
												<span class={step.ok ? 'text-status-success' : 'text-status-error'}>
													{step.ok ? '✓' : '✗'}
												</span>
												<span class="shrink-0 text-foreground/50">{step.actor ?? 'external'}</span>
												<span class="min-w-0 flex-1 truncate">{step.predicate}</span>
												{#if step.attempt > 1}
													<span class="shrink-0 rounded bg-status-info/20 px-1 text-[#a06818]">
														attempt {step.attempt}
													</span>
												{/if}
												<span class="w-10 shrink-0 text-right text-foreground/30">
													{step.duration}ms
												</span>
											</div>
											<div class="truncate pl-5 text-foreground/40">
												in {JSON.stringify(step.in)} → {JSON.stringify(step.out)}
											</div>
										{/each}
									</div>
								</details>
							{:else}
								{@const e = row.e}
								<div class="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-foreground/[0.03]">
									<span class="w-8 shrink-0 text-foreground/35">
										{e.kind === 'emit' ? '⚡' : e.kind === 'ask' ? '?' : '→'}
									</span>
									<span class="shrink-0 text-foreground/50">{e.from}</span>
									<span class="text-foreground/25">→</span>
									<span class="shrink-0 text-foreground/50">{e.to}</span>
									<span class="min-w-0 flex-1 truncate">{e.method}</span>
									<span class={e.ok ? 'text-status-success' : 'text-status-error'}>
										{e.ok ? '✓' : '✗'}
									</span>
									<span class="w-10 shrink-0 text-right text-foreground/30">{e.ms}ms</span>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if show('ask')}
			<!-- ----------------------------------------------- ask(): the interview -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<h3 class="pb-2 font-semibold text-sm">ask()</h3>
				<form onsubmit={ask} class="flex items-center gap-2">
					<input
						bind:value={question}
						placeholder={`Ask ${selected.manifest.name}…`}
						class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
					>
					<button
						type="submit"
						disabled={question.trim() === '' || busy}
						class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
					>
						{busy ? '…' : 'Fragen'}
					</button>
				</form>
				{#if answer}
					<p class="pt-3 text-sm leading-relaxed">{answer}</p>
				{/if}
			</section>
		{/if}
	</div>

	<!-- The lens list: filters WHICH part of the actor's biography renders.
	     Slim, right, always visible — the sections themselves stay one column. -->
	<nav class="flex w-24 shrink-0 flex-col gap-1 text-xs">
		<p class="px-2 pb-1 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">View</p>
		{#each VIEWS as v (v.key)}
			<button
				type="button"
				onclick={() => {
					view = v.key
				}}
				class="rounded-lg px-2.5 py-1.5 text-left transition-colors {view === v.key
					? 'border border-foreground/5 bg-[#fffdf7] font-medium shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
					: 'opacity-60 hover:opacity-100'}"
			>
				{v.label}
			</button>
		{/each}
	</nav>
</div>
