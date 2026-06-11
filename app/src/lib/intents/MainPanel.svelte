<script lang="ts">
import { t } from '$lib/i18n'
import ActivityView from './ActivityView.svelte'
import ConfigView from './ConfigView.svelte'
import ContextView from './ContextView.svelte'
import DisplayView from './DisplayView.svelte'
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
 * needed. Skill selection on mobile lives in the skills drawer (`SkillsAside`).
 */
import type { ActivityEntry, ActivityTab, IntentRow, SkillWorker } from './types'

let {
	intent,
	selectedSkill,
	filteredLogs,
	nowMs,
	activityTab = $bindable<ActivityTab>('activity')
}: {
	intent: IntentRow | null
	selectedSkill: SkillWorker | null
	filteredLogs: ActivityEntry[]
	nowMs: number
	activityTab?: ActivityTab
} = $props()

/**
 * HITL preview is active whenever the selected intent is paused for human
 * feedback (`hitl`) OR a selected skill is in its HITL-equivalent state
 * (`waiting`) under a parent intent that is still in flight (not already
 * resolved/archived). When active, the Activity log panel is replaced by the
 * chosen aven-ui vibe view (rendered through `AvenUiView` in `DisplayView`).
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
/** Terminal success — the Display tab shows the aven-ui success screen. */
const isSuccess = $derived(intent?.status === 'success')

const inDisplay = $derived(showHitlPreview || isError || isSuccess)

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
	const intentInDisplay =
		intent.status === 'hitl' || intent.status === 'error' || intent.status === 'success'
	const key = `${intent.id}:${intentInDisplay ? 'display' : 'other'}`
	if (key === lastDisplayEdgeKey) return
	lastDisplayEdgeKey = key
	activityTab = intentInDisplay ? 'display' : 'activity'
})
</script>

<!--
	Center / main panel. Desktop spans column 2 rows 1–2. Mobile: full-width
	detail view when an intent is selected (skills live in the right drawer).
-->
<div
	class={`col-start-1 row-start-4 flex min-h-0 min-w-0 flex-1 flex-col max-sm:items-stretch max-sm:justify-start sm:col-start-2 sm:row-start-1 sm:row-end-3 ${!intent ? 'max-sm:hidden' : 'max-sm:row-start-1 max-sm:w-full'}`}
>
	<div class="flex min-h-[12rem] min-w-0 flex-1 flex-col gap-2 sm:min-h-[18rem]">
		{#if intent}
			<!--
				Tab strip: when the selected intent (or the selected skill under
				an in-flight intent) is in HITL — or the intent has terminally
				errored / succeeded — expose a second tab next to "Activity".
				Its label is "Display" for HITL, "Error" for error, "Success"
				for success. DisplayView renders the matching aven-ui vibe
				(`AvenUiView`) based on `intent.status`. When none is active,
				fall back to the static Activity label.
			-->
			<div
				class="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				role="tablist"
				aria-label={t('intents.activityPanelTabs')}
			>
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
					{t('intents.activityTab')}
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
								: isSuccess
									? 'text-status-success opacity-100'
									: 'text-status-info opacity-100'
							: 'opacity-30 hover:opacity-60'}"
					>
						{isError ? t('intents.errorTab') : isSuccess ? t('intents.successTab') : t('intents.displayTab')}
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
					{t('intents.configTab')}
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
					{t('intents.contextTab')}
				</button>
			</div>

			{#if activityTab === 'display' && inDisplay && (isError || isSuccess || intent.hitlVibeAppId)}
				<DisplayView {intent} />
			{:else if activityTab === 'config'}
				<ConfigView {intent} skill={selectedSkill} />
			{:else if activityTab === 'context'}
				<ContextView {intent} skill={selectedSkill} />
			{:else}
				<ActivityView logs={filteredLogs} />
			{/if}
		{:else}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-2 px-1 text-center text-sm opacity-45"
			>
				<p class="font-medium">{t('intents.noIntentSelected')}</p>
				<p class="max-w-xs text-xs leading-relaxed opacity-80">
					{t('intents.noIntentSelectedHint')}
				</p>
			</div>
		{/if}
	</div>
</div>
