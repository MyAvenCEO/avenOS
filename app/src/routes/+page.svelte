<script lang="ts">
import { HITL_VIEW_IDS, type VibeViewId } from '$lib/aven-ui/vibe-views'
import { persistIntentFiles } from '$lib/avendb/intent-files'
import { pendingIntentFileDrop } from '$lib/intents/global-file-drop'
import HitlActionBar from '$lib/intents/HitlActionBar.svelte'
import IntentsAside from '$lib/intents/IntentsAside.svelte'
import MainPanel from '$lib/intents/MainPanel.svelte'
import SkillsAside from '$lib/intents/SkillsAside.svelte'
import {
	type ActivityEntry,
	type ActivityTab,
	type ComposerMode,
	type IntentRow,
	type IntentStatus,
	type SkillStatus,
	type SkillWorker,
	secondsFromElapsedMs,
	type WorkerActor
} from '$lib/intents/types'
import {
	contentMaxWidthClass,
	mobileActionVeilClass,
	mobileFabBottomClass,
	mobileMainBottomPadClass
} from '$lib/shell'
import {
	clearMobileChromeOverrides,
	setMobileChromeOverrides
} from '$lib/shell/mobile-chrome.svelte'

/**
 * Random pick from `HITL_VIEW_IDS` (the aven-ui view catalog). Caller stores
 * the result on `intent.hitlVibeAppId` so subsequent renders inside the same
 * HITL session don't reshuffle the view.
 */
function pickRandomHitlVibeAppId(): VibeViewId {
	return HITL_VIEW_IDS[Math.floor(Math.random() * HITL_VIEW_IDS.length)]
}

type IntentSeed = Pick<IntentRow, 'id' | 'title' | 'summary'> & { body?: string }

type SkillTemplate = {
	id: string
	name: string
	descriptions: string[]
	actions: string[]
	/** Static mock pool of worker-actor names tied to this skill template. */
	workers: string[]
}

/** When a working phase ends, probability of transitioning to `hitl` vs `error` (mock). */
const WORKING_PHASE_HITL_WEIGHT = 0.5

const SKILL_POOL: SkillTemplate[] = [
	{
		id: 'parser',
		name: 'Document Parser',
		descriptions: [
			'Extracting structured data from PDF',
			'Reading line items from scanned doc',
			'Detecting fields and totals'
		],
		actions: [
			'Parsed page 1/3',
			'Parsed page 2/3',
			'Detected vendor block',
			'Extracted 14 line items',
			'Computed subtotal: 4,210.00 EUR',
			'Found tax block on page 2'
		],
		workers: ['pdf-extractor', 'ocr-worker', 'field-detector']
	},
	{
		id: 'classifier',
		name: 'Tax Classifier',
		descriptions: ['Determining tax category and rate', 'Mapping line items to VAT codes'],
		actions: [
			'Loaded VAT ruleset DE-2026',
			'Mapped item #4 → 7% reduced',
			'Mapped item #11 → 19% standard',
			'Confidence below 0.8 on item #9'
		],
		workers: ['rule-engine', 'confidence-scorer']
	},
	{
		id: 'vendor',
		name: 'Vendor Matcher',
		descriptions: ['Matching against vendor database', 'Resolving payee details'],
		actions: [
			'Searched 1,243 vendors',
			'Matched "ACME GmbH" (score 0.94)',
			'Updated vendor IBAN cache',
			'No exact IBAN match — flagged'
		],
		workers: ['db-matcher', 'iban-resolver', 'cache-updater']
	},
	{
		id: 'router',
		name: 'Approval Router',
		descriptions: ['Routing to authorized approver', 'Selecting policy chain'],
		actions: [
			'Policy "EU > 1k EUR" matched',
			'Selected approver: finance-lead',
			'Awaiting approver acknowledgement'
		],
		workers: ['senior-approver', 'policy-engine', 'audit-logger']
	},
	{
		id: 'ledger',
		name: 'Bookkeeper',
		descriptions: ['Posting to general ledger', 'Reconciling against bank feed'],
		actions: [
			'Drafted journal entry #JE-1041',
			'Reconciled vs. bank txn 0xa12…',
			'Variance 0.00 EUR — clean'
		],
		workers: ['journal-poster', 'reconciler']
	},
	{
		id: 'audit',
		name: 'Audit Logger',
		descriptions: ['Recording compliance trail', 'Capturing decision provenance'],
		actions: [
			'Captured tool call: parser.run',
			'Captured tool call: classifier.run',
			'Persisted decision graph (3 nodes)'
		],
		workers: ['compliance-tracker', 'graph-persister', 'event-recorder']
	},
	{
		id: 'notifier',
		name: 'Notifier',
		descriptions: ['Sending stakeholder updates', 'Posting to Slack channel'],
		actions: ['Drafted Slack message', 'Sent to #finance-ops', 'Email queued for vendor'],
		workers: ['slack-poster', 'email-sender', 'channel-dispatcher']
	}
]

