<script lang="ts">
import {
	involvedActorsForIntent,
	statusBadgeLabel,
	type InvolvedActorDisplayRow,
	type InvolvedActorId
} from './involved-actors-display'
import type { IntentOrchestrator } from './types'

let {
	intent,
	selectedActorId,
	onSelectActor
}: {
	intent: IntentOrchestrator
	selectedActorId: InvolvedActorId
	onSelectActor: (id: InvolvedActorId) => void
} = $props()

const rows = $derived(involvedActorsForIntent(intent))

function showDividerAfter(prev: InvolvedActorDisplayRow, row: InvolvedActorDisplayRow): boolean {
	return prev.actor.tier !== row.actor.tier
}

/** State dots — richer greens / amber / orange / grey (higher chroma, still UI-soft). */
function statusDotClass(status: InvolvedActorDisplayRow['status']): string {
	const shell = 'size-2.5 shrink-0 rounded-full ring-2 ring-background shadow-sm'
	switch (status) {
		case 'blocked_hitl':
			return `${shell} bg-orange-400`
		case 'running':
			return `${shell} bg-amber-300`
		case 'orchestrating':
			return `${shell} bg-emerald-400`
		case 'done':
			return `${shell} bg-green-500`
		case 'idle':
		default:
			return `${shell} bg-stone-500`
	}
}

function itemClass(isOn: boolean): string {
	const base =
		'group w-full cursor-pointer rounded-lg border text-left transition-colors duration-150 ease-out px-2 py-1.5'
	return isOn
		? `${base} border-foreground/20 bg-background/90`
		: `${base} border-border/40 bg-background/40 hover:bg-background/70`
}
</script>

<section class="flex h-full min-h-0 w-full max-w-31 min-w-0 flex-col border-l border-border/50 pl-2">
	<div class="mb-1.5 flex shrink-0 items-center gap-2">
		<span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Skills</span>
	</div>
	<nav
		class="scrollbar-gutter-stable flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pr-0.5"
		aria-label="Select skill"
	>
		{#each rows as row, i (row.actor.id)}
			{#if i > 0 && showDividerAfter(rows[i - 1]!, row)}
				<div class="my-1 h-px shrink-0 bg-border/60" role="separator" aria-hidden="true"></div>
			{/if}
			<button
				type="button"
				class={itemClass(selectedActorId === row.actor.id)}
				title={`${row.skillName} · ${statusBadgeLabel(row.status)}`}
				aria-pressed={selectedActorId === row.actor.id}
				aria-label={`Skill ${row.skillName}, ${statusBadgeLabel(row.status)}`}
				onclick={() => onSelectActor(row.actor.id)}
			>
				<div class="flex items-center gap-2">
					<span class={statusDotClass(row.status)} aria-hidden="true"></span>
					<p
						class="min-w-0 flex-1 text-[11px] font-semibold leading-snug tracking-tight text-foreground/90 line-clamp-2"
					>
						{row.skillName}
					</p>
				</div>
			</button>
		{/each}
	</nav>
</section>
