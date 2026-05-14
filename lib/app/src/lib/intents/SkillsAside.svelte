<script lang="ts">
/**
 * Right aside (desktop only) — mirrored skills column for the selected
 * intent. Renders the SKILLS header, an optional ALL chip when a skill is
 * selected, the list of `displayedSkills` cards (mirrored variant of
 * `StatusCard`), and a collapsible "Workers" group bound to the selected
 * skill's worker pool.
 *
 * Selection events bubble up via `onSelectSkill` / `onSelectWorker` callback
 * props; the page owns `selectedSkillId` + `selectedWorkerName` so the
 * activity log filter stays in sync. The Workers collapsible's open/closed
 * state is local — it auto-resets to expanded whenever `selectedSkillId`
 * changes via an internal `$effect`.
 *
 * Hidden on mobile (`max-sm:hidden`); the inline horizontal skills scroller
 * for mobile lives inside `MainPanel.svelte`.
 */
import {
	type IntentRow,
	type SkillWorker,
	type WorkerActor,
	skillLiveElapsedSeconds,
	skillStatusLabel
} from './types'
import StatusCard from './StatusCard.svelte'

let {
	intent,
	displayedSkills,
	workers,
	selectedSkillId,
	selectedWorkerName,
	nowMs,
	onSelectSkill,
	onSelectWorker
}: {
	intent: IntentRow | null
	displayedSkills: SkillWorker[]
	workers: WorkerActor[]
	selectedSkillId: string | null
	selectedWorkerName: string | null
	nowMs: number
	onSelectSkill: (id: string | null) => void
	onSelectWorker: (name: string | null) => void
} = $props()

/**
 * Local UI state for the "Workers" collapsible group. Resets to `true`
 * (expanded) every time `selectedSkillId` changes so the group always
 * shows on initial select; the user can still collapse it manually.
 */
let workersGroupOpen = $state(true)

$effect(() => {
	// Reading `selectedSkillId` registers it as a reactive dependency so this
	// effect re-runs (including on clear → null) and resets the workers UI
	// state. The write inside doesn't read `workersGroupOpen`, so no loop.
	void selectedSkillId
	workersGroupOpen = true
})
</script>

<div
	class="col-start-3 row-start-1 hidden min-h-[1.125rem] items-center gap-1.5 self-start sm:flex"
>
	<span class="text-[8px] font-bold tracking-[0.22em] opacity-30 uppercase">
		Skills
		{#if intent && intent.skills.length > 0}
			<span class="tabular-nums tracking-[0.18em]"> - {intent.skills.length}</span>
		{/if}
	</span>
</div>

<div
	class="col-start-3 row-start-2 hidden min-h-0 min-w-0 flex-col gap-1 overflow-y-auto pr-0.5 sm:flex"
>
	{#if intent && intent.skills.length > 0}
		{#if selectedSkillId}
			<button
				type="button"
				class="inline-flex min-h-[2.5rem] shrink-0 cursor-pointer items-center justify-end rounded-[var(--radius-lg)] border-y-0 border-l-0 border-r-[4px] border-solid border-r-border bg-surface-card px-3 py-0 text-right text-[10px] font-semibold tracking-[0.2em] text-foreground/65 uppercase transition-colors duration-200 ease-out hover:bg-surface-card-hover"
				aria-label="Show all skill activity"
				onclick={() => onSelectSkill(null)}
			>
				All
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
				mirror
			/>
		{/each}

		<!--
			Workers collapsible group. Mirrors the Archived intents group on
			the left aside: divider lines flanking a chevron+label toggle,
			chevron on the LEFT of the label. Right-aligned content
			(`text-right`) so the group reads as a visual mirror of the left
			aside. Only rendered when a skill is selected and the skill has
			at least one worker. State resets to expanded whenever the
			selected skill changes (see effect above).
		-->
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
					<span>Workers · {workers.length}</span>
				</button>
				<div class="h-px flex-1 bg-border/50"></div>
			</div>
			{#if workersGroupOpen}
				{#each workers as worker (worker.id)}
					{@const isWorkerSelected = selectedWorkerName === worker.name}
					<button
						type="button"
						class="group flex w-full cursor-pointer items-center justify-end gap-2 overflow-hidden rounded-[var(--radius-lg)] border-y-0 border-l-0 border-r-[4px] border-solid border-r-driftwood px-2 py-1 text-right transition-colors duration-200 ease-out {isWorkerSelected
							? 'bg-surface-card-selected'
							: 'bg-muted/12 hover:bg-surface-card-hover'}"
						aria-pressed={isWorkerSelected}
						aria-label={`Filter activity by worker ${worker.name}`}
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
</div>
