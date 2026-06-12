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
}

/** Reactive holder for the latest dream pass's log (per identity). */
export const brainDreamLog = $state<{
	identity: string | null
	running: boolean
	entries: DreamLogEntry[]
	atMs: number
}>({ identity: null, running: false, entries: [], atMs: 0 })

export function dreamLogStart(identity: string) {
	brainDreamLog.identity = identity
	brainDreamLog.running = true
	brainDreamLog.entries = []
	brainDreamLog.atMs = Date.now()
}

export function dreamLogStep(entry: DreamLogEntry) {
	brainDreamLog.entries = [...brainDreamLog.entries, entry]
}

export function dreamLogEnd() {
	brainDreamLog.running = false
}
