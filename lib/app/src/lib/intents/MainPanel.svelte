<script lang="ts">
/**
 * Center column — mobile inline skills scroller, Activity/Display tab
 * strip, and the body that swaps between `ActivityView` and `DisplayView`
 * depending on the active tab + HITL state.
 *
 * Owns the edge-detected auto-switch effect that snaps `activityTab` to
 * `display` on each new HITL transition and back to `activity` when the
 * intent leaves HITL. The user can still flip the tab manually mid-HITL —
 * the effect only fires on transition edges (not on every reactive tick).
 *
 * `activityTab` is `$bindable` so the parent can read the current tab if
 * needed; selection of the mobile skill chip rolls back up to the parent
 * via `onSelectSkill`.
 */
import {
	type ActivityEntry,
	type ActivityTab,
	type IntentRow,
	type SkillWorker,
	skillLiveElapsedSeconds,
	skillStatusLabel
} from './types'
import StatusCard from './StatusCard.svelte'
import ActivityView from './ActivityView.svelte'
import DisplayView from './DisplayView.svelte'
import ConfigView from './ConfigView.svelte'
import ContextView from './ContextView.svelte'

let {
	intent,
	selectedSkill,
	displayedSkills,
	selectedSkillId,
	filteredLogs,
	nowMs,
	activityTab = $bindable<ActivityTab>('activity'),
	onSelectSkill
}: {
	intent: IntentRow | null
	selectedSkill: SkillWorker | null
	displayedSkills: SkillWorker[]
	selectedSkillId: string | null
	filteredLogs: ActivityEntry[]
	nowMs: number
	activityTab?: ActivityTab
	onSelectSkill: (id: string | null) => void
} = $props()

/**
 * HITL preview is active whenever the selected intent is paused for human
 * feedback (`hitl`) OR a selected skill is in its HITL-equivalent state
 * (`waiting`) under a parent intent that is still in flight (not already
 * resolved/archived). When active, the Activity log panel is replaced by a
 * sandboxed vibe-view app embedded via `VibeSandboxFrame`.
 */
const showHitlPreview = $derived.by(() => {
	if (intent?.status === 'hitl') return true
	if (
		selectedSkill?.status === 'waiting' &&
		intent != null &&
		intent.status !== 'success' &&
		intent.status !== 'archived'
	)
		return true
	return false
})

/**
 * Whether the intent has terminally failed. The Display tab body switches
 * from the vibe-view sandbox to an inline error appshell in this case
 * (handled inside `DisplayView`). The tab strip and auto-switch effect
 * also activate on error so the operator sees the failure surface
 * immediately on transition into `error`.
 */
const isError = $derived(intent?.status === 'error')

/**
 * Combined gate for the second tab + Display body: shown whenever the
 * intent is paused for human attention (HITL) OR has terminally errored.
 * The tab label swaps between "Display" (HITL) and "Error" (error) based
 * on which branch is active.
 */
const inDisplay = $derived(showHitlPreview || isError)

/**
 * Edge-detected display key (`<intent-id>:<display|other>`) used to
 * auto-switch `activityTab` exactly once per transition into / out of
 * the display state. Keyed strictly on the **intent's own** status
 * (`hitl` / `error`) — selecting a `waiting` skill must NOT trigger an
 * auto-switch, even though it can still light up the second tab via
 * `showHitlPreview`. Tracking edges (rather than the raw boolean) lets
 * the user manually flip back to "Activity" mid-HITL or mid-error
 * without the next reactive re-render snapping it back to the second
 * tab. On Re-train (intent goes back to `working`) we leave `display`
 * and snap back to `activity`.
 */
let lastDisplayEdgeKey: string | null = null

$effect(() => {
	if (!intent) {
		lastDisplayEdgeKey = null
		return
	}
	const intentInDisplay = intent.status === 'hitl' || intent.status === 'error'
	const key = `${intent.id}:${intentInDisplay ? 'display' : 'other'}`
	if (key === lastDisplayEdgeKey) return
	lastDisplayEdgeKey = key
	activityTab = intentInDisplay ? 'display' : 'activity'
})
</script>

<!--
	Skills label — MOBILE only. On desktop the SKILLS header lives in the
	right aside (col 3, row 1) so this cell is `sm:hidden`. Mobile keeps
	the inline label above the master/detail Activity area when an intent
	is selected, matching the pre-three-column flow.
-->
<div
	class={`col-start-1 row-start-3 flex min-h-[1.125rem] items-center gap-1.5 self-start sm:hidden ${!intent ? 'max-sm:hidden' : ''}`}
