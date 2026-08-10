<script lang="ts">
import type { Actor } from './actor'
import { functor } from './actor'
import { bus } from './bus'

/**
 * The generic face — every actor deserves a window, even one spoken into
 * existence seconds ago with no code of its own. Shows what is knowable
 * about any actor: identity, contract, live state, and the interview. A
 * created "kalender" actor renders this until someone gives it a real face.
 */
const { actor }: { actor: Actor } = $props()

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

const instance = $derived(actor.instanceState())

let question = $state('')
let answer = $state('')
let busy = $state(false)

async function ask(event: SubmitEvent) {
	event.preventDefault()
	if (question.trim() === '' || busy) return
	busy = true
	answer = ''
	try {
		answer = await bus.ask(actor.manifest.id, question)
	} finally {
		busy = false
	}
}

// The face is not just a manifest viewer: the engine runs right here. The
// first produced predicate is the actor's natural goal; facts feed its
// external requirements.
const runGoal = $derived(actor.produces[0] ?? null)
let factsText = $state('')
let running = $state(false)
let runSummary = $state('')

async function execute(event: SubmitEvent) {
	event.preventDefault()
	if (!runGoal || running) return
	let facts: Record<string, unknown> = {}
	if (factsText.trim() !== '') {
		// A bare sentence is the common case by voice — wrap it as the payload
		// of the first external requirement instead of demanding JSON.
		try {
			facts = JSON.parse(factsText)
		} catch {
			const first = actor.requires[0]
			facts = first ? { [functor(first)]: { text: factsText.trim() } } : {}
		}
	}
	running = true
	runSummary = ''
	try {
		const run = await bus.satisfy(runGoal, facts)
		const last = run.steps.at(-1)
		runSummary =
			run.status === 'ok'
				? `✓ ${runGoal} → ${JSON.stringify(last?.out ?? {})}`
				: `✗ gescheitert: ${JSON.stringify(last?.out ?? {})}`
	} finally {
		running = false
	}
}
</script>

<div class="flex flex-col gap-3 text-foreground">
	<p class="text-foreground/60 text-sm leading-relaxed">{actor.manifest.description}</p>

	{#if actor.requires.length > 0 || actor.produces.length > 0}
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<span class="text-foreground/40">Vertrag:</span>
			{#each actor.requires as r, i (`r${i}`)}
				<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(r)}">{r}</span>
			{/each}
			<span class="text-foreground/30">→</span>
			{#each actor.produces as p, i (`p${i}`)}
				<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(p)}">{p}</span>
			{/each}
		</div>
	{/if}

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
		<p class="text-foreground/40 text-xs">
			Reines Template — Verträge deklariert; die Engine führt sie aus{actor.manifest.llm
				? ' (llm: das Modell antwortet als dieser Actor)'
				: ''}.
		</p>
	{/if}

	{#if runGoal}
		<form onsubmit={execute} class="flex items-center gap-2">
			<span class="shrink-0 font-mono text-[0.6875rem] text-foreground/40">⊢ {runGoal}</span>
			<input
				bind:value={factsText}
				placeholder={actor.requires.length > 0
					? `Eingabe für ${actor.requires.map(functor).join(', ')}…`
					: 'ohne Eingabe'}
				class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
			>
			<button
				type="submit"
				disabled={running}
				class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
			>
				{running ? 'läuft…' : 'Ausführen'}
			</button>
		</form>
		{#if runSummary}
			<p class="break-all font-mono text-[0.6875rem] leading-relaxed">{runSummary}</p>
		{/if}
	{/if}

	<form onsubmit={ask} class="flex items-center gap-2">
		<input
			bind:value={question}
			placeholder={`Frag ${actor.manifest.name}…`}
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
		<p class="text-sm leading-relaxed">{answer}</p>
	{/if}
</div>
