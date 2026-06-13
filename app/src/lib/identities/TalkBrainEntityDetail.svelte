<script lang="ts">
/**
 * Entity detail view inside the brain aside (board 0024/0025): the full card for ONE
 * entity — its kind, bonded neighbours, typed facts (with validity + confidence), and the
 * memories that mention it. Opened by clicking an entity chip in the Context or Dreaming
 * tab; the back button returns to the brain view. Bonded neighbours are themselves
 * clickable so the graph is walkable.
 */
import { type BrainEntityCard, brainEntityCard } from '$lib/brain/api'

const {
	identityId,
	name,
	onBack,
	onOpen
}: {
	identityId: string
	name: string
	/** Return to the Context/Dreaming view. */
	onBack: () => void
	/** Walk to a bonded neighbour (re-targets this same detail view). */
	onOpen: (name: string) => void
} = $props()

let card = $state<BrainEntityCard | null>(null)
let loading = $state(true)
let err = $state<string | undefined>()

// Re-fetch whenever the target entity changes (back/forward through the graph).
$effect(() => {
	const who = name
	loading = true
	err = undefined
	card = null
	brainEntityCard(identityId, who)
		.then((c) => {
			if (who === name) card = c
		})
		.catch((e) => {
			if (who === name) err = e instanceof Error ? e.message : String(e)
		})
		.finally(() => {
			if (who === name) loading = false
		})
})

function snip(s: string, n = 110): string {
	return s.length > n ? `${s.slice(0, n)}…` : s
}

function dateLabel(ms?: number | null): string | null {
	if (ms == null) return null
	try {
		return new Date(ms).toLocaleDateString()
	} catch {
		return null
	}
}
</script>

<div class="flex h-full min-h-0 flex-col py-1 text-xs">
	<!-- Header: back to the brain view + the entity title/kind. -->
	<div class="mb-2 flex shrink-0 items-center gap-2 border-b border-border/60 pb-1.5">
		<button
			type="button"
			class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
			onclick={onBack}
		>
			<svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M10 3 5 8l5 5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			brain
		</button>
		<div class="ml-auto min-w-0 text-right">
			<div class="truncate font-semibold text-foreground">{name}</div>
			{#if card}
				<div class="text-[10px] text-sky-400">{card.kind}</div>
			{/if}
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
		{#if loading}
			<p class="text-muted-foreground">Loading entity…</p>
		{:else if err}
			<section class="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-red-400">
				{err}
			</section>
		{:else if !card}
			<p class="text-muted-foreground">No card for “{name}” — it may not be in the graph yet.</p>
		{:else}
			<!-- FACTS: typed subject→predicate→object claims about this entity. -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium"><span class="text-rose-400">facts</span> · {card.facts.length}</div>
				{#if card.facts.length === 0}
					<p class="text-muted-foreground">— none mined yet</p>
				{:else}
					<ul class="space-y-1.5">
						{#each card.facts as f (f.predicate + f.objectName)}
							{@const from = dateLabel(f.validFromMs)}
							{@const to = dateLabel(f.validToMs)}
							<li class="leading-snug">
								<span class="font-mono text-[10px] text-violet-300">{f.predicate}</span>
								<span class="text-foreground/90">{f.objectName}</span>
								<span class="text-muted-foreground font-mono text-[10px]"
									>· {(f.confidence * 100).toFixed(0)}%</span
								>
								{#if from}
									<span class="text-muted-foreground text-[10px]">
										· {from}{to ? `–${to}` : ''}{to ? '' : ' (current)'}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- BONDS: co-mention strength to neighbouring entities — walkable. -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium"><span class="text-amber-400">bonds</span> · {card.bonds.length}</div>
				{#if card.bonds.length === 0}
					<p class="text-muted-foreground">— no bonded entities</p>
				{:else}
					<div class="flex flex-wrap gap-1">
						{#each card.bonds as [other, strength] (other)}
							<button
								type="button"
								class="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 transition hover:border-primary/60 hover:bg-card"
								onclick={() => onOpen(other)}
							>
								<span class="text-foreground/90">{other}</span>
								<span class="text-muted-foreground font-mono text-[10px]">{strength.toFixed(2)}</span>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<!-- REFS: memories that mention this entity (the provenance). -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium">
					<span class="text-emerald-400">refs</span> · {card.recentMemories.length} memor{card
						.recentMemories.length === 1
						? 'y'
						: 'ies'}
				</div>
				{#if card.recentMemories.length === 0}
					<p class="text-muted-foreground">— not mentioned in any memory</p>
				{:else}
					<ul class="space-y-1.5">
						{#each card.recentMemories as m (m.id)}
							<li class="leading-snug">
								<span class="text-muted-foreground font-mono text-[10px]">{m.authorRole}</span>
								<span class="text-foreground/90">{snip(m.content)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</div>