>
	<span class="text-[8px] font-bold tracking-[0.22em] opacity-30 uppercase">
		Skills
		{#if intent && intent.skills.length > 0}
			<span class="tabular-nums tracking-[0.18em]"> - {intent.skills.length}</span>
		{/if}
	</span>
</div>

<!--
	Center / main panel. On desktop it spans both grid rows (row 1 + 2)
	of column 2 so the Activity / Display tab strip and body sit at the
	top of the column instead of beneath what used to be a horizontal
	skills row. On mobile we keep master/detail flow (row 4 in DOM, last
	stacked item under flex-col).
-->
<div
	class={`col-start-1 row-start-4 flex min-h-0 min-w-0 flex-1 flex-col max-sm:items-start max-sm:justify-start sm:col-start-2 sm:row-start-1 sm:row-end-3 ${!intent ? 'max-sm:hidden' : 'max-sm:row-start-2'}`}
>
	<div class="flex min-h-[12rem] min-w-0 flex-1 flex-col gap-2 sm:min-h-[18rem]">
		{#if intent}
			{#if intent.skills.length > 0}
				<!--
					Mobile-only horizontal skills scroller. On desktop the skills
					render as a vertical list in the right aside (col 3) instead.
				-->
				<div
					class="flex min-h-0 min-w-0 items-center gap-1.5 overflow-x-auto px-0.5 pb-0.5 sm:hidden"
				>
					{#if selectedSkillId}
						<button
							type="button"
							class="inline-flex min-h-[2.5rem] shrink-0 cursor-pointer items-center justify-center self-stretch rounded-[var(--radius-lg)] border-y-0 border-r-0 border-l-[4px] border-solid border-l-border bg-surface-card px-3 py-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/65 transition-colors duration-200 ease-out hover:bg-surface-card-hover"
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
							extraClass="w-[12.5rem] shrink-0"
							skillRow
						/>
					{/each}
				</div>
			{/if}

			<!--
				Tab strip: when the selected intent (or the selected skill under
				an in-flight intent) is in HITL — or the intent itself has
				terminally errored — expose a second tab next to "Activity".
				Its label is "Display" for HITL (vibe-view sandbox) and "Error"
				for error (inline diagnostic appshell). DisplayView owns the
				branch between iframe and inline error panel based on
				`intent.status`. When neither is active, fall back to the
				original static Activity label so the activity log section is
				visually unchanged.

				Security: VibeSandboxFrame (mounted inside DisplayView for the
				HITL branch) embeds the chosen vibe view inside the
				separate-origin sandbox proxy at PUBLIC_VIBE_SANDBOX_URL via
				the `@avenos/vibe-app-sandbox` host bridge (same pattern used
				by /docs/vibe-apps). All postMessage origin checks and iframe
				`sandbox` attributes are owned by `VibeSandboxFrame`.
			-->
			<div class="mt-1 flex items-center gap-3" role="tablist" aria-label="Activity panel tabs">
				<button
					type="button"
					role="tab"
					aria-selected={activityTab === 'activity'}
					onclick={() => (activityTab = 'activity')}
					class="cursor-pointer text-[8px] font-bold tracking-[0.22em] uppercase transition-opacity {activityTab ===
					'activity'
						? 'text-foreground opacity-90'
						: 'opacity-30 hover:opacity-60'}"
				>
					Activity
					<span class="ml-0.5 tracking-wide opacity-70">· {filteredLogs.length}</span>
				</button>
				{#if inDisplay}
					<button
						type="button"
						role="tab"
						aria-selected={activityTab === 'display'}
						onclick={() => (activityTab = 'display')}
						class="cursor-pointer text-[8px] font-bold tracking-[0.22em] uppercase transition-opacity {activityTab ===
						'display'
							? isError
								? 'text-status-error opacity-100'
								: 'text-status-info opacity-100'
							: 'opacity-30 hover:opacity-60'}"
					>
						{isError ? 'Error' : 'Display'}
					</button>
				{/if}
				<button
					type="button"
					role="tab"
					aria-selected={activityTab === 'config'}
					onclick={() => (activityTab = 'config')}
					class="cursor-pointer text-[8px] font-bold tracking-[0.22em] uppercase transition-opacity {activityTab ===
					'config'
						? 'text-foreground opacity-90'
						: 'opacity-30 hover:opacity-60'}"
				>
					Config
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activityTab === 'context'}
					onclick={() => (activityTab = 'context')}
					class="cursor-pointer text-[8px] font-bold tracking-[0.22em] uppercase transition-opacity {activityTab ===
					'context'
						? 'text-foreground opacity-90'
						: 'opacity-30 hover:opacity-60'}"
				>
					Context
				</button>
			</div>

			{#if activityTab === 'display' && inDisplay && (isError || intent.hitlVibeAppId)}
				<DisplayView {intent} />
			{:else if activityTab === 'config'}
				<ConfigView {intent} skill={selectedSkill} />
			{:else if activityTab === 'context'}
				<ContextView {intent} skill={selectedSkill} />
			{:else}
				<ActivityView logs={filteredLogs} />
			{/if}

			{#if intent.status === 'success'}
				<p class="text-[10px] leading-snug opacity-55">
					This intent completed successfully. Archive when you are done reviewing.
				</p>
			{/if}
		{:else}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-2 px-1 text-center text-sm opacity-45"
			>
				<p class="font-medium">No intent selected</p>
				<p class="max-w-xs text-xs leading-relaxed opacity-80">
					Choose an example intent on the left to preview the main panel.
				</p>
			</div>
		{/if}
	</div>
</div>
