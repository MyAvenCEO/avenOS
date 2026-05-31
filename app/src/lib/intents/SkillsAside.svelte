<script lang="ts">
/**
 * Right aside — skills + workers for the selected intent.
 *
 * Desktop: mirrored column in the three-column grid.
 * Mobile: slide-over drawer toggled from a bottom-right FAB on the page.
 */
import {
	type IntentRow,
	type SkillWorker,
	type WorkerActor,
	skillLiveElapsedSeconds,
	skillStatusLabel
} from './types'
import StatusCard from './StatusCard.svelte'
import MobileAsideDrawer from '$lib/ui/MobileAsideDrawer.svelte'
import MobileAsideSectionLabel from '$lib/ui/MobileAsideSectionLabel.svelte'
import { mobileAsideBottomPadClass } from '$lib/ui/mobile-aside'
import { t } from '$lib/i18n'

let {
	intent,
	displayedSkills,
	workers,
	selectedSkillId,
	selectedWorkerName,
	nowMs,
	mobileOpen = $bindable(false),
	onSelectSkill,
	onSelectWorker
}: {
	intent: IntentRow | null
	displayedSkills: SkillWorker[]
	workers: WorkerActor[]
	selectedSkillId: string | null
	selectedWorkerName: string | null
	nowMs: number
	mobileOpen?: boolean
	onSelectSkill: (id: string | null) => void
	onSelectWorker: (name: string | null) => void
} = $props()

let workersGroupOpen = $state(true)

$effect(() => {
	void selectedSkillId
	workersGroupOpen = true
})

const skillsBottomPad = `pb-[calc(4.25rem+env(safe-area-inset-bottom))] ${mobileAsideBottomPadClass}`
</script>

{#snippet skillsBody(mirrorCards: boolean)}
	{#if intent && intent.skills.length > 0}
		{#if selectedSkillId}
			<button
				type="button"
				class="inline-flex min-h-[2.5rem] shrink-0 cursor-pointer items-center {mirrorCards
					? 'justify-end rounded-[var(--radius-lg)] border-y-0 border-l-0 border-r-[4px] border-solid border-r-border px-3 text-right'
					: 'justify-start rounded-[var(--radius-lg)] border-y-0 border-r-0 border-l-[4px] border-solid border-l-border px-3 text-left'} bg-surface-card py-0 text-[10px] font-semibold tracking-[0.2em] text-foreground/65 uppercase transition-colors duration-200 ease-out hover:bg-surface-card-hover"
				aria-label={t('intents.showAllSkillActivity')}
				onclick={() => onSelectSkill(null)}
			>
				{t('common.all')}
			</button>
		{/if}

		{#each displayedSkills as skill (skill.id)}
			{@const isSelected = selectedSkillId === skill.id}
			<StatusCard
				status={skill.status}
				totalSeconds={skillLiveElapsedSeconds(skill, nowMs)}
				title={skill.name}
				description={skill.description}
				selected={isSelected}
				onclick={() => onSelectSkill(selectedSkillId === skill.id ? null : skill.id)}
				ariaPressed={isSelected}
				ariaLabel={`${skill.name} — ${skillStatusLabel(skill.status)}`}
				extraClass="w-full"
				mirror={mirrorCards}
			/>
		{/each}

		{#if selectedSkillId && workers.length > 0}
			<div class="mt-1 flex items-center gap-1.5 px-0.5 pt-1">
				<div class="h-px flex-1 bg-border/50"></div>
				<button
					type="button"
					class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-[0.18em] uppercase text-foreground/40 transition-colors hover:bg-background/60 hover:text-foreground/70"
					aria-expanded={workersGroupOpen}
					onclick={() => (workersGroupOpen = !workersGroupOpen)}
				>
					<svg
						class="size-2.5 transition-transform duration-200 ease-out {workersGroupOpen
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
					<span>{t('intents.workersCount', { count: workers.length })}</span>
				</button>
				<div class="h-px flex-1 bg-border/50"></div>
			</div>
			{#if workersGroupOpen}
				{#each workers as worker (worker.id)}
					{@const isWorkerSelected = selectedWorkerName === worker.name}
					<button
						type="button"
						class="group flex w-full cursor-pointer items-center {mirrorCards
							? 'justify-end text-right'
							: 'justify-start text-left'} gap-2 overflow-hidden rounded-[var(--radius-lg)] border-y-0 {mirrorCards
							? 'border-l-0 border-r-[4px] border-solid border-r-driftwood'
							: 'border-r-0 border-l-[4px] border-solid border-l-driftwood'} px-2 py-1 transition-colors duration-200 ease-out {isWorkerSelected
							? 'bg-surface-card-selected'
							: 'bg-muted/12 hover:bg-surface-card-hover'}"
						aria-pressed={isWorkerSelected}
						aria-label={t('intents.filterByWorker', { name: worker.name })}
						onclick={() =>
							onSelectWorker(selectedWorkerName === worker.name ? null : worker.name)}
					>
						<span
							class="min-w-0 flex-1 truncate text-[11px] leading-tight font-medium tracking-tight {isWorkerSelected
								? 'text-foreground'
								: 'text-driftwood-foreground/85'}"
						>
							{worker.name}
						</span>
						<span
							class="flex size-5 shrink-0 items-center justify-center rounded-full bg-driftwood/25 text-[9px] font-bold uppercase {isWorkerSelected
								? 'text-foreground'
								: 'text-driftwood-foreground/80'}"
							aria-hidden="true"
						>
							{worker.name.slice(0, 1)}
						</span>
					</button>
				{/each}
			{/if}
		{/if}
	{/if}
{/snippet}

<div
	class="col-start-3 row-start-1 hidden min-h-[1.125rem] w-full items-center justify-end gap-1.5 self-start sm:flex"
>
	<span class="text-right text-[8px] font-bold tracking-[0.22em] opacity-30 uppercase">
		{t('intents.skillsCount')}
		{#if intent && intent.skills.length > 0}
			<span class="tabular-nums tracking-[0.18em]"> - {intent.skills.length}</span>
		{/if}
	</span>
</div>

<div
	class="col-start-3 row-start-2 hidden min-h-0 min-w-0 flex-col gap-1 overflow-y-auto pr-0.5 sm:flex"
>
	{@render skillsBody(true)}
</div>

<MobileAsideDrawer
	bind:open={mobileOpen}
	side="right"
	ariaLabel={t('intents.skillsAndWorkers')}
	hideFromClass="sm:hidden"
	zIndex={44}
	bottomPadClass={skillsBottomPad}
>
	{#snippet header()}
		<MobileAsideSectionLabel align="right" class="mb-0 opacity-30">
			{t('intents.skillsCount')}
			{#if intent && intent.skills.length > 0}
				<span class="tabular-nums tracking-[0.18em]"> · {intent.skills.length}</span>
			{/if}
		</MobileAsideSectionLabel>
	{/snippet}
	{#snippet children()}
		<div class="flex flex-col gap-1 pr-0.5">
			{@render skillsBody(true)}
		</div>
	{/snippet}
</MobileAsideDrawer>
