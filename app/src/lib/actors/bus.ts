import type { MethodSpec } from './actor'
import {
	type Actor,
	functor,
	type HandlerResult,
	keepsRecords,
	type Llm,
	llmSettings,
	manifestProse,
	shapesModelText
} from './actor'
import { singleton } from './singleton'
import { unifiable } from './term'

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
	/** The failure, verbatim — a ✗ without its reason is not a trace. */
	note?: string
}

let traceSeq = 0

/** One message waiting for a human button press — the universal HITL unit. */
export interface HeldMessage {
	id: string
	actor: string
	method: string
	label: string
	detail: string
}

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
	/**
	 * The model lane, derived — never injected. The registered `llm` ACTOR is
	 * the only door to the model (abject: the LLM is a service actor); this
	 * closure turns a message to it back into the plain Llm function ask()
	 * and the execution engine consume. No llm actor registered = no lane.
	 */
	llmLane(): Llm | undefined {
		const actor = this.get('llm')
		if (!actor) return undefined
		return async (system, question, settings) => {
			const result = await actor.deliver('llm_complete', {
				system,
				question,
				...(settings && { settings })
			})
			try {
				const parsed = JSON.parse(result.record) as { ok?: boolean; text?: unknown }
				if (parsed.ok !== false) return String(parsed.text ?? '')
			} catch {
				// fall through to the failure below
			}
			throw new Error(result.wire)
		}
	}
	/**
	 * How machine output is parsed out of model text; the app injects the
	 * string-aware extractor. Default: plain JSON.parse, fine for tests.
	 */
	extractJson: (text: string) => unknown = (text) => {
		try {
			return JSON.parse(text)
		} catch {
			return null
		}
	}
	/** UI seam: called on registry changes; the app wires reactivity here. */
	onChange?: () => void

	/**
	 * Identity vs discovery (0133): actors are stored by UUID — the envelope
	 * address; names are an INDEX. A template name (manifest.id) resolves to
	 * its default instance (the first registered), a unique instance name to
	 * that instance. Spawned copies of a template register under their own
	 * uuid without touching the default.
	 */
	#byName = new Map<string, string>()

	register(actor: Actor): void {
		this.#actors.set(actor.uuid, actor)
		if (!this.#byName.has(actor.manifest.id)) this.#byName.set(actor.manifest.id, actor.uuid)
		if (!this.#byName.has(actor.instanceName)) this.#byName.set(actor.instanceName, actor.uuid)
		this.onChange?.()
	}

	unregister(ref: string): void {
		const actor = this.get(ref)
		if (!actor) return
		this.#actors.delete(actor.uuid)
		for (const [name, uuid] of this.#byName) {
			if (uuid === actor.uuid) this.#byName.delete(name)
		}
		// Leaving the mesh frees the sandbox — WASM memory is not garbage.
		actor.dispose()
		this.onChange?.()
	}

	actors(): Actor[] {
		return [...this.#actors.values()]
	}

	/** Resolve uuid OR name (template name = its default instance). */
	get(ref: string): Actor | undefined {
		return this.#actors.get(ref) ?? this.#actors.get(this.#byName.get(ref) ?? '')
	}

	/**
	 * Spawn seam (0133): templates that may be instantiated register a
	 * factory; spawn/dispose are ENGINE primitives — the registry actor
	 * reaches them as capabilities, the UI reflects them via the hooks.
	 */
	#factories = new Map<string, () => Actor>()
	onSpawned?: (actor: Actor) => void
	onDisposed?: (actor: Actor) => void

	spawnable(template: string, factory: () => Actor): void {
		this.#factories.set(template, factory)
	}

	canSpawn(template: string): boolean {
		return this.#factories.has(template)
	}

	spawn(template: string, name?: string): Actor | null {
		const factory = this.#factories.get(template)
		if (!factory) return null
		const actor = factory()
		actor.instanceName =
			name && name.trim() !== '' && !this.#byName.has(name.trim())
				? name.trim()
				: `${template}-${actor.uuid.slice(0, 4)}`
		this.register(actor)
		this.onSpawned?.(actor)
		return actor
	}

	dispose(ref: string): Actor | null {
		const actor = this.get(ref)
		if (!actor) return null
		// The default instance is code-owned; only spawned copies die.
		if (this.#byName.get(actor.manifest.id) === actor.uuid) return null
		this.unregister(actor.uuid)
		this.onDisposed?.(actor)
		return actor
	}

	/** Route one envelope into its actor's mailbox. Unknown addressees error. */
	async send(envelope: Envelope): Promise<HandlerResult> {
		const actor = this.get(envelope.to)
		// The biography speaks names: envelopes route by uuid, the trace shows
		// the instance name — uuids are addresses, not prose.
		const shown = actor?.instanceName ?? envelope.to
		const started = Date.now()
		if (!actor) {
			const record = JSON.stringify({ ok: false, error: `no actor ${envelope.to}` })
			this.#record({
				at: started,
				kind: 'send',
				from: envelope.from,
				to: shown,
				method: envelope.method,
				ok: false,
				ms: 0
			})
			return { record, wire: `no actor ${envelope.to}` }
		}
		const result = await actor.deliver(envelope.method, envelope.payload)
		let ok = true
		let note: string | undefined
		try {
			const parsed = JSON.parse(result.record) as { ok?: boolean; error?: unknown }
			ok = parsed.ok !== false
			if (!ok && parsed.error) note = String(parsed.error).slice(0, 200)
		} catch {
			// non-JSON records count as fine
		}
		this.#record({
			at: started,
			kind: 'send',
			from: envelope.from,
			to: shown,
			method: envelope.method,
			ok,
			ms: Date.now() - started,
			...(note && { note })
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
		// Unifiability, not functor equality — an emit
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

	/**
	 * Interview an actor — the one path on which the model lane may speak.
	 * Caller-aware (Ask Protocol): `asker` names who is asking, flows into
	 * the answer AND into the trace as the sender.
	 */
	async ask(actorId: string, question: string, asker = 'human'): Promise<string> {
		const actor = this.get(actorId)
		const started = Date.now()
		if (!actor) return `There is no actor ${actorId}.`
		const answer = await actor.ask(question, this.llmLane(), asker)
		this.#record({
			at: started,
			kind: 'ask',
			from: asker,
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
		// Instances share their template's methods — dedupe by name; every
		// spec gains the envelope address `to` (uuid or unique instance name,
		// omitted = default instance). Named tools are schema sugar over the
		// ONE primitive below.
		const seen = new Set<string>()
		const specs: MethodSpec[] = []
		for (const actor of this.actors()) {
			for (const method of actor.manifest.methods) {
				if (seen.has(method.name)) continue
				seen.add(method.name)
				const properties = (method.parameters as { properties?: Record<string, unknown> })
					.properties
				specs.push({
					...method,
					parameters: {
						...method.parameters,
						properties: {
							...properties,
							to: {
								type: 'string',
								description:
									'Instance address (uuid or name from registry_list). Omit for the default instance.'
							}
						}
					}
				})
			}
		}
		return [
			...specs,
			{
				// The primitive itself, exposed: one envelope — to, method,
				// payload. Everything above is derived sugar over this.
				name: 'send',
				description:
					'Send one message to one actor instance: the universal envelope. Use when ' +
					'no named tool fits or to address a specific instance directly.',
				parameters: {
					type: 'object',
					properties: {
						to: { type: 'string', description: 'Instance uuid or name.' },
						method: { type: 'string', description: 'The method to deliver.' },
						payload: { type: 'object', additionalProperties: true }
					},
					required: ['to', 'method']
				}
			},
			{
				name: 'actor_ask',
				description:
					'Ask an actor a question in natural language — it answers as itself. ' +
					`Available actors: ${this.actors()
						.map((a) => a.instanceName)
						.join(', ')}.`,
				parameters: {
					type: 'object',
					properties: {
						actor: { type: 'string', description: 'The actor id, name or uuid.' },
						question: { type: 'string', description: 'The question.' }
					},
					required: ['actor', 'question']
				}
			}
		]
	}

	/**
	 * The UI event door (0133 debug): a click in a view is a MESSAGE like any
	 * other — it reduces through the actor's sandbox AND lands in the one
	 * biography. Views must never call applyEvent behind the bus's back.
	 */
	async uiEvent(
		from: string,
		ref: string,
		event: { send: string; payload?: Record<string, unknown> }
	): Promise<void> {
		const actor = this.get(ref)
		const started = Date.now()
		if (!actor) return
		let ok = true
		try {
			await actor.applyEvent(event)
		} catch {
			ok = false
		}
		this.#record({
			at: started,
			kind: 'send',
			from,
			to: actor.instanceName,
			method: event.send,
			ok,
			ms: Date.now() - started
		})
	}

	/**
	 * Tool-call bridge: a named method becomes an ordinary envelope. `to` in
	 * the payload addresses an INSTANCE (uuid or unique name — abject's
	 * routing.to); without it the default instance answers. The address is
	 * routing, not data — it never reaches the handler payload.
	 */
	dispatch(from: string, method: string, payload: Record<string, unknown>): Promise<HandlerResult> {
		const { to, ...rest } = payload
		const addressed = typeof to === 'string' && to !== '' ? this.get(to) : undefined
		// `to` is routing ONLY when the addressee actually answers the method —
		// otherwise it is data (dispose's target, say) and stays in the payload.
		const routed = addressed?.handles(method) ? addressed : undefined
		const owner = routed ?? this.actors().find((a) => a.handles(method))
		if (!owner) {
			const record = JSON.stringify({ ok: false, error: `unknown tool ${method}` })
			return Promise.resolve({ record, wire: `unknown tool ${method}` })
		}
		const envelope = {
			id: `env_${nextEnvelope++}`,
			from,
			to: owner.uuid,
			method,
			payload: routed ? rest : payload
		}
		// The human gate (universal HITL): a declared `hitl` entry is HELD —
		// the message exists, but only a physical button press releases it.
		// Confirming is NOT a tool; voice cannot do it.
		const spec = owner.manifest.methods.find((m) => m.name === method)
		if (spec?.hitl && this.onHold) {
			const id = `held_${nextEnvelope++}`
			this.#held.set(id, () => this.send(envelope))
			this.onHold({
				id,
				actor: owner.instanceName,
				method,
				label: spec.hitl,
				detail: JSON.stringify(envelope.payload)
			})
			return Promise.resolve({
				record: JSON.stringify({ ok: true, held: id, confirmation: 'required' }),
				wire:
					`${spec.hitl} — held for the human. A button press in the HUD confirms; ` +
					'voice cannot confirm. Tell the user to press Confirm or Reject.'
			})
		}
		return this.send(envelope)
	}

	/** Held messages: the queue behind the one HITL bar. */
	#held = new Map<string, () => Promise<HandlerResult>>()
	onHold?: (held: HeldMessage) => void
	onHeldResolved?: (id: string) => void

	async confirmHeld(id: string): Promise<HandlerResult> {
		const run = this.#held.get(id)
		this.#held.delete(id)
		this.onHeldResolved?.(id)
		if (!run) {
			return { record: JSON.stringify({ ok: false, error: 'nothing held' }), wire: 'nothing held' }
		}
		return await run()
	}

	rejectHeld(id: string): void {
		this.#held.delete(id)
		this.onHeldResolved?.(id)
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

/** The app's one bus. Tests build their own. */
export const bus = singleton('aven.bus', () => new MessageBus())
