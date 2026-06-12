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
	/** Salience 0..1 chosen at write (0.5 = neutral). */
	importance: number
	rank: number
	score: number
	via: 'vector' | 'bm25' | 'graph' | 'both'
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
		via: 'vector' | 'bm25' | 'graph' | 'both'
		score: number
	}>
	entities: Array<{ name: string; kind: string; bonds: [string, number][] }>
	budget: { usedChars: number; maxChars: number; droppedRecalled: number; droppedWorking: number }
	embedder: string
	assembledAtMs: number
}

export type ContextBundle = { prompt: string; trace: ContextTrace }

export type DreamReport = {
	bondsDecayed: number
	entitiesMerged: number
	/** Typed facts mined by the configured extractor (board 0024). */
	factsExtracted: number
	claimsDeduped: number
	claimsContradicted: number
	memoriesConsolidated: number
	summariesWritten: number
}

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
		/** Salience 0..1 chosen at write (default 0.5 = neutral) — board 0025. */
		importance?: number
	} = {}
): Promise<{ id: string }> {
	return avenDbRuntime('brainIngest', { identity, content, ...opts })
}

/** Explicit `refers_to` link between two memories (the `memory_link` tool). */
export function brainLink(identity: string, from: string, to: string): Promise<{ ok: boolean }> {
	return avenDbRuntime('brainLink', { identity, from, to })
}

/** Step a memory's veracity one tier toward `stated` (the `memory_attest` tool). */
export function brainAttest(
	identity: string,
	id: string
): Promise<{ ok: boolean; veracity: string }> {
	return avenDbRuntime('brainAttest', { identity, id })
}

/** Soft-drop a memory from recall — tombstone, nothing deleted (the `memory_forget` tool). */
export function brainForget(identity: string, id: string): Promise<{ ok: boolean }> {
	return avenDbRuntime('brainForget', { identity, id })
}

/** Hybrid recall (RRF + modifiers + abstention floor) with per-hit via/rank/score. */
export function brainSearch(
	identity: string,
	query: string,
	k = 8,
	stream?: string
): Promise<BrainHit[]> {
	return avenDbRuntime('brainSearch', { identity, query, k, ...(stream ? { stream } : {}) })
}

export function brainEntities(identity: string): Promise<BrainEntity[]> {
	return avenDbRuntime('brainEntities', { identity })
}

export function brainEntityCard(identity: string, name: string): Promise<BrainEntityCard | null> {
	return avenDbRuntime('brainEntityCard', { identity, name })
}

/** The brain as context manager: budgeted prompt + ContextTrace receipt for one turn. */
export function brainAssembleContext(
	identity: string,
	query: string,
	opts: { workingN?: number; recallK?: number; budgetChars?: number; stream?: string } = {}
): Promise<ContextBundle> {
	return avenDbRuntime('brainAssembleContext', { identity, query, ...opts })
}

/** One-shot ingest of the identity's existing message history (idempotent re-runs). */
export function brainBackfill(identity: string): Promise<{ scanned: number; ingested: number }> {
	return avenDbRuntime('brainBackfill', { identity })
}

/** Re-embed every memory with the CURRENT embedder (stub→gemma migration). */
export function brainReembed(identity: string): Promise<{ reembedded: number; embedder: string }> {
	return avenDbRuntime('brainReembed', { identity })
}

/** Run a dreaming consolidation pass (decay, merge, claim healing, consolidation). */
export function brainDream(identity: string): Promise<DreamReport> {
	return avenDbRuntime('brainDream', { identity })
}

/** One step of a STEPPED dream (mirrors `aven_brain::DreamStep`). */
export type DreamStep = {
	phase: string
	label: string
	count: number
	tokens: number
	nextCursor: number
	done: boolean
}

/**
 * Run ONE dream phase (start at cursor 0, re-call with `nextCursor` until `done`). Each call is a
 * separate avenDB-runtime turn, so the dream stays OFF the main path — reads interleave between
 * phases — and every step returns a log line for the live dreaming panel.
 */
export function brainDreamStep(identity: string, cursor: number): Promise<DreamStep> {
	return avenDbRuntime('brainDreamStep', { identity, cursor })
}
