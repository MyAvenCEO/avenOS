<script lang="ts">
/**
 * Left aside — list of intent rows + collapsible "Archived" group.
 *
 * Pure presentational: receives the already-sorted `activeIntents` and
 * `archivedIntents` arrays from the page, plus current `selectedId` and
 * `nowMs` for live timer rendering. Selection is reported back via the
 * `onSelect` callback prop; the archived group's open state is two-way bound
 * via `$bindable` so the parent's selection logic can auto-expand the group
 * when the user picks an archived intent from elsewhere.
 *
 * Mobile: full-width master list, bottom-aligned above the composer with
 * archived at the top and errors nearest the action bar.
 */
import {
	type IntentRow,
	intentTotalSkillElapsedSeconds,
	statusLabel
} from './types'
import StatusCard from './StatusCard.svelte'
import { t } from '$lib/i18n'

const MOBILE_MQ = '(max-width: 639px)'

let {
	activeIntents,
	archivedIntents,
	selectedId,
	archivedOpen = $bindable(false),
	nowMs,
	onSelect
}: {
	activeIntents: IntentRow[]
	archivedIntents: IntentRow[]
	selectedId: string | null
	archivedOpen?: boolean
	nowMs: number
	onSelect: (id: string) => void
} = $props()

let isMobile = $state(false)

$effect(() => {
	if (typeof window === 'undefined') return
	const mq = window.matchMedia(MOBILE_MQ)
	const sync = () => {
		isMobile = mq.matches
	}
	sync()
	mq.addEventListener('change', sync)
	return () => mq.removeEventListener('change', sync)
})

/** Mobile stack: success/working/hitl above, errors closest to composer. */
const mobileActiveIntents = $derived([...activeIntents].reverse())
</script>

{#snippet archivedSection()}
	{#if archivedIntents.length > 0}
		<div class="mt-1 flex items-center gap-1.5 px-0.5 pt-1 sm:mt-1">
			<div class="h-px flex-1 bg-border/50"></div>
			<button
				type="button"
				class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-[0.18em] uppercase text-foreground/40 transition-colors hover:bg-background/60 hover:text-foreground/70"
				aria-expanded={archivedOpen}
				onclick={() => (archivedOpen = !archivedOpen)}
			>
				<svg
					class="size-2.5 transition-transform duration-200 ease-out {archivedOpen
						? 'rotate-90'
						: ''}"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m9 18 6-6-6-6" />
				</svg>
				<span>{t('intents.archivedCount', { count: archivedIntents.length })}</span>
			</button>
			<div class="h-px flex-1 bg-border/50"></div>
		</div>
		{#if archivedOpen}
			{#each archivedIntents as intent (intent.id)}
				<StatusCard
					status={intent.status}
					totalSeconds={intentTotalSkillElapsedSeconds(intent, nowMs)}
					title={intent.title}
					description={intent.summary}
					selected={selectedId === intent.id}
					archived={intent.status === 'archived'}
					onclick={() => onSelect(intent.id)}
					ariaPressed={selectedId === intent.id}
					ariaLabel={statusLabel(intent.status)}
					extraClass="w-full"
				/>
			{/each}
		{/if}
	{/if}
{/snippet}

{#snippet intentCards(intents: IntentRow[])}
	{#each intents as intent (intent.id)}
		<StatusCard
			status={intent.status}
			totalSeconds={intentTotalSkillElapsedSeconds(intent, nowMs)}
			title={intent.title}
			description={intent.summary}
			selected={selectedId === intent.id}
			archived={intent.status === 'archived'}
			onclick={() => onSelect(intent.id)}
			ariaPressed={selectedId === intent.id}
			ariaLabel={statusLabel(intent.status)}
			extraClass="w-full"
		/>
	{/each}
{/snippet}

<!-- Row 1: section label (aligned with skills label on the right). -->
<div
	class={`col-start-1 row-start-1 flex min-h-[1.125rem] items-center gap-2 self-start ${selectedId ? 'max-sm:hidden' : ''}`}
>
	<span class="text-[8px] font-bold tracking-[0.22em] opacity-30 uppercase">{t('intents.title')}</span>
</div>

<div
	class={`col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col gap-1 pr-0.5 sm:col-start-1 sm:row-start-2 ${selectedId ? 'max-sm:hidden' : 'max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:w-full'}`}
>
	{#if isMobile}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto max-sm:pb-1">
			<div class="flex min-h-full flex-col justify-end gap-1">
				{@render archivedSection()}
				{@render intentCards(mobileActiveIntents)}
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
			{@render intentCards(activeIntents)}
			{@render archivedSection()}
		</div>
	{/if}
</div>
