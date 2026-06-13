/**
 * aven-brain IPC client (plan 0018, E2) — a per-SAFE brain over the shared avenDB
 * store. Thin wrappers around the `brain_runtime` ops, which run OUTSIDE the avenDB
 * actor mailbox so brain calls and todo/message CRUD interleave instead of blocking
 * each other (writes still serialize at avenDB's internal core Mutex). All calls are
 * identity-scoped (one brain per SAFE).
 */
import { invoke } from '@tauri-apps/api/core'
import { brainRuntime } from '$lib/runtime/avendb-ipc'

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
	/** Per-phase wall-clock breakdown of the assembly (l0 · gist · working · recall · entities · pack). */
	timings?: Array<{ label: string; ms: number }>
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
	return brainRuntime('brainStatus', { identity })
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
	return brainRuntime('brainIngest', { identity, content, ...opts })
}

/** Explicit `refers_to` link between two memories (the `memory_link` tool). */
export function brainLink(identity: string, from: string, to: string): Promise<{ ok: boolean }> {
	return brainRuntime('brainLink', { identity, from, to })
}

/** Step a memory's veracity one tier toward `stated` (the `memory_attest` tool). */
export function brainAttest(
	identity: string,
	id: string
): Promise<{ ok: boolean; veracity: string }> {
	return brainRuntime('brainAttest', { identity, id })
}

/** Soft-drop a memory from recall — tombstone, nothing deleted (the `memory_forget` tool). */
export function brainForget(identity: string, id: string): Promise<{ ok: boolean }> {
	return brainRuntime('brainForget', { identity, id })
}

/** Hybrid recall (RRF + modifiers + abstention floor) with per-hit via/rank/score. */
export function brainSearch(
	identity: string,
	query: string,
	k = 8,
	stream?: string
): Promise<BrainHit[]> {
	return brainRuntime('brainSearch', { identity, query, k, ...(stream ? { stream } : {}) })
}

export function brainEntities(identity: string): Promise<BrainEntity[]> {
	return brainRuntime('brainEntities', { identity })
}

export function brainEntityCard(identity: string, name: string): Promise<BrainEntityCard | null> {
	return brainRuntime('brainEntityCard', { identity, name })
}

/** The brain as context manager: budgeted prompt + ContextTrace receipt for one turn. */
export function brainAssembleContext(
	identity: string,
	query: string,
	opts: { workingN?: number; recallK?: number; budgetChars?: number; stream?: string } = {}
): Promise<ContextBundle> {
	return brainRuntime('brainAssembleContext', { identity, query, ...opts })
}

/** One-shot ingest of the identity's existing message history (idempotent re-runs). */
export function brainBackfill(identity: string): Promise<{ scanned: number; ingested: number }> {
	return brainRuntime('brainBackfill', { identity })
}

/** One persisted instrumentation entry (dream or activity step) — mirrors `aven_brain::LogEntry`. */
export type BrainLogEntry = {
	kind: 'dream' | 'activity' | string
	phase: string
	label: string
	count: number
	tokens: number
	entities?: { name: string; kind: string }[]
	atMs: number
}

/** The full-session debug bundle — mirrors `aven_brain::DebugExport` (board 0029 M3). */
export type BrainDebugExport = {
	owner: string
	exportedAtMs: number
	/** Whole message history (instrumentation excluded), oldest-first. */
	messages: unknown[]
	/** One entry per human message + the ContextTrace that turn saw. */
	rounds: { message: unknown; contextTrace: ContextBundle['trace'] | null }[]
	/** The full persisted dreaming/activity log, oldest-first. */
	dreamLog: BrainLogEntry[]
}

/**
 * Export the FULL session for debugging (board 0029 M3): whole message history + the per-round
 * `ContextTrace` + the full persisted dreaming log, as one JSON. The brain aside's "Export debug
 * session" button downloads this for offline analysis of recall quality over time.
 */
export function brainDebugExport(identity: string): Promise<BrainDebugExport> {
	return brainRuntime('brainDebugExport', { identity })
}

/** Re-embed every memory with the CURRENT embedder (stub→gemma migration). */
export function brainReembed(identity: string): Promise<{ reembedded: number; embedder: string }> {
	return brainRuntime('brainReembed', { identity })
}

/**
 * Wipe the derived entity/link graph (memories untouched) so dreams re-build it clean under
 * the current rules — clears pre-existing `unknown` junk after the extraction-logic upgrade.
 */
export function brainRebuildGraph(
	identity: string
): Promise<{ entities: number; links: number }> {
	return brainRuntime('brainRebuildGraph', { identity })
}

/** Run a dreaming consolidation pass (decay, merge, claim healing, consolidation). */
export function brainDream(identity: string): Promise<DreamReport> {
	return brainRuntime('brainDream', { identity })
}

/** One step of a STEPPED dream (mirrors `aven_brain::DreamStep`). */
export type DreamStep = {
	phase: string
	label: string
	count: number
	tokens: number
	/** Entities typed by this step (extract phase) — clickable cards in the dreaming log. */
	entities?: { name: string; kind: string }[]
	nextCursor: number
	done: boolean
}

/**
 * Run ONE dream phase (start at cursor 0, re-call with `nextCursor` until `done`). Each call is a
 * separate avenDB-runtime turn, so the dream stays OFF the main path — reads interleave between
 * phases — and every step returns a log line for the live dreaming panel.
 */
export function brainDreamStep(identity: string, cursor: number): Promise<DreamStep> {
	return brainRuntime('brainDreamStep', { identity, cursor })
}

/**
 * Run ONE extraction batch OFF the avenDB actor. Called when `brainDreamStep` returns
 * `phase === "extract_ready"` so the Tinfoil HTTP call never blocks the actor mailbox.
 */
export function brainDoExtract(identity: string): Promise<DreamStep> {
	return invoke('brain_do_extract', { identity })
}
