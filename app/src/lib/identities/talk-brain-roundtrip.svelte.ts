/**
 * Latest brain roundtrip for the talk surface (plan 0018, E5 v1).
 *
 * One roundtrip = what happened in the brain for the LAST human message: what was
 * stored (the new memory) and what `assemble_context` recalled (L0 self · L1 gist ·
 * L2 entities · L3 search hits + inner query + budget). The same assembled bundle both
 * fills this panel AND grounds the LLM reply this turn — the panel is the receipt for
 * the context the AI actually saw.
 */
import type { ContextTrace, DreamReport } from '$lib/brain/api'

/** The dreaming consolidation pass that runs after each turn (decay, merge, heal, consolidate). */
export type DreamState = {
	phase: 'dreaming' | 'done' | 'error'
	report?: DreamReport
	error?: string
}

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
	/** The post-turn dreaming consolidation pass (decay/merge/heal), once it starts. */
	dream?: DreamState
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

/** Mark the dreaming pass for `messageId`'s roundtrip (ignored once a newer turn supersedes it). */
export function patchDream(messageId: string, dream: DreamState) {
	const cur = brainRoundtrip.latest
	if (!cur || cur.messageId !== messageId) return
	brainRoundtrip.latest = { ...cur, dream }
}
