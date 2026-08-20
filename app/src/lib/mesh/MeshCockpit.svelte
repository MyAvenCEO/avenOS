<script lang="ts">
import ActorCard from './ActorCard.svelte'
import {
	type Actor,
	board,
	engaged,
	find,
	intentState,
	openAsks,
	path,
	type State,
	YOU
} from './model'
import { registry } from './registry'
import { intents, loose, threads } from './threads'

/**
 * The cockpit over the mesh: intents ARE actors born from events, and
 * everything shown here is derived from their message threads — the
 * grouping, the board of a collecting intent, the cards, the paths.
 * The landing view is the collecting intent (the month): it IS the
 * overview, the single items are one click away on its board.
 */

const actors: Actor[] = [...registry, ...intents]
const log = (id: string) => threads.find((t) => t.intent === id)?.log ?? []

let selected = $state<Actor>(
	intents.find((i) => board([...registry, ...intents], i.id, log(i.id)).length > 0) ?? intents[0]
)

const selState = $derived(intentState(actors, selected.id, log(selected.id)))
const cards = $derived(engaged(actors, selected.id, log(selected.id)))
const feeders = $derived(board(actors, selected.id, log(selected.id)))

const GROUPS: { state: State; label: string }[] = [
	{ state: 'needs-you', label: 'Needs you' },
	{ state: 'working', label: 'Working' },
	{ state: 'done', label: 'Done' }
]
const PILL: Record<string, { label: string; klasse: string }> = {
	working: { label: 'working', klasse: 'text-status-working' },
	'needs-you': { label: 'needs you', klasse: 'text-primary' },
	waiting: { label: 'waiting', klasse: 'text-foreground/40' },
	done: { label: 'done', klasse: 'text-status-success' }
}
const GLYPH: Record<string, { mark: string; klasse: string }> = {
	done: { mark: '✓', klasse: 'text-status-success' },
	'needs-you': { mark: '●', klasse: 'text-primary' },
	working: { mark: '◐', klasse: 'text-status-working' },
	waiting: { mark: '○', klasse: 'text-foreground/30' }
}

/** Why an intent is still open — the tip of its deepest ask-stack. */
function reason(intent: Actor): string {
	const l = log(intent.id)
	const s = intentState(actors, intent.id, l)
	if (s === 'done') return 'done'
	const toYou = openAsks(l).find((m) => m.to === YOU)
	if (toYou) return `you · ${toYou.method}`
	const first = engaged(actors, intent.id, l)[0]
	if (!first) return 'working'
	const stack = path(actors, first, l)
	const tip = stack.at(-1)
	return tip
		? (find(actors, tip)?.manifest.name ?? tip)
		: (find(actors, first)?.manifest.name ?? 'working')
}

const doneCount = $derived(feeders.filter((f) => f.done).length)
</script>

<div class="flex min-h-0 flex-1">
	<nav
		class="flex w-80 shrink-0 flex-col overflow-y-auto rounded-l-2xl border border-border bg-surface-card/50"
	>
		<h3
			class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Unrouted <span class="font-normal opacity-60">· messages without a `to`</span>
		</h3>
		{#each loose as e (e.id)}
			<div class="flex flex-col gap-2 border-border/50 border-b bg-surface-cream/30 px-4 py-3">
				<p class="text-xs leading-relaxed">{e.text}</p>
				{#if e.suggest}
					<p class="text-[0.625rem] text-foreground/45 leading-relaxed">
						Suggest: „{find(actors, e.suggest.intent)?.manifest.name}" — {e.suggest.why}
					</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-full bg-primary px-3 py-1 font-medium text-[0.6875rem] text-primary-foreground"
					>
						→ address it
					</button>
					<button
						type="button"
						class="rounded-full border border-border px-3 py-1 text-[0.6875rem] text-foreground/60"
					>
						spawn new intent
					</button>
				</div>
				<p class="font-mono text-[0.5625rem] text-foreground/30">{e.at} · mock</p>
			</div>
		{/each}

		{#each GROUPS as g (g.state)}
			{@const items = intents.filter((i) => intentState(actors, i.id, log(i.id)) === g.state)}
			{#if items.length}
				<h3
					class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
				>
					{g.label} <span class="font-normal opacity-60">· {items.length}</span>
				</h3>
				{#each items as i (i.id)}
					<button
						type="button"
						onclick={() => {
							selected = i
						}}
						class="border-border/50 border-b px-4 py-3 text-left transition-colors {selected.id ===
						i.id
							? 'bg-surface-cream'
							: 'hover:bg-surface-card'}"
					>
						<div class="flex items-baseline justify-between gap-2">
							<span class="truncate font-semibold text-sm">{i.manifest.name}</span>
							<span class="shrink-0 font-mono text-[0.5625rem] {GLYPH[g.state].klasse}">
								{GLYPH[g.state].mark}
							</span>
						</div>
						<div class="truncate pt-1 text-foreground/50 text-xs">{i.born?.goal}</div>
					</button>
				{/each}
			{/if}
		{/each}
	</nav>

	<div
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-r-2xl border border-border border-l-0 bg-surface-card/30 p-5"
	>
		<header class="flex flex-col gap-1">
			<div class="flex flex-wrap items-baseline gap-3">
				<h2 class="font-display font-semibold text-lg">{selected.manifest.name}</h2>
				<span class="ml-auto font-mono text-xs {PILL[selState].klasse}"
					>{PILL[selState].label}</span
				>
			</div>
			<p class="text-foreground/70 text-sm">{selected.born?.goal}</p>
			<p class="text-[0.6875rem] text-foreground/40">
				born from {selected.born?.event} · {selected.born?.at}
			</p>
		</header>

		{#if feeders.length > 0}
			<!-- The board of a collecting intent: whom it asked among the
			     born actors, and who answered — open asks, nothing more. -->
			<section class="rounded-2xl border border-border bg-surface-card p-4">
				<div class="flex flex-wrap items-baseline gap-3 pb-2">
					<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
						Waiting on
					</h3>
					<span class="ml-auto font-mono text-foreground/50 text-xs">
						{doneCount}
						/ {feeders.length}
					</span>
				</div>
				<div class="mb-2 h-1 overflow-hidden rounded-full bg-border/50">
					<div
						class="h-full rounded-full bg-status-success transition-all"
						style="width: {feeders.length ? Math.round((doneCount / feeders.length) * 100) : 0}%"
					></div>
				</div>
				{#each feeders as f (f.actor.id)}
					{@const fState = intentState(actors, f.actor.id, log(f.actor.id))}
					<button
						type="button"
						onclick={() => {
							selected = f.actor
						}}
						class="flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-cream/60"
					>
						<span class="w-3 shrink-0 text-center font-mono text-[0.625rem] {GLYPH[fState].klasse}">
							{GLYPH[fState].mark}
						</span>
						<span
							class="min-w-0 flex-1 truncate text-sm {f.done ? 'text-foreground/45' : 'font-medium'}"
						>
							{f.actor.manifest.name}
						</span>
						<span class="max-w-[45%] truncate font-mono text-[0.625rem] text-foreground/40">
							{reason(f.actor)}
						</span>
					</button>
				{/each}
			</section>
		{/if}

		<div class="grid grid-cols-1 gap-4 2xl:grid-cols-2">
			{#each cards as id (id)}
				<ActorCard {actors} {id} log={log(selected.id)} />
			{/each}
		</div>
	</div>
</div>
