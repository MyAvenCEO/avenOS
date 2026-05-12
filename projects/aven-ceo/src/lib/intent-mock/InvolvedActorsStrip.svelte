<script lang="ts">
import { mockActorBeamSvg } from './boring-avatar'
import {
	involvedActorsForIntent,
	statusBadgeLabel,
	type ActorFilterSelection,
	type InvolvedActorDisplayRow
} from './involved-actors-display'
import type { IntentOrchestrator } from './types'

let {
	intent,
	selectedFilter = 'all',
	onFilterChange
}: {
	intent: IntentOrchestrator
	selectedFilter?: ActorFilterSelection
	onFilterChange: (filter: ActorFilterSelection) => void
} = $props()

/** Small neutral faces — layout: avatar left, title + status right. */
const SIZE = 40

const rows = $derived(involvedActorsForIntent(intent))

function setFilter(next: ActorFilterSelection) {
	onFilterChange(next)
}

function badgeClass(status: InvolvedActorDisplayRow['status']): string {
	const shell =
		'rounded-md border border-border/40 bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em]'
	switch (status) {
		case 'blocked_hitl':
			return `${shell} text-foreground/85`
		case 'running':
		case 'orchestrating':
			return `${shell} text-foreground/55`
		case 'done':
			return `${shell} text-foreground/40`
		case 'idle':
		default:
			return `${shell} text-foreground/35`
	}
}

function allTabClass(isOn: boolean): string {
	const base =
		'shrink-0 rounded-md border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] transition-colors'
	return isOn
		? `${base} border-foreground/25 bg-white/25 text-foreground/90`
		: `${base} border-border/35 bg-white/10 text-foreground/45 hover:border-border/55 hover:bg-white/15`
}

function actorCardClass(isOn: boolean): string {
	const base =
		'flex min-w-0 w-40 flex-row items-center gap-2.5 rounded-lg border sm:w-43 shrink-0 px-1 py-1 -mx-1 text-left transition-colors'
	return isOn
		? `${base} border-foreground/25 bg-white/20`
		: `${base} border-transparent hover:border-border/40 hover:bg-white/10`
}
</script>

<div class="flex min-w-0 flex-col gap-2">
	<div class="flex flex-wrap items-start gap-x-2 gap-y-2">
		<button
			type="button"
			class={allTabClass(selectedFilter === 'all')}
			aria-pressed={selectedFilter === 'all'}
			onclick={() => setFilter('all')}
		>
			All
		</button>

		<ul
			class="flex min-w-0 flex-1 list-none flex-row flex-wrap items-stretch gap-x-2 gap-y-2 p-0 m-0"
			aria-label="Filter by actor"
		>
			{#each rows as row (row.actor.id)}
				<li class="shrink-0 list-none">
					<button
						type="button"
						class={actorCardClass(selectedFilter === row.actor.id)}
						aria-pressed={selectedFilter === row.actor.id}
						aria-label={`Filter: ${row.skillName}`}
						onclick={() => setFilter(row.actor.id)}
					>
						<div
							class="size-10 shrink-0 rounded-full border border-border/50 overflow-hidden bg-white/20 [&_svg]:block [&_svg]:size-full"
						>
							{@html mockActorBeamSvg(row.actor, SIZE)}
						</div>
						<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
							<p
								class="text-[11px] font-medium leading-snug tracking-tight text-foreground/90 line-clamp-2"
							>
								{row.skillName}
							</p>
							<span
								class="inline-flex w-fit max-w-full items-center justify-center {badgeClass(
									row.status
								)}"
							>
								{statusBadgeLabel(row.status)}
							</span>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	</div>
</div>
