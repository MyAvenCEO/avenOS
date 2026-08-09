import type { MethodSpec } from './actor'
import { type Actor, functor, type HandlerResult, type Llm } from './actor'
import { singleton } from './singleton'
import { type Bindings, rename, resolve, unifiable, unify } from './term'

/**
 * The substrate: every message between any two parties flows here.
 *
 * Minimal and growable — the envelope carries what a local bus needs and
 * nothing it doesn't; the wire-format fields (sequence numbers, protocol
 * versions) arrive with the wire, later. The directory doubles as the
 * registry, and the registry is itself reachable as an actor, because a
 * layer the bus itself can't see is a layer that doesn't exist.
 */

export interface Envelope {
	id: string
	from: string
	to: string
	method: string
	payload: Record<string, unknown>
	correlationId?: string
}

let nextEnvelope = 0

/** An edge derived by unification: `from` produces what `to` requires. */
export interface DerivedEdge {
	from: string
	to: string
	predicate: string
}

export interface TraceEntry {
	seq: number
	at: number
	kind: 'send' | 'emit' | 'ask'
	from: string
	to: string
	method: string
	ok: boolean
	ms: number
}

let traceSeq = 0

export class MessageBus {
	#actors = new Map<string, Actor>()
	/**
	 * The biography: everything that crossed the bus — envelopes, emit
	 * fan-outs, ask() interviews — newest last, capped. Instances stop living
	 * in an eternal anonymous present.
	 */
	traceLog: TraceEntry[] = []

