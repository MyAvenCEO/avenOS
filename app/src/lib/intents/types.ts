/**
 * Shared types, status palette tables, and small formatting helpers for the
 * intents mock UI. Hosted as a tiny TS module so the refactored Svelte
 * components (IntentsAside, SkillsAside, MainPanel, StatusCard, …) can each
 * import the same source of truth without re-declaring constants.
 *
 * Mock data shapes (`IntentRow`, `SkillWorker`, `ActivityEntry`, etc.) and
 * the simulator helpers themselves still live inline in
 * `app/src/routes/+page.svelte` for now — this file only carries the
 * UI-layer concerns shared across the extracted components.
 */

import type { VibeViewId } from '$lib/aven-ui/vibe-views'

/** Human-in-the-loop wait, autonomous work, resolved success, archive, or terminal failure. */
export type IntentStatus = 'hitl' | 'working' | 'success' | 'archived' | 'error'

export type SkillStatus = 'waiting' | 'running' | 'error'

/**
 * Unified status key covering both intent rows and skill chips. Both render
 * with the same colored-strip + text-pane recipe; the only divergence is
 * which subset of statuses each row type can take.
 */
export type CardStatus = IntentStatus | SkillStatus

/**
 * Minimal worker-actor descriptor attached to a `SkillWorker`. Each skill
 * carries a small static list of mock workers (2–4 per skill template) so
 * activity log entries can be attributed to a specific actor and filtered
 * by it in the right aside.
 */
export type WorkerActor = {
	id: string
	name: string
}

export type SkillWorker = {
	id: string
	templateId: string
	name: string
	description: string
	status: SkillStatus
	/** Mock accumulated run time in whole seconds (`floor(ms/1000)` per finished run). */
	accumulatedSeconds: number
	/** While `status === 'running'`, wall-clock start of this run. */
	runStartedAt?: number
	/** Duration of the last finished run (ms). Shown at rest like the intent timer. */
	lastRunDurationMs?: number
	/** Mock pool of worker-actor identifiers tied to this skill instance. */
	workers?: WorkerActor[]
}

export type ActivityEntry = {
	id: string
	at: number
	skillName: string
	text: string
	/**
	 * Optional worker-actor name that authored this entry. Logs emitted by
	 * the orchestrator / operator omit this field and render without the
	 * `(worker)` token in the activity log.
	 */
	workerName?: string
}

export type IntentRow = {
	id: string
	title: string
	summary: string
	body?: string
	status: IntentStatus
	/** When `status === 'working'`, Unix ms when this work phase began. */
	workingStartedAt?: number
	/** When `status === 'working'`, random phase cap for mock completion (ms, 5–30s inclusive). */
	workingPhaseDurationMs?: number
	/** Wall-clock duration of the last completed work phase (shown when not `working`). */
	lastWorkDurationMs?: number
	skills: SkillWorker[]
	logs: ActivityEntry[]
	/**
	 * Vibe-app id chosen once when this intent first transitions into HITL,
	 * cached on the row so the embedded preview stays stable across reactive
	 * ticks until the intent leaves HITL. Cleared on resume/accept.
	 */
	hitlVibeAppId?: VibeViewId
}

export type ComposerMode = 'collapsed' | 'listening' | 'typing'

/**
 * Center-panel tab union. `activity` and `display` predate the four-tab
 * layout; `config` and `context` are always-on stubs that sit to the
 * right of the conditional Display/Error tab.
 */
export type ActivityTab = 'activity' | 'display' | 'config' | 'context'

/**
 * Nature-inspired status palette — colored 4px strokes on the card's outer
 * `<button>` left edge. Both strokes live on the same rounded element so
 * they sweep around the card's corner radius identically (an inner left
 * strip would be clipped to a flat chord by `overflow-hidden` on the
 * rounded outer card). Shared by intents and skills.
 */
export const STATUS_LEFT_FRAME: Record<CardStatus, string> = {
	hitl: 'border-l-[4px] border-l-status-info',
	waiting: 'border-l-[4px] border-l-status-info',
	working: 'border-l-[4px] border-l-status-working',
	running: 'border-l-[4px] border-l-status-working',
	success: 'border-l-[4px] border-l-status-success',
	archived: 'border-l-[4px] border-l-driftwood',
	error: 'border-l-[4px] border-l-status-error'
}

/**
 * Mirrored variant: status strip painted on the card's right edge instead of
 * the left. Used by the desktop right-aside skill cards so they feel anchored
 * to the right edge of the layout (and visually mirror the intent rows on the
 * left). Same per-status colors as `STATUS_LEFT_FRAME`.
 */
export const STATUS_RIGHT_FRAME: Record<CardStatus, string> = {
	hitl: 'border-r-[4px] border-r-status-info',
	waiting: 'border-r-[4px] border-r-status-info',
	working: 'border-r-[4px] border-r-status-working',
	running: 'border-r-[4px] border-r-status-working',
	success: 'border-r-[4px] border-r-status-success',
	archived: 'border-r-[4px] border-r-driftwood',
	error: 'border-r-[4px] border-r-status-error'
}

