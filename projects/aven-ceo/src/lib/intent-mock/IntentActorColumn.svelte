<script lang="ts">
import { mockActorBeamSvg } from './boring-avatar'
import {
	involvedActorsForIntent,
	statusBadgeLabel,
	type InvolvedActorDisplayRow,
	type InvolvedActorId
} from './involved-actors-display'
import type { IntentOrchestrator } from './types'

/** Beam output size — fits the {@link size-8} frame. */
const AVATAR_PX = 32

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

/** Match {@link IntentLeftNav} pill vocabulary: ring + uppercase micro label. */
function badgeClass(status: InvolvedActorDisplayRow['status']): string {
	const shell =
		'inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide leading-none text-center ring-1 uppercase'
	switch (status) {
		case 'blocked_hitl':
			return `${shell} bg-amber-500/15 text-amber-950 ring-amber-500/25`
		case 'running':
			return `${shell} bg-sky-500/10 text-sky-950 ring-sky-500/20`
		case 'orchestrating':
			return `${shell} bg-foreground/[0.06] text-foreground/70 ring-border/50`
		case 'done':
			return `${shell} bg-foreground/10 text-foreground/65 ring-transparent`
		case 'idle':
		default:
			return `${shell} bg-foreground/[0.04] text-foreground/50 ring-border/55`
	}
}

function itemClass(isOn: boolean): string {
	const base =
		'group w-full cursor-pointer rounded-lg border text-left transition-colors duration-150 ease-out px-2 py-2'
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
		class="scrollbar-gutter-stable flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden pr-0.5"
		aria-label="Select skill"
	>
		{#each rows as row, i (row.actor.id)}
			{#if i > 0 && showDividerAfter(rows[i - 1]!, row)}
				<div class="my-1 h-px shrink-0 bg-border/60" role="separator" aria-hidden="true"></div>
			{/if}
			<button
				type="button"
				class={itemClass(selectedActorId === row.actor.id)}
				aria-pressed={selectedActorId === row.actor.id}
				aria-label={`Skill: ${row.skillName}`}
				onclick={() => onSelectActor(row.actor.id)}
			>
				<div class="flex items-start gap-2">
					<div
						class="size-8 shrink-0 overflow-hidden rounded-full border border-border/50 bg-background/50 [&_svg]:block [&_svg]:size-full"
					>
						{@html mockActorBeamSvg(row.actor, AVATAR_PX)}
					</div>
					<div class="min-w-0 flex-1 space-y-1 pt-0.5">
						<p
							class="text-[11px] font-semibold leading-snug tracking-tight text-foreground/90 line-clamp-2"
						>
							{row.skillName}
						</p>
						<span
							class="inline-flex max-w-full items-center justify-center {badgeClass(row.status)}"
						>
							{statusBadgeLabel(row.status)}
						</span>
					</div>
				</div>
			</button>
		{/each}
	</nav>
</section>
