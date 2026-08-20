import type { StyleDef, ViewDef } from '@avenos/aven-ui'

/**
 * The collapsed first-principles model, aligned with abject.world:
 *
 * ONE primitive — the Actor: an address plus a manifest. A coordinator
 * is an actor with members (what the UI calls a "skill"); an intent is
 * an actor that was BORN from an event and carries a goal (abject/DCI
 * calls this the Context: "the active goal existing during work").
 * Same type, three gestalts — worker, coordinator, context.
 *
 * ONE relation — the Message: the AbjectMessage envelope (id,
 * correlationId, from, to, method, payload). A reply shares the
 * request's correlationId. A message without `to` is an unrouted
 * event; a message to `you` is the human in the loop; a message across
 * a coordinator boundary is what we used to call a handoff.
 *
 * EVERYTHING else is derived, never stored:
 * - edges:    provides ∩ requires (functor equality)
 * - needs:    requires − delivered (an open requirement IS an open ask)
 * - states:   read off the thread (open asks, who they address)
 * - the path: the chain of open asks down to the working leaf
 * - the face state: the data replies carried, merged
 *
 * Stored are only declarations (manifests) and history (the message
 * log) — exactly abject's storage rule: store knowledge and execution
 * history, derive answers, negotiate integration.
 */

export interface Autonomy {
	mode: 'human' | 'sample' | 'auto'
	onError: 'human' | 'retry'
	granted?: { by: string; since: string; evidence: string }
}

export interface Manifest {
	name: string
	/** Behavioral documentation — also the ask() fallback answer. */
	about: string
	/** Verb namespace of a worker, e.g. 'llm:classify'. */
	type?: string
	/** Required capabilities — functor names, matching term.ts semantics. */
	requires?: string[]
	/** Provided capabilities. */
	provides?: string[]
	autonomy?: Autonomy
	llm?: { purpose: string; constraints?: string[] }
	tags?: string[]
	/** The actor's face: JSON rendered by the aven-ui engine. */
	face?: { view: ViewDef; style: StyleDef }
}

export interface Actor {
	id: string
	manifest: Manifest
	/** Coordinator gestalt ("skill"): the members it speaks to. */
	members?: string[]
	/** Context gestalt ("intent"): born from an event, carries a goal. */
	born?: { event: string; goal: string; at: string }
}

export interface Message {
	id: string
	correlationId: string
	at: string
	from: string
	/** Missing `to` = an unrouted event, waiting for an address. */
	to?: string
	method: string
	/** Human-facing line of the payload. */
	text?: string
	/** Face facts the payload carries. */
	data?: Record<string, unknown>
	/** Functors a REPLY delivers — the proof a requirement was met. */
	gives?: string[]
}

export interface Thread {
	intent: string
	log: Message[]
}

export type State = 'working' | 'needs-you' | 'waiting' | 'done'

/** The human is an actor too — the one address that is always known. */
export const YOU = 'you'

// ---------------------------------------------------------------- lookup

export function find(actors: Actor[], id: string): Actor | undefined {
	return actors.find((a) => a.id === id)
}

/** A coordinator's transitive members, itself included. */
export function subtree(actors: Actor[], id: string, seen = new Set<string>()): string[] {
	if (seen.has(id)) return []
	seen.add(id)
	const actor = find(actors, id)
	if (!actor) return []
	return [id, ...(actor.members ?? []).flatMap((m) => subtree(actors, m, seen))]
}

/**
 * ask() — the abject mandate: every actor answers questions about
 * itself. Without an LLM the answer falls back to the manifest as
 * plain text, verbatim the ask-protocol's fallback rule.
 */
export function ask(actor: Actor): string {
	const m = actor.manifest
	return [
		`${m.name} — ${m.about}`,
		m.requires?.length ? `requires: ${m.requires.join(', ')}` : '',
		m.provides?.length ? `provides: ${m.provides.join(', ')}` : '',
		actor.members?.length ? `members: ${actor.members.join(', ')}` : '',
		actor.born ? `goal: ${actor.born.goal}` : ''
	]
		.filter(Boolean)
		.join('\n')
}

// ---------------------------------------------------------------- derived: graph

/** Edges are never stored: A feeds B iff A provides what B requires. */
export function edges(
	actors: Actor[],
	coordinatorId: string
): { from: string; to: string; functor: string }[] {
	const coordinator = find(actors, coordinatorId)
	const out: { from: string; to: string; functor: string }[] = []
	const members = coordinator?.members ?? []
	for (const a of members) {
		for (const b of members) {
			if (a === b) continue
			const provides = find(actors, a)?.manifest.provides ?? []
			const requires = find(actors, b)?.manifest.requires ?? []
			for (const f of provides) {
				if (requires.includes(f)) out.push({ from: a, to: b, functor: f })
			}
		}
	}
	return out
}

// ---------------------------------------------------------------- derived: thread