function mockSkillRestDurationMs(): number {
	return Math.max(1000, Math.round(500 + Math.random() * 7500))
}

/** Inclusive mock working phase length (wall clock), aligned with ticker completion. */
function randomWorkingPhaseMs(): number {
	return 5000 + Math.floor(Math.random() * 25001)
}

function mockSkillRunStartOffsetMs(): number {
	return Math.floor(Math.random() * 4000)
}

/** When status is `waiting`, optionally show a completed-run duration (replaces former `done`). */
function seedWaitingLastRun(intentStatus: IntentStatus, status: SkillStatus): number | undefined {
	if (status !== 'waiting') return undefined
	switch (intentStatus) {
		case 'archived':
			return mockSkillRestDurationMs()
		case 'success':
			return mockSkillRestDurationMs()
		case 'hitl':
			return Math.random() < 0.7 ? mockSkillRestDurationMs() : undefined
		case 'error':
			return mockSkillRestDurationMs()
		case 'working':
			return Math.random() < 35 / 52 ? mockSkillRestDurationMs() : undefined
	}
}

function pickSkillStatus(intentStatus: IntentStatus): SkillStatus {
	if (intentStatus === 'archived') return 'waiting'
	if (intentStatus === 'success') return 'waiting'
	if (intentStatus === 'error') return Math.random() < 0.5 ? 'error' : 'waiting'
	if (intentStatus === 'hitl') return Math.random() < 0.7 ? 'waiting' : 'running'
	const r = Math.random()
	if (r < 0.35) return 'waiting'
	if (r < 0.75) return 'running'
	if (r < 0.92) return 'waiting'
	return 'error'
}

function workersForTemplate(tpl: SkillTemplate, skillInstanceId: string): WorkerActor[] {
	return tpl.workers.map((name) => ({
		id: `${skillInstanceId}::${name}`,
		name
	}))
}

function pickSkillsForIntent(intentStatus: IntentStatus): SkillWorker[] {
	const count = 2 + Math.floor(Math.random() * 4)
	const shuffled = [...SKILL_POOL].sort(() => Math.random() - 0.5).slice(0, count)
	const now = Date.now()
	return shuffled.map((tpl) => {
		const status = pickSkillStatus(intentStatus)
		const lastRun = seedWaitingLastRun(intentStatus, status)
		const skillInstanceId = `${tpl.id}-${Math.random().toString(36).slice(2, 7)}`
		const base: SkillWorker = {
			id: skillInstanceId,
			templateId: tpl.id,
			name: tpl.name,
			description: tpl.descriptions[Math.floor(Math.random() * tpl.descriptions.length)],
			status,
			accumulatedSeconds: lastRun != null ? secondsFromElapsedMs(lastRun) : 0,
			workers: workersForTemplate(tpl, skillInstanceId),
			...(lastRun != null ? { lastRunDurationMs: lastRun } : {})
		}
		return attachSkillRunTimers(base, now)
	})
}

