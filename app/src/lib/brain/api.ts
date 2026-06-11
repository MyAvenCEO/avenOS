/**
 * aven-brain IPC client (plan 0018, E2) — a per-SAFE brain over the shared avenDB
 * store. Thin wrappers around the `avendb_runtime` brain ops; all calls are
 * identity-scoped (one brain per SAFE).
 */
import { avenDbRuntime } from '$lib/runtime/avendb-ipc'

export type BrainStatus = {
	ready: boolean
	embedder: 'stub' | 'gemma' | string
	embedDim: number
	memories: number
	entities: number
	links: number
}

export type BrainHit = {
	id: string
	content: string
	stream: string
	authorRole: string
	source?: string | null
	veracity?: string | null
	rank: number
	score: number
	via: 'vector' | 'bm25' | 'both'
}

export type BrainEntity = { id: string; name: string; kind: string }

export type BrainFact = {
	predicate: string
	objectName: string
	validFromMs?: number | null
	validToMs?: number | null
	confidence: number
}

export type BrainEntityCard = {
	name: string
	kind: string
	bonds: [string, number][]
	facts: BrainFact[]
	recentMemories: Array<Pick<BrainHit, 'id' | 'content' | 'stream' | 'authorRole'>>
}

export type ContextTrace = {
	query: string
	l0Self: string
	l1Gist: string[]
	working: Array<{ id: string; snippet: string; authorRole: string }>
	recalled: Array<{
		id: string
		snippet: string
		source?: string | null
		rank: number
		via: 'vector' | 'bm25' | 'both'
		score: number
	}>
	entities: Array<{ name: string; kind: string; bonds: [string, number][] }>
	budget: { usedChars: number; maxChars: number; droppedRecalled: number; droppedWorking: number }
	embedder: string
	assembledAtMs: number
}

export type ContextBundle = { prompt: string; trace: ContextTrace }

export type DreamReport = { bondsDecayed: number; entitiesMerged: number }

/** Row counts + embedder info for an identity's brain. */
export function brainStatus(identity: string): Promise<BrainStatus> {
	return avenDbRuntime('brainStatus', { identity })
}

/** Store one memory (idempotent by content hash). Returns the memory row id. */
export function brainIngest(
	identity: string,
	content: string,
	opts: {
		stream?: string
		authorRole?: string
		source?: string
		contentDateMs?: number
		veracity?: string
	} = {},
): Promise<{ id: string }> {
	return avenDbRuntime('brainIngest', { identity, content, ...opts })
}

/** Hybrid recall (RRF + modifiers + abstention floor) with per-hit via/rank/score. */
export function brainSearch(
	identity: string,
	query: string,
	k = 8,
	stream?: string,
): Promise<BrainHit[]> {
	return avenDbRuntime('brainSearch', { identity, query, k, ...(stream ? { stream } : {}) })
}

export function brainEntities(identity: string): Promise<BrainEntity[]> {
	return avenDbRuntime('brainEntities', { identity })
}

export function brainEntityCard(
	identity: string,
	name: string,
): Promise<BrainEntityCard | null> {
	return avenDbRuntime('brainEntityCard', { identity, name })
}

/** The brain as context manager: budgeted prompt + ContextTrace receipt for one turn. */
export function brainAssembleContext(
	identity: string,
	query: string,
	opts: { workingN?: number; recallK?: number; budgetChars?: number; stream?: string } = {},
): Promise<ContextBundle> {
	return avenDbRuntime('brainAssembleContext', { identity, query, ...opts })
}

/** One-shot ingest of the identity's existing message history (idempotent re-runs). */
export function brainBackfill(identity: string): Promise<{ scanned: number; ingested: number }> {
	return avenDbRuntime('brainBackfill', { identity })
}

/** Run a dreaming consolidation pass (bond decay + entity merge). */
export function brainDream(identity: string): Promise<DreamReport> {
	return avenDbRuntime('brainDream', { identity })
}
