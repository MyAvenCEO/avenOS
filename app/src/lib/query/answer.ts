import type { HeldMessage } from '$lib/actors/bus'

/**
 * THE answer model (0159).
 *
 * The app had five surfaces that all meant "the system answered you" — a chat
 * aside, a window surface, a live-transcription toast and a 414-line human-gate
 * card — each with its own layout code. They are not five features. A search
 * hit, a rendered board, a sentence and a gate are four SHAPES of one thing,
 * so there is one stream of `Answer`s and one renderer that dispatches on
 * `kind`.
 *
 * This module is deliberately Svelte-free: it is the model and the registry,
 * so it can be tested without a DOM.
 */

/**
 * One hit from a source — what it IS, never how it looks. `shape` is a hint
 * the RENDERER interprets; nothing in this file may branch on its value, or
 * the registry stops being a registry.
 */
export interface AnswerRow {
	id: string
	label: string
	note?: string
	shape: string
}

/** What the query knows about where it was asked from. */
export interface QueryContext {
	/** The intent in view, if any — sources may narrow to it. */
	intent: string | null
}

export type Answer =
	| { kind: 'rows'; id: string; source: string; rows: AnswerRow[] }
	| { kind: 'view'; id: string; window: string; title: string }
	| { kind: 'say'; id: string; role: 'user' | 'assistant'; text: string }
	| { kind: 'gate'; id: string; held: HeldMessage }

/**
 * A source answers a query. It returns `Answer`s rather than rows so that a
 * source which opens a VIEW ("show the board") is not a special case in the
 * engine — it is just a source that answers in a different shape.
 */
export type Source = (query: string, ctx: QueryContext) => Answer[]

const sources = new Map<string, Source>()

/** Register a source. Re-registering an id replaces it (HMR-safe). */
export function registerSource(id: string, source: Source): void {
	sources.set(id, source)
}

/** The registered source ids, in registration order. */
export function sourceIds(): string[] {
	return [...sources.keys()]
}

/** Tests own the registry between cases. */
export function clearSources(): void {
	sources.clear()
}

/** Build a rows answer — the shape most sources want. */
export function rowsAnswer(source: string, rows: AnswerRow[]): Answer {
	return { kind: 'rows', id: `rows:${source}`, source, rows }
}

/**
 * Ask every source and collect what comes back, in registration order.
 *
 * Empty answers are dropped so a source that has nothing to say costs nothing
 * on screen, and duplicates (same kind + id) collapse — two sources may know
 * the same thing, but the reader should see it once.
 */
export function runQuery(query: string, ctx: QueryContext): Answer[] {
	const seen = new Set<string>()
	const out: Answer[] = []
	for (const [id, source] of sources) {
		let answers: Answer[]
		try {
			answers = source(query, ctx)
		} catch {
			// One broken source must not blank the whole surface.
			continue
		}
		for (const answer of answers) {
			if (answer.kind === 'rows' && answer.rows.length === 0) continue
			const key = `${answer.kind}:${answer.id || id}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push(answer)
		}
	}
	return out
}

/**
 * Held messages become answers like everything else. The gate keeps its own
 * shape — it is the one answer that cannot be resolved by talking — but it no
 * longer needs a surface of its own.
 */
export function gateAnswers(held: HeldMessage[]): Answer[] {
	return held.map((h) => ({ kind: 'gate' as const, id: h.id, held: h }))
}