function attachSkillRunTimers(skill: SkillWorker, now: number): SkillWorker {
	if (skill.status === 'running') {
		return {
			...skill,
			runStartedAt: now - mockSkillRunStartOffsetMs(),
			lastRunDurationMs: undefined
		}
	}
	if (skill.status === 'error') {
		const last = Math.max(1000, Math.round(500 + Math.random() * 7500))
		return {
			...skill,
			runStartedAt: undefined,
			lastRunDurationMs: last,
			accumulatedSeconds: secondsFromElapsedMs(last)
		}
	}
	return {
		...skill,
		runStartedAt: undefined,
		lastRunDurationMs: skill.lastRunDurationMs
	}
}

function pickWorkerName(skill: SkillWorker): string | undefined {
	const pool = skill.workers
	if (!pool || pool.length === 0) return undefined
	return pool[Math.floor(Math.random() * pool.length)].name
}

function makeLog(skill: SkillWorker, at: number): ActivityEntry {
	const tpl = SKILL_POOL.find((s) => s.id === skill.templateId)
	const action = tpl
		? tpl.actions[Math.floor(Math.random() * tpl.actions.length)]
		: 'Step completed'
	const workerName = pickWorkerName(skill)
	return {
		id: `log-${at}-${Math.random().toString(36).slice(2, 7)}`,
		at,
		skillName: skill.name,
		text: action,
		...(workerName ? { workerName } : {})
	}
}

function seedLogs(skills: SkillWorker[], baseTime: number): ActivityEntry[] {
	const active = skills.filter(
		(s) =>
			s.status === 'running' ||
			s.status === 'error' ||
			(s.status === 'waiting' && s.lastRunDurationMs != null)
	)
	if (active.length === 0) return []
	const count = 4 + Math.floor(Math.random() * 8)
	const logs: ActivityEntry[] = []
	for (let i = 0; i < count; i++) {
		const skill = active[Math.floor(Math.random() * active.length)]
		const at = baseTime - (count - i) * (700 + Math.random() * 2300)
		logs.push(makeLog(skill, at))
	}
	return logs.sort((a, b) => a.at - b.at)
}

const MAX_LOGS_PER_INTENT = 60

const MOCK_SEEDS: IntentSeed[] = [
	{
		id: 'invoice',
		title: 'Ingested a new invoice',
		summary: 'Example — vendor PDF received and queued for review.'
	},
	{
		id: 'bank',
		title: 'Ingested a bank statement',
		summary: 'Example — MT940 / CSV parsed for bookkeeping.'
	}
]

/** Mock duration for a completed work phase (always ≥1s so display is never empty). */
function mockCompletedPhaseMs(): number {
	return Math.round((1 + Math.random() * 24) * 1000)
}

function seedRow(seed: IntentSeed): IntentRow {
	const now = Date.now()
	const phaseMs = randomWorkingPhaseMs()
	const skills = pickSkillsForIntent('working')
	const row: IntentRow = {
		...seed,
		status: 'working',
		workingStartedAt: now,
		workingPhaseDurationMs: phaseMs,
		skills,
		logs: seedLogs(skills, now)
	}
	return row
}

let mockIntents = $state<IntentRow[]>(MOCK_SEEDS.map(seedRow))
let savedIntents = $state<IntentRow[]>([])

let selectedId = $state<string | null>(null)
let selectedSkillId = $state<string | null>(null)

/**
 * Currently selected worker actor name under the selected skill (or `null`).
 * When set, the activity log applies an additional filter to entries whose
 * `workerName` matches. Cleared automatically whenever `selectedSkillId`
 * changes via the effect below.
 */
let selectedWorkerName = $state<string | null>(null)

$effect(() => {
	// Reading `selectedSkillId` registers it as a reactive dependency so this
	// effect re-runs (including on clear → null) and resets the worker filter.
	void selectedSkillId
	selectedWorkerName = null
})

/**
 * Right-column tab in the Activity panel. Auto-switches to `display`
 * when the selected intent enters HITL (vibe-view sandbox shown in place of
 * the activity log), back to `activity` otherwise. Owned here so other
 * surfaces could observe it; the auto-switch effect lives in `MainPanel`.
 */