/** A reply is a message answering an earlier request to its sender. */
export function isReply(m: Message, log: Message[]): boolean {
	const i = log.indexOf(m)
	return log.some(
		(req, j) =>
			j < i && req.id !== m.id && req.correlationId === m.correlationId && req.to === m.from
	)
}

/** Requests still unanswered — the open asks ARE the open needs. */
export function openAsks(log: Message[]): Message[] {
	return log.filter(
		(m) =>
			m.to !== undefined &&
			!isReply(m, log) &&
			!log.some((r) => r !== m && r.correlationId === m.correlationId && isReply(r, log))
	)
}

/** A requirement is met once some reply delivered its functor. */
export function delivered(log: Message[]): Set<string> {
	const got = new Set<string>()
	for (const m of log) {
		if (isReply(m, log)) for (const f of m.gives ?? []) got.add(f)
	}
	return got
}

/** needs = requires − delivered. The word "needs" is a view, not a field. */
export function needs(actors: Actor[], id: string, log: Message[]): string[] {
	const got = delivered(log)
	return (find(actors, id)?.manifest.requires ?? []).filter((f) => !got.has(f))
}

/**
 * The state of a coordinator inside a thread — read off the messages:
 * an open ask to you anywhere in the subtree = needs-you; the ask INTO
 * the coordinator answered = done; no activity yet but unmet
 * requirements = waiting; otherwise it is working.
 */
export function actorState(actors: Actor[], id: string, log: Message[]): State {
	const sub = new Set(subtree(actors, id))
	const open = openAsks(log)
	if (open.some((m) => m.to === YOU && sub.has(m.from))) return 'needs-you'
	const askedIn = log.filter((m) => m.to === id && !isReply(m, log))
	const answered =
		askedIn.length > 0 &&
		askedIn.every((req) =>
			log.some((r) => r.correlationId === req.correlationId && isReply(r, log))
		)
	if (answered) return 'done'
	const activity = log.some((m) => sub.has(m.from))
	if (!activity && needs(actors, id, log).length > 0) return 'waiting'
	return 'working'
}

/**
 * The path: follow the chain of open asks from the coordinator down to
 * the leaf that is actually working — depth as a breadcrumb, exactly
 * the call-stack reading of composition.
 */
export function path(actors: Actor[], id: string, log: Message[]): string[] {
	const open = openAsks(log)
	const chain: string[] = []
	const visited = new Set<string>([id])
	let current = id
	for (let i = 0; i < 32; i++) {
		// The next hop may come from anywhere INSIDE the current subtree —
		// a coordinator's member asking onward is still this stack frame.
		const sub = new Set(subtree(actors, current))
		const next = open.find(
			(m) => m.to !== undefined && !visited.has(m.to) && (m.from === current || sub.has(m.from))
		)
		if (!next || next.to === undefined) break
		chain.push(next.to)
		visited.add(next.to)
		current = next.to
	}
	return chain
}

/** A member's position: answered = done, openly asked = current, else pending. */
export function memberState(id: string, log: Message[]): 'done' | 'current' | 'pending' {
	if (log.some((m) => m.from === id && isReply(m, log))) return 'done'
	if (openAsks(log).some((m) => m.to === id)) return 'current'
	return 'pending'
}

/** The coordinators an intent engaged — the unique addressees of its asks. */
export function engaged(actors: Actor[], intentId: string, log: Message[]): string[] {
	return [
		...new Set(
			log
				.filter((m) => m.from === intentId && m.to !== undefined)
				.map((m) => m.to as string)
				.filter((to) => (find(actors, to)?.members?.length ?? 0) > 0)
		)
	]
}

/** The intent's own state — the rollup, derived like everything else. */
export function intentState(_actors: Actor[], _intentId: string, log: Message[]): State {
	if (openAsks(log).some((m) => m.to === YOU)) return 'needs-you'
	const root = log[0]
	if (root && log.some((r) => r.correlationId === root.correlationId && isReply(r, log))) {
		return 'done'
	}
	return 'working'
}

/**
 * The board of a collecting intent: whom it asked among the BORN actors
 * (intent waits on intents — just open asks) and who already answered.
 */
export function board(
	actors: Actor[],
	intentId: string,
	log: Message[]
): { actor: Actor; done: boolean }[] {
	return log
		.filter((m) => m.from === intentId && m.to !== undefined && find(actors, m.to)?.born)
		.map((m) => ({
			actor: find(actors, m.to as string) as Actor,
			done: log.some((r) => r.correlationId === m.correlationId && isReply(r, log))
		}))
}

/** The face state: every fact the subtree's replies carried, merged in order. */
export function faceState(actors: Actor[], id: string, log: Message[]): Record<string, unknown> {
	const sub = new Set(subtree(actors, id))
	const merged: Record<string, unknown> = {}
	for (const m of log) {
		if (m.data && (sub.has(m.from) || (m.to !== undefined && sub.has(m.to)))) {
			Object.assign(merged, m.data)
		}
	}
	return merged
}
