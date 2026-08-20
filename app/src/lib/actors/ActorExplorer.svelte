<script lang="ts">
import ActorGraph from './ActorGraph.svelte'
import { type Actor, functor } from './actor'
import { bus, type Run, type TraceEntry } from './bus'
import { registryTick } from './reactivity.svelte'
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
type ExplorerView = 'manifest' | 'view' | 'instance' | 'graph' | 'logic' | 'json' | 'trace' | 'ask'
let view = $state<ExplorerView>('manifest')
const VIEWS: { key: ExplorerView; label: string }[] = [
	{ key: 'manifest', label: 'Manifest' },
	{ key: 'view', label: 'View' },
	{ key: 'instance', label: 'Instances' },
	{ key: 'graph', label: 'Graph' },
	{ key: 'logic', label: 'Logic' },
	{ key: 'json', label: 'JSON' },
	{ key: 'trace', label: 'Trace' }
]
const show = (k: ExplorerView) => view === k
let focusGraph = $state(true)
let spawnName = $state('')
/** The mesh, reactive: bus.actors() re-read on every registry change. */
const meshActors = $derived.by(() => {
	void registryTick.v
	return bus.actors()
})

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

<div class="flex min-h-0 flex-1 gap-5 text-foreground">
	<!-- Every actor in the registry, the running and the merely declared alike. -->
	<nav class="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto text-sm">
		<p class="px-2 pb-1 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">
			Actors {registryTick.v >= 0 ? '' : ''}
		</p>
		{#each meshActors as actor (actor.uuid)}
			{@const live = actor.instanceState() !== null}
			<button
				type="button"
				onclick={() => {
					selected = actor
					answer = ''
				}}
				class="rounded-xl px-3 py-2 text-left transition-colors {selected.uuid === actor.uuid
					? 'border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
					: 'opacity-60 hover:opacity-100'}"
			>
				<span class="flex items-center gap-1.5 leading-tight">
					<span
						class="size-1.5 shrink-0 rounded-full {live ? 'bg-status-success' : 'bg-foreground/20'}"
						title={live ? 'instance running' : 'template only'}
					></span>
					{actor.instanceName === actor.manifest.id
						? actor.manifest.name
						: `${actor.manifest.name} · ${actor.instanceName}`}
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
			<!-- THE SELF-DESCRIPTION: the manifest read as documentation — what
			     this actor is, what it can do, how it connects, where its
			     behaviour runs, and the interview. Deep artifacts (the program,
			     the raw JSON) have their own lenses. -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-5 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-baseline gap-3">
					<h3 class="font-semibold text-lg">{selected.instanceName}</h3>
					{#each selected.manifest.tags as t (t)}
						<span
							class="rounded-md border border-foreground/10 px-1.5 py-0.5 text-[0.6875rem] text-foreground/60"
						>
							{t}
						</span>
					{/each}
					<span
						class="size-1.5 rounded-full {selected.instanceState() !== null
							? 'bg-status-success'
							: 'bg-foreground/20'}"
					></span>
					<span class="ml-auto font-mono text-[0.6875rem] text-foreground/35">
						{selected.uuid.slice(0, 8)}
					</span>
				</div>
				<p class="pt-2 pb-4 text-foreground/70 text-sm leading-relaxed">
					{selected.manifest.description}
				</p>

				<!-- What it can do: every callable entry, read like an API doc. -->
				<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
					What it can do
				</h4>
				{#if selected.manifest.methods.length > 0}
					<div class="flex flex-col gap-2 pb-4">
						{#each selected.manifest.methods as method (method.name)}
							{@const fields = Object.keys(
								(method.parameters as { properties?: Record<string, unknown> }).properties ?? {}
							)}
							<div class="rounded-xl border border-foreground/5 bg-surface-soft/60 px-3 py-2">
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="font-medium font-mono text-xs">{method.name}</span>
									{#if method.event}
										<span
											class="rounded-full border border-primary/25 bg-primary/5 px-1.5 text-[0.625rem] text-foreground/60"
										>
											→ {method.event.send} · sandboxed
										</span>
									{/if}
									{#each method.produces ?? [] as pr, i (`mp${i}`)}
										{@render pill(pr)}
									{/each}
								</div>
								<p class="pt-1 text-[0.75rem] text-foreground/50 leading-relaxed">
									{method.description}
								</p>
								{#if fields.length > 0}
									<p class="pt-0.5 font-mono text-[0.625rem] text-foreground/35">
										{fields.join(' · ')}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="pb-4 text-foreground/50 text-sm">
						Nothing to call — this actor is pure transformation; its dataflow below is the whole
						interface.
					</p>
				{/if}

				<!-- How it connects: the contract as sentences, neighbors clickable. -->
				<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
					How it connects
				</h4>
				<div class="flex flex-col gap-1 pb-4 text-foreground/60 text-sm">
					{#if selected.requires.length > 0}
						<p class="flex flex-wrap items-center gap-1.5">
							Listens for
							{#each selected.requires as r, i (`r${i}`)}
								{@render pill(r)}
							{/each}
							{#if feeders.length > 0}
								— fed by
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
								{/each}
							{:else}
								— from outside
							{/if}
						</p>
					{/if}
					{#if selected.produces.length > 0}
						<p class="flex flex-wrap items-center gap-1.5">
							Produces
							{#each selected.produces as pr, i (`p${i}`)}
								{@render pill(pr)}
							{/each}
							{#if fed.length > 0}
								— feeding
								{#each fed as edge, i (`t${i}`)}
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
								{/each}
							{:else}
								— for whoever asks
							{/if}
						</p>
					{/if}
					{#if selected.requires.length === 0 && selected.produces.length === 0}
						<p>No dataflow — reachable by message only.</p>
					{/if}
					{#if selected.manifest.methods.length > 0}
						<p class="text-[0.75rem] text-foreground/40">
							All {selected.manifest.methods.length} entries are reachable through the chat, and
							addressable per instance via <span class="font-mono">to</span>.
						</p>
					{/if}
				</div>

				<!-- Where its behaviour runs — and what it may touch. -->
				<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
					Behaviour & containment
				</h4>
				<div class="flex flex-col gap-1 pb-4 text-foreground/60 text-sm">
					{#if selected.manifest.logic}
						<p>
							Runs fully sandboxed — {selected.manifest.logic.trim().split('\n').length} lines of
							logic in its own QuickJS VM (see
							<button
								type="button"
								onclick={() => {
									view = 'logic'
								}}
								class="underline underline-offset-4 hover:text-foreground"
							>
								Logic
							</button>).
						</p>
						<p class="flex flex-wrap items-center gap-1.5">
							{#if (selected.manifest.capabilities ?? []).length > 0}
								Host doors, fail-closed:
								{#each selected.manifest.capabilities ?? [] as cap (cap)}
									<span
										class="rounded-full border border-foreground/10 px-2 py-0.5 font-mono text-[0.6875rem] text-foreground/60"
									>
										{cap}
									</span>
								{/each}
							{:else}
								No host doors — fully contained.
							{/if}
						</p>
					{:else}
						<p>
							Host code — reviewed TypeScript in the repo (see
							<button
								type="button"
								onclick={() => {
									view = 'logic'
								}}
								class="underline underline-offset-4 hover:text-foreground"
							>
								Logic
							</button>).
						</p>
					{/if}
					{#if selected.manifest.view}
						<p>
							Paints {1 + (selected.manifest.views?.length ?? 0)}
							{1 + (selected.manifest.views?.length ?? 0) === 1 ? 'view' : 'views'}
							(see
							<button
								type="button"
								onclick={() => {
									view = 'view'
								}}
								class="underline underline-offset-4 hover:text-foreground"
							>
								View
							</button>).
						</p>
					{/if}
				</div>

				<!-- The interview — part of the self-description, not a lens. -->
				<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">ask()</h4>
				<form onsubmit={ask} class="flex items-center gap-2">
					<input
						bind:value={question}
						placeholder={`Ask ${selected.instanceName}…`}
						class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
					>
					<button
						type="submit"
						disabled={question.trim() === '' || busy}
						class="rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-opacity disabled:opacity-40"
					>
						{busy ? '…' : 'Ask'}
					</button>
				</form>
				{#if answer !== ''}
					<p class="pt-3 text-foreground/75 text-sm leading-relaxed">{answer}</p>
				{/if}
			</section>
		{/if}

		{#if show('logic')}
			<!-- THE PROGRAM: where the behaviour actually lives, verbatim. -->
			<section
				class="flex min-h-0 flex-1 flex-col rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Logic</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						{selected.manifest.logic
							? 'the sandboxed program — initState, reduce and shape run in the QuickJS VM, never in the host'
							: 'host handlers — read from the running functions themselves'}
					</span>
				</div>
				{#if selected.manifest.logic}
					<pre
						class="min-h-0 flex-1 overflow-auto rounded-lg bg-foreground/[0.04] p-3 font-mono text-[0.6875rem] leading-relaxed"
					>{selected.manifest.logic.trim()}</pre>
				{:else}
					<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
						{#each selected.manifest.methods as method (method.name)}
							{#if selected.handlerSource(method.name)}
								<div>
									<p class="pb-1 font-medium font-mono text-xs">{method.name}</p>
									<pre
										class="overflow-x-auto rounded-lg bg-foreground/[0.04] p-2 font-mono text-[0.625rem] leading-relaxed"
									>{selected.handlerSource(
											method.name
										)}</pre>
								</div>
							{/if}
						{:else}
							<p class="text-foreground/40 text-sm">
								No behaviour beyond the mailbox — pure transformation.
							</p>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if show('json')}
			<!-- THE RAW TRUTH: the manifest verbatim — everything else derives. -->
			<section
				class="flex min-h-0 flex-1 flex-col rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">JSON</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						the manifest, verbatim — the only stored truth; tools, edges and every lens derive from
						it
					</span>
				</div>
				<pre
					class="min-h-0 flex-1 overflow-auto rounded-lg bg-foreground/[0.04] p-3 font-mono text-[0.6875rem] leading-relaxed"
				>{JSON.stringify(
						selected.manifest,
						null,
						2
					)}</pre>
			</section>
		{/if}

		{#if show('instance')}
			<!-- ----------------- INSTANCES: one template, n running instances -->
			<section
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2 pb-2">
					<h3 class="font-semibold text-sm">Instances</h3>
					<span class="text-[0.6875rem] text-foreground/40">
						one manifest, n running instances — uuid is the address, the name is metadata
					</span>
				</div>
				<div class="flex flex-col gap-1 pb-3">
					{#each meshActors.filter((a) => a.manifest.id === selected.manifest.id) as inst (inst.uuid)}
						{@const isDefault = bus.get(inst.manifest.id)?.uuid === inst.uuid}
						<div
							class="flex items-center gap-2 rounded-lg border border-foreground/5 px-2 py-1.5 {inst.uuid ===
							selected.uuid
								? 'bg-surface-soft/80'
								: ''}"
						>
							<button
								type="button"
								onclick={() => {
									selected = inst
									answer = ''
								}}
								class="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
							>
								{inst.instanceName}
							</button>
							{#if isDefault}
								<span
									class="rounded-full border border-foreground/10 px-1.5 text-[0.625rem] text-foreground/45"
								>
									default
								</span>
							{/if}
							<span class="font-mono text-[0.625rem] text-foreground/35">
								{inst.uuid.slice(0, 8)}
							</span>
							{#if !isDefault}
								<button
									type="button"
									onclick={() => {
										void bus.dispatch('explorer', 'dispose', { to: inst.uuid })
									}}
									title="Dispose this instance"
									class="text-foreground/30 transition-colors hover:text-status-error"
								>
									×
								</button>
							{/if}
						</div>
					{/each}
				</div>
				{#if bus.canSpawn(selected.manifest.id)}
					<form
						onsubmit={(event) => {
							event.preventDefault()
							const name = spawnName.trim()
							spawnName = ''
							void bus.dispatch('explorer', 'spawn', {
								template: selected.manifest.id,
								...(name !== '' && { name })
							})
						}}
						class="flex items-center gap-2 pb-3"
					>
						<input
							bind:value={spawnName}
							placeholder="new instance name…"
							class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-3 py-1 font-mono text-[0.6875rem] outline-none placeholder:text-foreground/30"
						>
						<button
							type="submit"
							class="rounded-full border border-foreground/10 px-2.5 py-0.5 text-[0.6875rem] transition-colors hover:border-primary/40"
						>
							Spawn
						</button>
					</form>
				{/if}
				<div class="flex items-center gap-2 pb-2">
					<h4 class="text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
						{selected.instanceName}
					</h4>
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
			<!-- The window itself, edge to edge: no chrome, no caption — the
			     card FILLS the column and only the content inside it scrolls. -->
			{#if isWindow(selected)}
				{@const View = selected.component as import('svelte').Component<{
					actor: typeof selected.subject
				}>}
				<div
					class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
						<!-- The window's props ride along — they are what make the
						     Kanban-Board window a BOARD and not another list. -->
						<View actor={selected.subject} {...selected.props} />
					</div>
				</div>
			{:else}
				{@const win = bus.actors().filter(isWindow).find((a) => a.subject === selected)}
				<section
					class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
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
				</section>
			{/if}
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
								<div class="rounded px-1 py-0.5 hover:bg-foreground/[0.03]">
									<div class="flex items-center gap-2">
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
									{#if e.note}
										<!-- a ✗ without its reason is not a trace -->
										<div class="pl-10 text-[0.6875rem] text-status-error/80">{e.note}</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
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
