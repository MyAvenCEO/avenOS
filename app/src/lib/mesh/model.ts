/**
 * The collapsed first-principles model, aligned with abject.world:
 *
 * ONE primitive — the Actor: an address plus a manifest. A coordinator
 * is an actor with members (what the UI calls a "skill"). Wiring is
 * never stored: edges are DERIVED from provides ∩ requires, exactly the
 * abject rule ("the schema is the object"). ask() is the self-describing
 * mandate — every actor answers from its manifest.
 *
 * This is the declaration side, which the Skills canvas renders. The
 * instance side (message threads, run/state/board derivations) lived
 * here too until 0141 removed it with the Intents cockpit — it had no
 * caller but its own tests.
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
	/** Declarative knobs — thresholds, schemas, rules: the abject manifest's
	 * "interface specification" part. Domain knowledge lives HERE, visible. */
	config?: Record<string, unknown>
	tags?: string[]
}

export interface Actor {
	id: string
	manifest: Manifest
	/** Coordinator gestalt ("skill"): the members it speaks to. */
	members?: string[]
}

export function find(actors: Actor[], id: string): Actor | undefined {
	return actors.find((a) => a.id === id)
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
		actor.members?.length ? `members: ${actor.members.join(', ')}` : ''
	]
		.filter(Boolean)
		.join('\n')
}

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
