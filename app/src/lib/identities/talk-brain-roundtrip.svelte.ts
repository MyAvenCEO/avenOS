/**
 * Latest brain roundtrip for the talk surface (plan 0018, E5 v1).
 *
 * One roundtrip = what happened in the brain for the LAST human message: what was
 * stored (the new memory) and what a display-only `assemble_context` probe recalled
 * (L0 self · L1 gist · L2 entities · L3 search hits + inner query + budget). The
 * probe feeds ONLY this panel — nothing is sent to any LLM (auto-assemble is parked
 * pending the talk-UX rethink).
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