/**
 * Resting timer interior — eggshell card surface (`--color-surface-card` / `#F7F2E4`); status
 * read from `border-l-[4px]` + numeral color only. Matches the card text column so cost cell
 * and title pane share one surface at rest.
 */
export const STATUS_TIMER_BG_REST: Record<CardStatus, string> = {
	hitl: 'bg-surface-card',
	waiting: 'bg-surface-card',
	working: 'bg-surface-card',
	running: 'bg-surface-card',
	success: 'bg-surface-card',
	archived: 'bg-surface-card',
	error: 'bg-surface-card'
}

/** Hover fill on timer only (outer `group` on card); full semantic color, skipped when selected. */
export const STATUS_TIMER_BG_HOVER: Record<CardStatus, string> = {
	hitl: 'group-hover:bg-status-info',
	waiting: 'group-hover:bg-status-info',
	working: 'group-hover:bg-status-working',
	running: 'group-hover:bg-status-working',
	success: 'group-hover:bg-status-success',
	archived: 'group-hover:bg-driftwood',
	error: 'group-hover:bg-status-error'
}

/** Timer numerals on solid hover fill — match selected contrast (Mercury stays dark-on-light). */
export const STATUS_STRIP_TEXT_HOVER: Record<CardStatus, string> = {
	hitl: 'group-hover:text-status-info-foreground',
	waiting: 'group-hover:text-status-info-foreground',
	working: 'group-hover:text-status-working-foreground',
	running: 'group-hover:text-status-working-foreground',
	success: 'group-hover:text-status-success-foreground',
	archived: 'group-hover:text-driftwood-foreground',
	error: 'group-hover:text-status-error-foreground'
}

/** Selected: full-strength tint on timer cell only (outer card border stays neutral). */
export const STATUS_TIMER_BG_SELECTED: Record<CardStatus, string> = {
	hitl: 'bg-status-info',
	waiting: 'bg-status-info',
	working: 'bg-status-working',
	running: 'bg-status-working',
	success: 'bg-status-success',
	archived: 'bg-driftwood',
	error: 'bg-status-error'
}

/** Numerals on white — semantic ink (paired with `border-l-[4px]`). */
export const STATUS_STRIP_TEXT: Record<CardStatus, string> = {
	hitl: 'text-status-info',
	waiting: 'text-status-info',
	working: 'text-status-working',
	running: 'text-status-working',
	success: 'text-status-success',
	archived: 'text-driftwood-foreground',
	error: 'text-status-error'
}

/** Timer label contrast on filled cell (selected). */
export const STATUS_STRIP_TEXT_ON_FILL: Record<CardStatus, string> = {
	hitl: 'text-status-info-foreground',
	waiting: 'text-status-info-foreground',
	working: 'text-status-working-foreground',
	running: 'text-status-working-foreground',
	success: 'text-status-success-foreground',
	archived: 'text-driftwood-foreground',
	error: 'text-status-error-foreground'
}

export type DurationStripParts = { layout: 'single'; main: string; unit: string }

/**
 * Compact duration for the status timer strip from whole seconds.
 * <60s: stacked value + `sec`. ≥60s: whole minutes only (`floor`) + `min` — never both units.
 */
export function formatDurationStrip(totalSeconds: number): DurationStripParts {
	const s = Math.max(0, Math.floor(totalSeconds))
	if (s < 60) {
		return { layout: 'single', main: String(s), unit: 'sec' }
	}
	// Whole minutes only — stable display (no remaining seconds on the strip).
	const m = Math.floor(s / 60)
	return { layout: 'single', main: String(m), unit: 'min' }
}

/** Converts mocked wall time to whole seconds. */
export function secondsFromElapsedMs(ms: number): number {
	return Math.max(0, Math.floor(ms / 1000))
}

/** All finished runs (`accumulatedSeconds`) plus the current running slice if any. */
export function skillLiveElapsedSeconds(skill: SkillWorker, now: number): number {
	const slice =
		skill.status === 'running' && skill.runStartedAt != null
			? secondsFromElapsedMs(now - skill.runStartedAt)
			: 0
	return skill.accumulatedSeconds + slice
}

/** Intent strip total = sum of per-skill elapsed time (skills only — not orchestrator phase). */
export function intentTotalSkillElapsedSeconds(row: IntentRow, now: number): number {
	return row.skills.reduce((sum, sk) => sum + skillLiveElapsedSeconds(sk, now), 0)
}

export function statusLabel(status: IntentStatus): string {
	switch (status) {
		case 'archived':
			return 'Archived'
		case 'working':
			return 'Working'
		case 'success':
			return 'Completed successfully'
		case 'hitl':
			return 'Waiting for feedback (HITL)'
		case 'error':
			return 'Error — needs attention'
	}
}

export function skillStatusLabel(status: SkillStatus): string {
	switch (status) {
		case 'waiting':
			return 'Waiting'
		case 'running':
			return 'Running'
		case 'error':
			return 'Error'
	}
}

export function formatLogTime(ms: number): string {
	const d = new Date(ms)
	const hh = d.getHours().toString().padStart(2, '0')
	const mm = d.getMinutes().toString().padStart(2, '0')
	const ss = d.getSeconds().toString().padStart(2, '0')
	return `${hh}:${mm}:${ss}`
}
