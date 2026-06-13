/**
 * Latest brain roundtrip for the talk surface (plan 0018, E5 v1).
 *
 * One roundtrip = what happened in the brain for the LAST human message: what was
 * stored (the new memory) and what `assemble_context` recalled (L0 self · L1 gist ·
 * L2 entities · L3 search hits + inner query + budget). The same assembled bundle both
 * fills this panel AND grounds the LLM reply this turn — the panel is the receipt for
 * the context the AI actually saw.
 */
import type { ContextTrace } from '$lib/brain/api'

export type BrainRoundtrip = {
	/** Identity (SAFE) this roundtrip belongs to. */
	identity: string
	/** The human message row id that triggered it. */
	messageId: string
	/** The message text (snippet source). */
	content: string
	/** The stored memory row id (idempotent: may be a pre-existing memory). */
	memoryId?: string
	/** The display-only assemble probe result (L0–L3 + budget + embedder). */
	trace?: ContextTrace
	/** The assembled prompt VERBATIM — the 100% receipt of what the LLM saw (board 0023). */
	prompt?: string
	/** Probe error, when ingest/assemble failed (brain offline etc.). */
	error?: string
	/** Roundtrip phases: stored → recalled (or error). */
	phase: 'storing' | 'recalling' | 'done' | 'error'
	atMs: number
}

/** Reactive holder — the aside always shows `latest` (for the matching identity). */
export const brainRoundtrip = $state<{ latest: BrainRoundtrip | null }>({ latest: null })

export function beginRoundtrip(identity: string, messageId: string, content: string) {
	brainRoundtrip.latest = {
		identity,
		messageId,
		content,
		phase: 'storing',
		atMs: Date.now()
	}
}

export function patchRoundtrip(messageId: string, patch: Partial<BrainRoundtrip>) {
	const cur = brainRoundtrip.latest
	if (!cur || cur.messageId !== messageId) return
	brainRoundtrip.latest = { ...cur, ...patch }
}

// ───────────────────────────── dreaming log ─────────────────────────────
//
// A real-time, top-to-bottom log of the STEPPED dream pass (one entry per phase: enrich · merge ·
// decay · verify · consolidate). Surfaced in the brain aside's "Dreaming" tab so the consolidation
// is transparent — what it loaded/merged/processed, how long, and (reserved) token cost per step.

/** One logged dream step. */
export type DreamLogEntry = {
	phase: string
	label: string
	count: number
	/** LLM tokens for this step — 0 for the deterministic phases (reserved for LLM enrichment). */
	tokens: number
	/** Wall-clock ms this step took (round-trip). */
	ms: number
	/** Entities this step typed (the extract phase) — clickable cards in the log. */
	entities?: { name: string; kind: string }[]
}

/** Reactive holder for the latest dream pass's log (per identity). */
export const brainDreamLog = $state<{
	identity: string | null
	running: boolean
	entries: DreamLogEntry[]
	atMs: number
}>({ identity: null, running: false, entries: [], atMs: 0 })

/** Newest entries to keep in the continuous log (older ones roll off). */
const DREAM_LOG_MAX = 200

export function dreamLogStart(identity: string) {
	// Continuous activity: keep the log across turns; only wipe when the IDENTITY changes (a
	// different brain). The dream is ongoing upkeep, not a per-message event.
	if (brainDreamLog.identity !== identity) {
		brainDreamLog.identity = identity
		brainDreamLog.entries = []
	}
	brainDreamLog.running = true
	brainDreamLog.atMs = Date.now()
}

export function dreamLogStep(entry: DreamLogEntry) {
	const next = [...brainDreamLog.entries, entry]
	brainDreamLog.entries =
		next.length > DREAM_LOG_MAX ? next.slice(next.length - DREAM_LOG_MAX) : next
}

export function dreamLogEnd() {
	brainDreamLog.running = false
}

// ───────────────────────────── activity log ─────────────────────────────
//
// A transparent, live timeline of THIS turn's pipeline — store → recall → each LLM round →
// each tool call → respond — with per-step wall-clock timing. Surfaced in the brain aside's
// primary "Activity" tab so the 30s "thinking" gap is explained step by step (which recall
// was slow, how many model rounds ran, which tools fired) instead of an opaque spinner.

export type ActivityKind = 'store' | 'recall' | 'llm' | 'tool' | 'respond' | 'error' | 'info'

/** One step in the turn pipeline. `ms` is filled when the step finishes. */
export type ActivityStep = {
	id: number
	kind: ActivityKind
	label: string
	detail?: string
	status: 'running' | 'done' | 'error'
	startMs: number
	ms?: number
}

/** Reactive holder for the current turn's activity (per identity). */
export const brainActivity = $state<{
	identity: string | null
	steps: ActivityStep[]
	running: boolean
	atMs: number
}>({ identity: null, steps: [], running: false, atMs: 0 })

let activitySeq = 0

/** Begin a fresh turn timeline (clears the prior turn's steps). */
export function activityStart(identity: string) {
	brainActivity.identity = identity
	brainActivity.steps = []
	brainActivity.running = true
	brainActivity.atMs = Date.now()
}

/** Push a running step; returns its id to finish later. */
export function activityBegin(kind: ActivityKind, label: string, detail?: string): number {
	const id = ++activitySeq
	brainActivity.steps = [
		...brainActivity.steps,
		{ id, kind, label, detail, status: 'running', startMs: Date.now() }
	]
	return id
}

/** Finish a step: stamp its duration + optional final detail/label/status. */
export function activityFinish(
	id: number,
	patch?: { detail?: string; label?: string; status?: 'done' | 'error' }
) {
	brainActivity.steps = brainActivity.steps.map((s) =>
		s.id === id
			? {
					...s,
					status: patch?.status ?? 'done',
					ms: Date.now() - s.startMs,
					detail: patch?.detail ?? s.detail,
					label: patch?.label ?? s.label
				}
			: s
	)
}

export function activityEnd() {
	brainActivity.running = false
}