let activityTab = $state<ActivityTab>('activity')
let mobileSkillsOpen = $state(false)
let composerMode = $state<ComposerMode>('collapsed')

let hitlActionBarRef = $state<{ ingestDroppedFiles(files: File[] | FileList): void } | null>(null)

/** Mirror of global `pendingIntentFileDrop` so Svelte effects react to updates. */
let pendingDrop = $state<File[] | null>(null)

$effect(() => {
	const unsub = pendingIntentFileDrop.subscribe((v) => {
		pendingDrop = v
	})
	return unsub
})

$effect(() => {
	const files = pendingDrop
	if (!files?.length || !hitlActionBarRef) return
	hitlActionBarRef.ingestDroppedFiles(files)
	pendingIntentFileDrop.set(null)
})

const STATUS_SORT: Record<IntentStatus, number> = {
	error: 0,
	hitl: 1,
	working: 2,
	success: 3,
	archived: 4
}

const allIntents = $derived(
	[...savedIntents, ...mockIntents].sort(
		(a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || b.id.localeCompare(a.id)
	)
)
const activeIntents = $derived(allIntents.filter((i) => i.status !== 'archived'))
const archivedIntents = $derived(allIntents.filter((i) => i.status === 'archived'))

let archivedOpen = $state(false)

const selectedIntent = $derived(allIntents.find((i) => i.id === selectedId) ?? null)

$effect(() => {
	const typing = composerMode === 'typing'
	setMobileChromeOverrides({
		hideProfile: typing || !!(selectedId && selectedIntent && selectedIntent.skills.length > 0)
	})
	return () => clearMobileChromeOverrides()
})

const filteredLogs = $derived.by(() => {
	if (!selectedIntent) return []
	let logs = selectedIntent.logs
	if (selectedSkillId) {
		const skill = selectedIntent.skills.find((s) => s.id === selectedSkillId)
		if (skill) logs = logs.filter((l) => l.skillName === skill.name)
	}
	if (selectedWorkerName) {
		logs = logs.filter((l) => l.workerName === selectedWorkerName)
	}
	return logs.slice(-30)
})

/**
 * The currently selected skill instance (if any), used by the right aside
 * Workers group to render the skill's worker list and look up its name when
 * filtering activity log entries.
 */
const selectedSkillWorkers = $derived<WorkerActor[]>(
	selectedIntent && selectedSkillId
		? (selectedIntent.skills.find((s) => s.id === selectedSkillId)?.workers ?? [])
		: []
)

/** Currently selected skill chip (or `null`). Used for the HITL preview trigger. */
const selectedSkill = $derived(selectedIntent?.skills.find((s) => s.id === selectedSkillId) ?? null)

/**
 * Skills rendered in the skills lists (desktop right aside and mobile inline
 * scroller). When a skill is selected, collapse the list to just that skill —
 * the ALL chip above the list deselects and restores the full set. When no
 * skill is selected, render the intent's full skills array unchanged.
 */
const displayedSkills = $derived(
	selectedIntent
		? selectedSkillId
			? selectedIntent.skills.filter((s) => s.id === selectedSkillId)
			: selectedIntent.skills
		: []
)

/**
 * Mirrors the HITL preview gate inside `MainPanel` so the safety-net effect
 * below knows when to lazily assign a vibe-app id. The component-side derived
 * value is the source of truth for the tab UI; this duplicate exists only
 * because the effect needs to write back into parent state (`mockIntents` /
 * `savedIntents`).
 */
const showHitlPreview = $derived.by(() => {
	if (selectedIntent?.status === 'hitl') return true
	if (
		selectedSkill?.status === 'waiting' &&
		selectedIntent != null &&
		selectedIntent.status !== 'success' &&
		selectedIntent.status !== 'archived'
	)
		return true
	return false
})

/**
 * Safety net: if the HITL preview should be on but the selected intent lacks
 * a cached pick (e.g. a seed row that started in HITL, or a skill-only HITL
 * trigger), assign one once and cache it on the intent so the iframe stays
 * stable across reactive ticks. Keyed on `(intent.id, intent.status)` via
 * the `hitlVibeAppId` slot itself — we never re-roll while it is set.
 */
$effect(() => {
	if (!showHitlPreview) return
	if (!selectedIntent) return
	if (selectedIntent.hitlVibeAppId) return
	const id = selectedIntent.id
	const pick = pickRandomHitlVibeAppId()
	const patch = (rows: IntentRow[]) =>
		rows.map((r) => (r.id === id && !r.hitlVibeAppId ? { ...r, hitlVibeAppId: pick } : r))
	mockIntents = patch(mockIntents)
	savedIntents = patch(savedIntents)
})

function alignSkillsWithParentAfterWorking(
	skills: SkillWorker[],
	parent: 'hitl' | 'error',
	now: number
): SkillWorker[] {
	const frozen = skills.map((s) => {
		if (s.status === 'running' && s.runStartedAt != null) {
			const ran = Math.max(0, now - s.runStartedAt)
			const finalMs = ran < 1000 ? mockCompletedPhaseMs() : ran
			const add = secondsFromElapsedMs(finalMs)
			return {
				...s,
				status: 'waiting' as const,
				runStartedAt: undefined,
				lastRunDurationMs: finalMs,
				accumulatedSeconds: s.accumulatedSeconds + add
			}
		}
		return { ...s }
	})
	return frozen.map((s) => {
		const st = pickSkillStatus(parent)
		const lastRun = seedWaitingLastRun(parent, st)
		const base: SkillWorker = {
			...s,
			status: st,
			runStartedAt: undefined,
			lastRunDurationMs: lastRun
		}
		return attachSkillRunTimers(base, now)
	})
}

/** When simulated work phase reaches its cap: move to hitl OR error with configured split. */
function completeWorkingPhaseIfDue(rows: IntentRow[], now: number): IntentRow[] {
	return rows.map((row) => {
		if (row.status !== 'working') return row
		if (row.workingStartedAt == null || row.workingPhaseDurationMs == null) return row
		const elapsed = now - row.workingStartedAt
		if (elapsed < row.workingPhaseDurationMs) return row
		const phaseActual = Math.max(0, elapsed)
		const next: 'hitl' | 'error' = Math.random() < WORKING_PHASE_HITL_WEIGHT ? 'hitl' : 'error'
		const nextSkills = alignSkillsWithParentAfterWorking(row.skills, next, now)
		const haltLog: ActivityEntry = {
			id: `log-${now}-stop-${Math.random().toString(36).slice(2, 6)}`,
			at: now,
			skillName: 'orchestrator',
			text:
				next === 'hitl'
					? '⏸ Pausing — awaiting human feedback'
					: '⚠ Automation stopped — intent error'
		}
		return {
			...row,
			status: next,
			skills: nextSkills,
			workingStartedAt: undefined,
			workingPhaseDurationMs: undefined,
			lastWorkDurationMs:
				phaseActual >= 1000 ? phaseActual : (row.lastWorkDurationMs ?? mockCompletedPhaseMs()),
			logs: [...row.logs, haltLog].slice(-MAX_LOGS_PER_INTENT)
		}
	})
}

function appendLogsForWorking(rows: IntentRow[], now: number): IntentRow[] {
	return rows.map((row) => {
		if (row.status !== 'working') return row
		const running = row.skills.filter((s) => s.status === 'running')
		if (running.length === 0) return row
		const newLogs: ActivityEntry[] = []
		for (const skill of running) {
			if (Math.random() < 0.18) {
				newLogs.push(makeLog(skill, now - Math.floor(Math.random() * 200)))
			}
		}
		if (newLogs.length === 0) return row
		const merged = [...row.logs, ...newLogs].slice(-MAX_LOGS_PER_INTENT)
		return { ...row, logs: merged }
	})
}

let nowMs = $state(Date.now())

$effect(() => {
	const id = setInterval(() => {
		const now = Date.now()
		nowMs = now
		mockIntents = appendLogsForWorking(completeWorkingPhaseIfDue(mockIntents, now), now)
		savedIntents = appendLogsForWorking(completeWorkingPhaseIfDue(savedIntents, now), now)
	}, 250)
	return () => clearInterval(id)
})

function finalizeSkillsForPausedIntent(skills: SkillWorker[], now: number): SkillWorker[] {
	return skills.map((s) => {
		if (s.status === 'running' && s.runStartedAt != null) {
			const ran = Math.max(0, now - s.runStartedAt)
			const finalMs = ran < 1000 ? mockCompletedPhaseMs() : ran
			return {
				...s,
				status: 'waiting' as const,
				runStartedAt: undefined,
				lastRunDurationMs: finalMs,
				accumulatedSeconds: s.accumulatedSeconds + secondsFromElapsedMs(finalMs)
			}
		}
		return {
			...s,
			status: 'waiting' as const,
			runStartedAt: undefined,
			lastRunDurationMs: s.lastRunDurationMs ?? mockCompletedPhaseMs()
		}
	})
}

function markArchived(id: string) {
	const now = Date.now()
	const patch = (rows: IntentRow[]) =>
		rows.map((r) => {
			if (r.id !== id) return r
			let lastDur: number | undefined
			if (r.status === 'working' && r.workingStartedAt != null) {
				lastDur = Math.max(0, now - r.workingStartedAt)
			} else {
				lastDur = r.lastWorkDurationMs
			}
			if (lastDur == null || lastDur < 1000) {
				lastDur = mockCompletedPhaseMs()
			}
			const finishedSkills = finalizeSkillsForPausedIntent(r.skills, now)
			const archivedLog: ActivityEntry = {
				id: `log-${now}-arch-${Math.random().toString(36).slice(2, 6)}`,
				at: now,
				skillName: 'orchestrator',
				text: '✓ Intent archived'
			}
			return {
				...r,
				status: 'archived' as const,
				workingStartedAt: undefined,
				workingPhaseDurationMs: undefined,
				lastWorkDurationMs: lastDur,
				skills: finishedSkills,
				logs: [...r.logs, archivedLog].slice(-MAX_LOGS_PER_INTENT),
				hitlVibeAppId: undefined
			}
		})
	mockIntents = patch(mockIntents)
	savedIntents = patch(savedIntents)
}

/** Accept / resolve — intent completes successfully (Lunar Green) until archived. */
function acceptIntentSuccess(id: string) {
	const now = Date.now()
	const patch = (rows: IntentRow[]) =>
		rows.map((r) => {
			if (r.id !== id) return r
			let lastDur: number | undefined
			if (r.status === 'working' && r.workingStartedAt != null) {
				lastDur = Math.max(0, now - r.workingStartedAt)
			} else {
				lastDur = r.lastWorkDurationMs
			}
			if (lastDur == null || lastDur < 1000) {
				lastDur = mockCompletedPhaseMs()
			}
			const skills = finalizeSkillsForPausedIntent(r.skills, now)
			const okLog: ActivityEntry = {
				id: `log-${now}-ok-${Math.random().toString(36).slice(2, 6)}`,
				at: now,
				skillName: 'orchestrator',
				text: '✓ Intent completed — awaiting archive'
			}
			return {
				...r,
				status: 'success' as const,
				workingStartedAt: undefined,
				workingPhaseDurationMs: undefined,
				lastWorkDurationMs: lastDur,
				skills,
				logs: [...r.logs, okLog].slice(-MAX_LOGS_PER_INTENT),
				hitlVibeAppId: undefined
			}
		})
	mockIntents = patch(mockIntents)
	savedIntents = patch(savedIntents)
}

/** Re-train — resume mock working phase / reset HITL timers. */
function declineResumeWorkingPhase(id: string) {
	const now = Date.now()
	const phaseMs = randomWorkingPhaseMs()
	const patch = (rows: IntentRow[]) =>
		rows.map((r) => {
			if (r.id !== id) return r
			const resumedSkills = r.skills.map((s) => {
				const st = pickSkillStatus('working')
				const cleared: SkillWorker = {
					...s,
					status: st,
					runStartedAt: undefined,
					lastRunDurationMs: undefined
				}
				return attachSkillRunTimers(cleared, now)
			})
			const resumeLog: ActivityEntry = {
				id: `log-${now}-resume-${Math.random().toString(36).slice(2, 6)}`,
				at: now,
				skillName: 'orchestrator',
				text: '▶ Resuming — running skills again'
			}
			return {
				...r,
				status: 'working' as const,
				workingStartedAt: now,
				workingPhaseDurationMs: phaseMs,
				lastWorkDurationMs: undefined,
				skills: resumedSkills,
				logs: [...r.logs, resumeLog].slice(-MAX_LOGS_PER_INTENT),
				hitlVibeAppId: undefined
			}
		})
	mockIntents = patch(mockIntents)
	savedIntents = patch(savedIntents)
}

function intentRowFromMessage(text: string): IntentRow {
	const t = text.trim()
	const lines = t.split(/\n/)
	const first = (lines[0] ?? '').trim()
	const title = first.length > 56 ? `${first.slice(0, 56).trimEnd()}…` : first || '…'

	let summary = ''
	if (lines.length > 1) {
		const rest = lines.slice(1).join('\n').trim()
		summary = rest.length > 96 ? `${rest.slice(0, 96)}…` : rest
	} else if (first.length > 56) {
		const tail = first.slice(56).trim()
		summary = tail.length > 96 ? `${tail.slice(0, 96)}…` : tail || '…'
	} else if (t.length > first.length) {
		const tail = t.slice(first.length).trim()
		summary = tail.length > 96 ? `${tail.slice(0, 96)}…` : tail
	}
	if (!summary) summary = 'From composer'

	const now = Date.now()
	const phaseMs = randomWorkingPhaseMs()
	const skills = pickSkillsForIntent('working')
	const row: IntentRow = {
		id: `user-${now}-${Math.random().toString(36).slice(2, 9)}`,
		title,
		summary,
		body: t,
		status: 'working',
		workingStartedAt: now,
		workingPhaseDurationMs: phaseMs,
		skills,
		logs: seedLogs(skills, now)
	}
	return row
}

async function handleComposerSubmit(message: string, files: File[]) {
	const row = intentRowFromMessage(message)
	savedIntents = [row, ...savedIntents]
	selectedId = row.id
	const { stored, errors } = await persistIntentFiles(row.id, files)
	if (errors.length) console.warn('[intent files]', errors.join('; '))
	if (stored > 0) console.info(`[intent files] stored ${stored} file(s) in avenDB`)
}

/**
 * Fires when the composer submits while the `retrain` slash-command badge
 * is active. Append a synthetic operator log entry (when feedback text is
 * present) so the mock activity log captures the human-provided context,
 * then trigger the same mock resume flow the direct button used to invoke.
 */
async function handleRetrainCommand(feedback: string, files: File[]) {
	const intent = selectedIntent
	if (!intent) return
	const trimmed = feedback.trim()
	console.log('[mock] Re-trained with feedback:', trimmed)
	if (trimmed) {
		const now = Date.now()
		const log: ActivityEntry = {
			id: `log-${now}-op-${Math.random().toString(36).slice(2, 6)}`,
			at: now,
			skillName: 'operator',
			text: `Re-trained with feedback: "${trimmed}"`
		}
		const patch = (rows: IntentRow[]) =>
			rows.map((r) =>
				r.id === intent.id ? { ...r, logs: [...r.logs, log].slice(-MAX_LOGS_PER_INTENT) } : r
			)
		mockIntents = patch(mockIntents)
		savedIntents = patch(savedIntents)
	}
	const { errors } = await persistIntentFiles(intent.id, files)
	if (errors.length) console.warn('[intent files]', errors.join('; '))
	declineResumeWorkingPhase(intent.id)
}

function selectIntent(id: string) {
	selectedId = id
	selectedSkillId = null
	mobileSkillsOpen = false
	const intent = allIntents.find((i) => i.id === id)
	if (intent && intent.status !== 'archived') {
		archivedOpen = false
	} else if (intent?.status === 'archived' && !archivedOpen) {
		archivedOpen = true
	}
}

function backToMasterList() {
	selectedId = null
	selectedSkillId = null
	mobileSkillsOpen = false
}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
		rel="stylesheet"
	>
	<title>Intents mock — @AvenOS/app</title>
</svelte:head>

<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
	<main
		class={`${contentMaxWidthClass} flex min-h-0 flex-1 flex-col px-3 ${mobileMainBottomPadClass} sm:px-5 sm:pb-28 ${selectedId ? 'max-sm:px-3' : ''}`}
	>
		<div
			class="grid min-h-0 flex-1 grid-cols-1 gap-x-3 gap-y-1 max-sm:pt-0 max-sm:pb-0 pt-1 pb-1 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col sm:grid-cols-[13rem_minmax(0,1fr)_13rem] sm:grid-rows-[auto_minmax(0,1fr)] sm:items-stretch"
		>
			<IntentsAside
				{activeIntents}
				{archivedIntents}
				{selectedId}
				bind:archivedOpen
				{nowMs}
				onSelect={selectIntent}
			/>

			<MainPanel intent={selectedIntent} {selectedSkill} {filteredLogs} {nowMs} bind:activityTab />

			<SkillsAside
				intent={selectedIntent}
				{displayedSkills}
				workers={selectedSkillWorkers}
				{selectedSkillId}
				{selectedWorkerName}
				{nowMs}
				bind:mobileOpen={mobileSkillsOpen}
				onSelectSkill={(id) => (selectedSkillId = id)}
				onSelectWorker={(name) => (selectedWorkerName = name)}
			/>
		</div>
	</main>

	<!-- Bottom composer + mobile nav FABs -->
	<div
		class={`pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center px-3 ${mobileActionVeilClass} sm:px-5 sm:pt-3 sm:pb-5`}
	>
		<div
			class={`pointer-events-auto relative flex w-full items-center ${contentMaxWidthClass} sm:pl-0 sm:pr-0 ${composerMode === 'typing' ? 'max-sm:px-1' : 'max-sm:pl-14 max-sm:pr-14'}`}
		>
			<HitlActionBar
				bind:this={hitlActionBarRef}
				bind:composerMode
				intent={selectedIntent}
				onSubmitMessage={handleComposerSubmit}
				onRetrain={handleRetrainCommand}
				onArchive={() => selectedIntent && markArchived(selectedIntent.id)}
				onAccept={() => selectedIntent && acceptIntentSuccess(selectedIntent.id)}
			/>
		</div>
	</div>

	{#if selectedId && composerMode !== 'typing'}
		<button
			type="button"
			class="border-border bg-background/95 text-foreground hover:bg-background fixed z-[46] inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-colors max-sm:left-3 {mobileFabBottomClass} sm:hidden"
			onclick={backToMasterList}
			aria-label="Back to intents list"
		>
			<svg
				viewBox="0 0 24 24"
				class="size-4 shrink-0 opacity-80"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="m15 18-6-6 6-6" />
			</svg>
		</button>
	{/if}

	{#if selectedId && selectedIntent && selectedIntent.skills.length > 0 && composerMode !== 'typing'}
		<button
			type="button"
			class="border-border bg-background/95 text-foreground hover:bg-background fixed z-[46] inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-colors max-sm:right-3 {mobileFabBottomClass} sm:hidden"
			onclick={() => (mobileSkillsOpen = !mobileSkillsOpen)}
			aria-expanded={mobileSkillsOpen}
			aria-label={mobileSkillsOpen ? 'Close skills panel' : 'Open skills panel'}
		>
			<svg
				viewBox="0 0 24 24"
				class="size-4 shrink-0 opacity-80"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
	{/if}
</div>
