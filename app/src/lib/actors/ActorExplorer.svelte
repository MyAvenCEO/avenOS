<script lang="ts">
import ActorGraph from './ActorGraph.svelte'
import { type Actor, functor } from './actor'
import { bus, type ProofStep } from './bus'

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

let graph = $state(false)
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
					externes Faktum
				</span>
			{:else if step.actor}
				<span class="text-[0.6875rem] text-foreground/50">
					⊢ {bus.get(step.actor)?.manifest.name ?? step.actor}
				</span>
			{/if}
			{#if !step.satisfied}
				<span class="text-[0.6875rem] text-status-error">unerfüllt</span>
			{/if}
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
		<p class="px-2 pb-1 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">Actors</p>
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
						title={live ? 'Instanz läuft' : 'nur Template'}
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
		<!-- The solver's forward reading of the whole registry: who can fire
		     first, who becomes possible after — stages, derived like all else.
		     The graph is the same truth as a picture; a proof lights its path. -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<button
				type="button"
				onclick={() => {
					graph = !graph
				}}
				class="rounded-full border px-2.5 py-0.5 transition-colors {graph
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-foreground/10 opacity-60 hover:opacity-100'}"
			>
				Graph
			</button>
			{#if graph}
				<button
					type="button"
					onclick={() => {
						focusGraph = !focusGraph
					}}
					title="Nur den gewählten Actor und seine direkten Partner zeigen; Klick auf einen Nachbarn zentriert ihn"
					class="rounded-full border px-2.5 py-0.5 transition-colors {focusGraph
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-foreground/10 opacity-60 hover:opacity-100'}"
				>
					Fokus
				</button>
			{/if}
			<span class="text-foreground/40">Stufen:</span>
			{#each bus.stages() as stage, i (`s${i}`)}
				{#if i > 0}
					<span class="text-foreground/25">→</span>
				{/if}
				<span class="flex gap-1 rounded-full border border-foreground/10 px-2 py-0.5">
					{#each stage as a (a.manifest.id)}
						<button
							type="button"
							onclick={() => {
								selected = a
								answer = ''
							}}
							class="transition-opacity {selected.manifest.id === a.manifest.id
								? ''
								: 'opacity-50 hover:opacity-100'}"
						>
							{a.manifest.name}
						</button>
					{/each}
				</span>
			{/each}
		</div>

		{#if graph}
			<ActorGraph
				{proof}
				{selected}
				focus={focusGraph}
				onselect={(actor) => {
					selected = actor
					answer = ''
				}}
			/>
		{/if}

		<!-- ------------------------------------------------ TEMPLATE (the class) -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<div class="flex items-baseline justify-between gap-3 pb-1">
				<h3 class="font-semibold text-sm">Template</h3>
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

			{#if selected.requires.length > 0 || selected.produces.length > 0}
				<div class="flex flex-wrap items-center gap-1.5 pb-3 text-xs">
					<span class="text-foreground/40">Vertrag:</span>
					{#each selected.requires as r, i (`r${i}`)}
						{@render pill(r)}
					{/each}
					<span class="text-foreground/30">→</span>
					{#each selected.produces as p, i (`p${i}`)}
						{@render pill(p)}
					{/each}
				</div>
			{/if}

			{#if selected.manifest.methods.length > 0}
				<div class="flex flex-col gap-2">
					<h4 class="text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
						Methoden ({selected.manifest.methods.length})
					</h4>
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
							{#if selected.handlerSource(method.name)}
								<details class="pt-1">
									<summary
										class="cursor-pointer font-mono text-[0.6875rem] text-foreground/35 hover:text-foreground/60"
									>
										Code — der laufende Handler, aus der Funktion selbst gelesen
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
					Keine Methoden — dieser Actor ist reine Transformation, sein Vertrag ist die ganze
					Schnittstelle.
				</p>
			{/if}
		</section>

		<!-- --------------------------------------------- INSTANZ (the running one) -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<div class="flex items-center gap-2 pb-2">
				<h3 class="font-semibold text-sm">Instanz</h3>
				<span
					class="size-1.5 rounded-full {instance ? 'bg-status-success' : 'bg-foreground/20'}"
				></span>
			</div>
			{#if instance}
				<dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
					{#each Object.entries(instance) as [key, value] (key)}
						<div>
							<dt class="text-[0.6875rem] text-foreground/40">{key}</dt>
							<dd class="font-medium">{value}</dd>
						</div>
					{/each}
					<div>
						<dt class="text-[0.6875rem] text-foreground/40">Mailbox</dt>
						<dd class="font-medium">{selected.pending} wartend</dd>
					</div>
					<div>
						<dt class="text-[0.6875rem] text-foreground/40">Handler-Fehler</dt>
						<dd class="font-medium {selected.failures > 0 ? 'text-status-error' : ''}">
							{selected.failures}{selected.lastError ? ` · ${selected.lastError}` : ''}
						</dd>
					</div>
				</dl>
			{:else}
				<p class="text-foreground/40 text-sm">
					Nur Template — noch keine laufende Instanz. Der Vertrag ist deklariert, die Ausführung
					kommt mit der Flow-Engine.
				</p>
			{/if}
		</section>

		<!-- ------------------------------------- RELATIONEN (derived, never stored) -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<h3 class="pb-2 font-semibold text-sm">Relationen</h3>
			<div class="grid gap-3 text-sm sm:grid-cols-2">
				<div>
					<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">
						Wird gespeist von
					</h4>
					{#each feeders as edge, i (`f${i}`)}
						<p class="flex items-center gap-1.5 py-0.5">
							<span class="font-medium">{bus.get(edge.from)?.manifest.name}</span>
							{@render pill(edge.predicate)}
						</p>
					{:else}
						<p class="text-foreground/40 text-xs">niemandem — Eingang von außen</p>
					{/each}
				</div>
				<div>
					<h4 class="pb-1.5 text-[0.6875rem] text-foreground/40 uppercase tracking-wide">Speist</h4>
					{#each fed as edge, i (`t${i}`)}
						<p class="flex items-center gap-1.5 py-0.5">
							{@render pill(edge.predicate)}
							<span class="font-medium">{bus.get(edge.to)?.manifest.name}</span>
						</p>
					{:else}
						<p class="text-foreground/40 text-xs">niemanden — Ausgang nach außen</p>
					{/each}
				</div>
			</div>
			{#if selected.manifest.methods.length > 0}
				<p class="pt-2 text-[0.6875rem] text-foreground/40">
					Zusätzlich: alle {selected.manifest.methods.length} Methoden sind über den Chat erreichbar
					— die Werkzeugliste des Modells wird aus diesem Manifest abgeleitet.
				</p>
			{/if}
		</section>

		<!-- ------------------------------------- FACE: the actor's own window -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<div class="flex items-center gap-2 pb-1">
				<h3 class="font-semibold text-sm">Face</h3>
				<span
					class="size-1.5 rounded-full {selected.face ? 'bg-status-success' : 'bg-foreground/20'}"
				></span>
			</div>
			{#if selected.face}
				{@const Face = selected.face as import('svelte').Component<{ actor: typeof selected }>}
				<p class="pb-2 text-[0.6875rem] text-foreground/40">
					Dieser Actor malt sein eigenes Fenster — dieselbe Komponente, die der Views-Tab aus der
					Registry ableitet, hier live auf demselben Zustand:
				</p>
				<details>
					<summary class="cursor-pointer text-foreground/50 text-xs hover:text-foreground/80">
						Face einblenden
					</summary>
					<div class="mt-2 max-h-80 overflow-y-auto rounded-xl border border-foreground/10 p-3">
						<Face actor={selected} />
					</div>
				</details>
			{:else}
				<p class="text-foreground/40 text-sm">
					Kein Face — dieser Actor arbeitet unsichtbar; sein Zustand ist trotzdem oben ablesbar.
				</p>
			{/if}
		</section>

		<!-- ------------------------------- CONFIG: the manifest, raw and derived -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<h3 class="pb-1 font-semibold text-sm">Config</h3>
			<p class="pb-2 text-[0.6875rem] text-foreground/40">
				Das rohe Manifest — die einzige gespeicherte Wahrheit über diesen Actor. Alles andere
				(Werkzeugliste, Kanten, Stufen, Beweise, dieses Panel) wird daraus abgeleitet.
			</p>
			<details>
				<summary class="cursor-pointer text-foreground/50 text-xs hover:text-foreground/80">
					Manifest als JSON
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

		<!-- --------------------------------- BEWEIS: SLD backward chaining, live -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<div class="flex flex-wrap items-center gap-2 pb-2">
				<h3 class="font-semibold text-sm">Beweis</h3>
				<span class="text-[0.6875rem] text-foreground/40">
					Ziel wählen — der Solver sucht rückwärts Produzenten und beweist deren Bedarf, mit
					Backtracking; not(…) gilt als Negation-as-Failure.
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
						placeholder="eigenes Ziel, z.B. reply(R) oder not(x(Y))"
						class="w-56 rounded-full border border-foreground/5 bg-surface-soft/60 px-3 py-1 font-mono text-[0.6875rem] outline-none placeholder:text-foreground/30"
					>
					<button
						type="submit"
						class="rounded-full bg-primary px-3 py-1 text-[0.6875rem] text-primary-foreground"
					>
						beweisen
					</button>
				</form>
			</div>
			{#if proof}
				{@render proofNode(proof)}
			{/if}
		</section>

		<!-- ----------------------------------------------- ask(): the interview -->
		<section
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<h3 class="pb-2 font-semibold text-sm">ask()</h3>
			<form onsubmit={ask} class="flex items-center gap-2">
				<input
					bind:value={question}
					placeholder={`Frag ${selected.manifest.name}…`}
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
	</div>
</div>
