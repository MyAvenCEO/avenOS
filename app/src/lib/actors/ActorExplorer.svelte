<script lang="ts">
import { type Actor, functor } from './actor'
import { bus } from './bus'

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
								<p class="pt-1 font-mono text-[0.6875rem] text-foreground/35">
									{Object.keys(
										(method.parameters as { properties?: Record<string, unknown> }).properties ?? {}
									).join(' · ')}
								</p>
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
