import type { MethodSpec } from './actor'
import { type Actor, functor, type HandlerResult, type Llm } from './actor'

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

export class MessageBus {
	#actors = new Map<string, Actor>()
	/** The one LLM in the system, injected once; actors reach it only via ask. */
	llm?: Llm

	register(actor: Actor): void {
		this.#actors.set(actor.manifest.id, actor)
	}

	actors(): Actor[] {
		return [...this.#actors.values()]
	}

	get(id: string): Actor | undefined {
		return this.#actors.get(id)
	}

	/** Route one envelope into its actor's mailbox. Unknown addressees error. */
	send(envelope: Envelope): Promise<HandlerResult> {
		const actor = this.#actors.get(envelope.to)
		if (!actor) {
			const record = JSON.stringify({ ok: false, error: `kein Actor ${envelope.to}` })
			return Promise.resolve({ record, wire: `kein Actor ${envelope.to}` })
		}
		return actor.deliver(envelope.method, envelope.payload)
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
		const targets = this.actors().filter(
			(a) => a.requires.some((r) => functor(r) === name) && a.handles(name)
		)
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
		if (!actor) return `Es gibt keinen Actor ${actorId}.`
		return actor.ask(question, this.llm)
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
			const made = new Set(producer.produces.map(functor))
			for (const consumer of this.actors()) {
				if (consumer === producer) continue
				for (const need of consumer.requires) {
					if (made.has(functor(need))) {
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
	 * Solver stages for layout: actors whose requirements are external facts
	 * fire first; everyone else joins as their inputs become available.
	 */
	stages(): Actor[][] {
		const producedByAnyone = new Set(this.actors().flatMap((a) => a.produces.map(functor)))
		const known = new Set<string>()
		const pending = [...this.actors()]
		const result: Actor[][] = []

		while (pending.length > 0) {
			const ready = pending.filter((a) =>
				a.requires.every((r) => known.has(functor(r)) || !producedByAnyone.has(functor(r)))
			)
			if (ready.length === 0) {
				result.push(pending.splice(0))
				break
			}
			for (const actor of ready) {
				pending.splice(pending.indexOf(actor), 1)
				for (const p of actor.produces) known.add(functor(p))
			}
			result.push(ready)
		}
		return result
	}
}

/** The app's one bus. Tests build their own. */
export const bus = new MessageBus()