	#record(entry: Omit<TraceEntry, 'seq'>): void {
		this.traceLog.push({ ...entry, seq: traceSeq++ })
		if (this.traceLog.length > 200) this.traceLog.splice(0, this.traceLog.length - 200)
	}
	/** The one LLM in the system, injected once; actors reach it only via ask. */
	llm?: Llm
	/** UI seam: called on registry changes; the app wires reactivity here. */
	onChange?: () => void

	register(actor: Actor): void {
		this.#actors.set(actor.manifest.id, actor)
		this.onChange?.()
	}

	unregister(id: string): void {
		this.#actors.delete(id)
		this.onChange?.()
	}

	actors(): Actor[] {
		return [...this.#actors.values()]
	}

	get(id: string): Actor | undefined {
		return this.#actors.get(id)
	}

	/** Route one envelope into its actor's mailbox. Unknown addressees error. */
	async send(envelope: Envelope): Promise<HandlerResult> {
		const actor = this.#actors.get(envelope.to)
		const started = Date.now()
		if (!actor) {
			const record = JSON.stringify({ ok: false, error: `kein Actor ${envelope.to}` })
			this.#record({
				at: started,
				kind: 'send',
				from: envelope.from,
				to: envelope.to,
				method: envelope.method,
				ok: false,
				ms: 0
			})
			return { record, wire: `kein Actor ${envelope.to}` }
		}
		const result = await actor.deliver(envelope.method, envelope.payload)
		let ok = true
		try {
			ok = JSON.parse(result.record).ok !== false
		} catch {
			// non-JSON records count as fine
		}
		this.#record({
			at: started,
			kind: 'send',
			from: envelope.from,
			to: envelope.to,
			method: envelope.method,
			ok,
			ms: Date.now() - started
		})
		return result
	}

	/**
	 * The execution engine, forward-chaining: emitting a predicate delivers it
	 * to every actor whose requires unifies with its functor — the handler for
	 * a subscribed predicate is the handler named after the functor. This is
	 * produce/require as ROUTING rather than documentation: the graph the
	 * explorer derives is the graph that runs.
	 */
	emit(
		predicate: string,
		payload: Record<string, unknown>,
		from = 'system'
	): Promise<HandlerResult[]> {
		const name = functor(predicate)
		// Same rule as the prover: unifiability, not functor equality — an emit
		// of status(offen) never reaches a consumer of status(erledigt).
		const targets = this.actors().filter(
			(a) => a.requires.some((r) => unifiable(r, predicate)) && a.handles(name)
		)
		this.#record({
			at: Date.now(),
			kind: 'emit',
			from,
			to: targets.map((t) => t.manifest.id).join(',') || '—',
			method: name,
			ok: targets.length > 0,
			ms: 0
		})
		return Promise.all(
			targets.map((t) =>
				this.send({
					id: `env_${nextEnvelope++}`,
					from,
					to: t.manifest.id,
					method: name,
					payload
				})
			)
		)
	}

	/** Interview an actor — the one path on which the injected LLM may speak. */
	async ask(actorId: string, question: string): Promise<string> {
		const actor = this.#actors.get(actorId)
		const started = Date.now()
		if (!actor) return `Es gibt keinen Actor ${actorId}.`
		const answer = await actor.ask(question, this.llm)
		this.#record({
			at: started,
			kind: 'ask',
			from: 'human/model',
			to: actorId,
			method: 'ask',
			ok: true,
			ms: Date.now() - started
		})
		return answer
	}

	/**
	 * The model's tool list, derived from the registry — never hand-assembled.
	 * Register an actor and the model can call it; that is the whole
	 * "grows by adoption" mechanism. `actor_ask` rides along so the model can
	 * interview actors the same way a human does.
	 */
	toolSpecs(): MethodSpec[] {
		const specs = this.actors().flatMap((a) => a.manifest.methods)
		return [
			...specs,
			{
				name: 'actor_ask',
				description:
					'Stelle einem Actor eine Frage in natürlicher Sprache — er antwortet als er ' +
					`selbst. Verfügbare Actors: ${this.actors()
						.map((a) => a.manifest.id)
						.join(', ')}.`,
				parameters: {
					type: 'object',
					properties: {
						actor: { type: 'string', description: 'Die id des Actors.' },
						question: { type: 'string', description: 'Die Frage.' }
					},
					required: ['actor', 'question']
				}
			}
		]
	}

	/** Tool-call bridge: a named method becomes an ordinary envelope. */
	dispatch(from: string, method: string, payload: Record<string, unknown>): Promise<HandlerResult> {
		const owner = this.actors().find((a) => a.handles(method))
		if (!owner) {
			const record = JSON.stringify({ ok: false, error: `unbekanntes Werkzeug ${method}` })
			return Promise.resolve({ record, wire: `unbekanntes Werkzeug ${method}` })
		}
		return this.send({
			id: `env_${nextEnvelope++}`,
			from,
			to: owner.manifest.id,
			method,
			payload
		})
	}

	/**
	 * The flow graph, derived: an edge exists wherever one actor produces what
	 * another requires. Nothing stored, nothing to keep in sync — change the
	 * registry and the next derivation changes with it.
	 */
	edges(): DerivedEdge[] {
		const result: DerivedEdge[] = []
		for (const producer of this.actors()) {
			for (const consumer of this.actors()) {
				if (consumer === producer) continue
				for (const need of consumer.requires) {
					if (producer.produces.some((p) => unifiable(p, need))) {
						result.push({
							from: producer.manifest.id,
							to: consumer.manifest.id,
							predicate: functor(need)
						})
					}
				}
			}
		}
		return result
	}

	/**
	 * Backward chaining: prove a goal SLD-style over the registry.
	 *
	 * To prove p: find the actors whose produces unify with p; for each
	 * candidate (in registry order — trying the next on failure IS the
	 * backtracking), recursively prove every requirement. A requirement no
	 * actor produces is an external fact — satisfied as an input from the
	 * world. `not(p)` is negation-as-failure: satisfied exactly when p has no
	 * producer. Cycles count as satisfied-by-assumption (the coinductive
	 * reading) so recursion terminates.
	 *
	 * Purely static — nothing runs. The tree is the execution PLAN: walk it
	 * postorder and you have the message order; the proof tree is the trace
	 * the runtime will one day emit.
	 */
	prove(goal: string, visited: Set<string> = new Set(), bindings: Bindings = {}): ProofStep {
		const naf = goal.trim().match(/^not\((.+)\)$/)
		if (naf) {
			const inner = naf[1]
			const producers = this.actors().filter((a) => a.produces.some((p) => unifiable(p, inner)))
			return {
				predicate: goal,
				actor: null,
				external: false,
				negated: true,
				satisfied: producers.length === 0,
				children: [],
				bindings
			}
		}

		const name = functor(goal)
		if (visited.has(name)) {
			return {
				predicate: goal,
				actor: null,
				external: false,
				negated: false,
				satisfied: true,
				children: [],
				bindings
			}
		}

		// Candidate producers are found by UNIFICATION now, not name equality:
		// a producer of intent(M, niedrig) is no candidate for intent(X, hoch).
		// Each candidate's variables are renamed into its own namespace before
		// unifying, the way SLD resolution standardizes clauses apart.
		const candidates = this.actors()
			.map((a) => {
				const head = a.produces.find((p) => {
					const u = unify(goal, rename(p, a.manifest.id), bindings)
					return u !== null
				})
				return head ? { actor: a, head: rename(head, a.manifest.id) } : null
			})
			.filter((c) => c !== null)

		if (candidates.length === 0) {
			const anyProducer = this.actors().some((a) => a.produces.some((p) => functor(p) === name))
			// No producer of this functor at all → an external fact, satisfied
			// as an input from the world. A producer with CLASHING constants is
			// not external — it is an unsatisfied goal.
			return {
				predicate: goal,
				actor: null,
				external: !anyProducer,
				negated: false,
				satisfied: !anyProducer,
				children: [],
				bindings
			}
		}

		const nextVisited = new Set(visited)
		nextVisited.add(name)
		let lastAttempt: ProofStep | null = null
		for (const { actor, head } of candidates) {
			const headBindings = unify(goal, head, bindings)
			if (headBindings === null) continue
			let current = headBindings
			const children: ProofStep[] = []
			for (const r of actor.requires) {
				const child = this.prove(rename(r, actor.manifest.id), nextVisited, current)
				children.push(child)
				if (child.satisfied) current = child.bindings
			}
			const attempt: ProofStep = {
				predicate: goal,
				actor: actor.manifest.id,
				external: false,
				negated: false,
				satisfied: children.every((c) => c.satisfied),
				children,
				bindings: current
			}
			if (attempt.satisfied) return attempt
			lastAttempt = attempt
		}
		return lastAttempt as ProofStep
	}

	/**
	 * A goal is unerfüllt when its proof fails — the provability check the
	 * old flow templates carried, now against the live registry.
	 */
	unsatisfied(goal: string): boolean {
		return !this.prove(goal).satisfied
	}

	/**
	 * Solver stages for layout: actors whose requirements are external facts
	 * fire first; everyone else joins as their inputs become available.
	 */
	stages(): Actor[][] {
		const allProduced = this.actors().flatMap((a) => a.produces)
		const known: string[] = []
		const pending = [...this.actors()]
		const result: Actor[][] = []

		while (pending.length > 0) {
			const ready = pending.filter((a) =>
				a.requires.every(
					(r) => known.some((k) => unifiable(k, r)) || !allProduced.some((p) => unifiable(p, r))
				)
			)
			if (ready.length === 0) {
				result.push(pending.splice(0))
				break
			}
			for (const actor of ready) {
				pending.splice(pending.indexOf(actor), 1)
				known.push(...actor.produces)
			}
			result.push(ready)
		}
		return result
	}
}

/**
 * One node of a proof tree: the goal predicate, who was chosen to produce
 * it, and the sub-proofs of that producer's requirements.
 */
export interface ProofStep {
	predicate: string
	/** The producing actor, or null when the goal is external or unproven. */
	actor: string | null
	/** external: nobody produces it, so it must arrive from outside — a fact. */
	external: boolean
	/** negation-as-failure: goal of the form not(p) — satisfied iff p is unprovable. */
	negated: boolean
	satisfied: boolean
	children: ProofStep[]
	/** The substitution at this node — which variables became what. */
	bindings: Bindings
}

/** The app's one bus. Tests build their own. */
export const bus = singleton('aven.bus', () => new MessageBus())
