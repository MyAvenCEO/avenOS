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
	/** 'step' = one executed run step — a run is a GROUP of trace entries. */
	kind: 'send' | 'emit' | 'ask' | 'step'
	from: string
	to: string
	method: string
	ok: boolean
	ms: number
	/** The run this entry belongs to; only on kind 'step'. */
	run?: string
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
	/**
	 * The model lane, derived — never injected. The registered `llm` ACTOR is
	 * the only door to the model (abject: the LLM is a service actor); this
	 * closure turns a message to it back into the plain Llm function ask()
	 * and the execution engine consume. No llm actor registered = no lane.
	 */
	llmLane(): Llm | undefined {
		const actor = this.#actors.get('llm')
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
			const record = JSON.stringify({ ok: false, error: `no actor ${envelope.to}` })
			this.#record({
				at: started,
				kind: 'send',
				from: envelope.from,
				to: envelope.to,
				method: envelope.method,
				ok: false,
				ms: 0
			})
			return { record, wire: `no actor ${envelope.to}` }
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

	/**
	 * Interview an actor — the one path on which the model lane may speak.
	 * Caller-aware (Ask Protocol): `asker` names who is asking, flows into
	 * the answer AND into the trace as the sender.
	 */
	async ask(actorId: string, question: string, asker = 'human'): Promise<string> {
		const actor = this.#actors.get(actorId)
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
		const specs = this.actors().flatMap((a) => a.manifest.methods)
		return [
			...specs,
			{
				name: 'actor_ask',
				description:
					'Ask an actor a question in natural language — it answers as itself. ' +
					`Available actors: ${this.actors()
						.map((a) => a.manifest.id)
						.join(', ')}.`,
				parameters: {
					type: 'object',
					properties: {
						actor: { type: 'string', description: 'The actor id.' },
						question: { type: 'string', description: 'The question.' }
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
			const record = JSON.stringify({ ok: false, error: `unknown tool ${method}` })
			return Promise.resolve({ record, wire: `unknown tool ${method}` })
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
	 * A goal is unsatisfied when its proof fails — the provability check the
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

	// ------------------------------------------------------- execution engine

	/** Past runs, newest last, capped — the biography of executed goals. */
	#runs: Run[] = []

	runs(): Run[] {
		return [...this.#runs]
	}

	/**
	 * The execution engine, backward-chaining: what prove() plans, satisfy()
	 * RUNS. Same candidate order, same unification, same backtracking — but a
	 * chosen producer is now actually delivered a message, and a step that
	 * fails at runtime (structured error, dead handler, bad LLM output) sends
	 * the walk to the next producer of the same predicate, exactly like the
	 * static prover. The whole walk is recorded as a Run, step by step.
	 *
	 * Conventions, deliberately Prolog-shaped:
	 * - The handler named after a PRODUCED functor is the clause body: to make
	 *   `termin(T)` real, the chosen producer's `termin` handler runs.
	 * - Its payload is the outputs of its satisfied requirements, keyed by
	 *   their functor, over the caller-supplied external `facts`.
	 * - An actor declared `llm: true` with no such handler gets one synthesized
	 *   at receive time: manifest prose as instruction, payload in, JSON out.
	 *   No injected LLM = a structured step failure, not a throw.
	 */
	/**
	 * A run step IS a bus message — so it lands in the one biography too,
	 * carrying its run id. Runs and trace are the same events; the Runs list
	 * keeps only the payload detail (in/out) the flat trace does not.
	 */
	#recordStep(run: Run, step: RunStep): void {
		run.steps.push(step)
		this.#record({
			at: Date.now() - step.duration,
			kind: 'step',
			from: 'engine',
			to: step.actor ?? 'external',
			method: step.predicate,
			ok: step.ok,
			ms: step.duration,
			run: run.id
		})
	}

	async satisfy(goal: string, facts: Record<string, unknown> = {}): Promise<Run> {
		const run: Run = {
			id: `run_${nextRun++}`,
			goal,
			status: 'failed',
			startedAt: Date.now(),
			steps: []
		}
		const result = await this.#satisfyGoal(goal, facts, new Set(), {}, run)
		run.status = result.ok ? 'ok' : 'failed'
		this.#runs.push(run)
		if (this.#runs.length > 50) this.#runs.splice(0, this.#runs.length - 50)
		return run
	}

	async #satisfyGoal(
		goal: string,
		facts: Record<string, unknown>,
		visited: Set<string>,
		bindings: Bindings,
		run: Run
	): Promise<{ ok: boolean; out: unknown; bindings: Bindings }> {
		// Negation and cycles stay STATIC judgements — running p to learn that
		// not(p) holds would be absurd, and a cycle is satisfied by assumption.
		const naf = goal.trim().match(/^not\((.+)\)$/)
		if (naf) {
			const step = this.prove(goal, visited, bindings)
			return { ok: step.satisfied, out: {}, bindings }
		}
		const name = functor(goal)
		if (visited.has(name)) return { ok: true, out: {}, bindings }

		// Supplied facts are ground unit clauses and they win FIRST — exactly
		// Prolog's clause order. Without this, a calendar requiring utterance(U)
		// sent the engine off to "execute" the listener (its producer) instead
		// of taking the text the caller just typed as that very utterance.
		if (name in facts) {
			const out = (facts[name] as Record<string, unknown> | undefined) ?? {}
			this.#recordStep(run, {
				actor: null,
				predicate: goal,
				in: {},
				out,
				ok: true,
				duration: 0,
				attempt: 1
			})
			return { ok: true, out, bindings }
		}

		const candidates = this.actors()
			.map((a) => {
				const head = a.produces.find(
					(p) => unify(goal, rename(p, a.manifest.id), bindings) !== null
				)
				return head ? { actor: a, head: rename(head, a.manifest.id) } : null
			})
			.filter((c) => c !== null)

		if (candidates.length === 0) {
			const anyProducer = this.actors().some((a) => a.produces.some((p) => functor(p) === name))
			const out = (facts[name] as Record<string, unknown> | undefined) ?? {}
			this.#recordStep(run, {
				actor: null,
				predicate: goal,
				in: {},
				out,
				ok: !anyProducer,
				duration: 0,
				attempt: 1
			})
			// No producer at all → an external fact, its payload from `facts`.
			// A producer with clashing constants → a genuinely failed goal.
			return { ok: !anyProducer, out, bindings }
		}

		const nextVisited = new Set(visited)
		nextVisited.add(name)
		let attempt = 0
		for (const { actor, head } of candidates) {
			attempt++
			const headBindings = unify(goal, head, bindings)
			if (headBindings === null) continue
			let current = headBindings

			// Satisfy the requirements first — postorder, values flowing up.
			const payload: Record<string, unknown> = {}
			let childrenOk = true
			for (const r of actor.requires) {
				const child = await this.#satisfyGoal(
					rename(r, actor.manifest.id),
					facts,
					nextVisited,
					current,
					run
				)
				if (!child.ok) {
					childrenOk = false
					break
				}
				current = child.bindings
				payload[functor(r)] = child.out
			}
			if (!childrenOk) continue
			// A producer with no requirements gets the supplied facts wholesale —
			// otherwise the caller's input would evaporate before an llm actor
			// that declares no inputs ever sees it.
			if (actor.requires.length === 0) Object.assign(payload, facts)

			const started = Date.now()
			const executed = await this.execute(actor, name, payload)
			this.#recordStep(run, {
				actor: actor.manifest.id,
				predicate: goal,
				in: payload,
				out: executed.out,
				ok: executed.ok,
				duration: Date.now() - started,
				attempt
			})
			if (executed.ok) return { ok: true, out: executed.out, bindings: current }
			// Runtime backtracking: this producer failed for real — try the next.
		}
		return { ok: false, out: {}, bindings }
	}

	/**
	 * One step: deliver to the clause-body handler, or synthesize the llm one.
	 * Public because it is ALSO the direct lane: a record actor's generic
	 * `_add` executes its own actor here, bypassing candidate search — "add
	 * to THIS calendar" must never land on some other producer of the same
	 * functor.
	 */
	async execute(
		actor: Actor,
		method: string,
		payload: Record<string, unknown>
	): Promise<{ ok: boolean; out: unknown }> {
		if (actor.handles(method)) {
			const result = await actor.deliver(method, payload)
			let out: unknown = result.record
			let ok = true
			try {
				const parsed = JSON.parse(result.record)
				out = parsed
				ok = parsed?.ok !== false
			} catch {
				// non-JSON records count as fine, verbatim
			}
			return { ok, out }
		}
		const lane = llmSettings(actor.manifest)
		if (lane) {
			const llm = this.llmLane()
			if (!llm) {
				return { ok: false, out: { ok: false, error: 'no llm actor in the mesh' } }
			}
			const latest = keepsRecords(actor) ? actor.latestRecord?.() : undefined
			const system =
				`${manifestProse(actor.manifest)}\n` +
				`You ARE this actor, executing now: produce "${method}" from the input. ` +
				'Reply with EXACTLY one JSON object (no markdown) carrying your result. ' +
				'Keep it FLAT — short lowercase field names, no wrapper object.' +
				// Records that change shape every run render as chaos. The newest
				// record IS the schema: same fields, same names, every time.
				(latest !== undefined
					? ` Reuse EXACTLY the field names of this previous record: ${JSON.stringify(latest)}`
					: '')
			try {
				// The actor's own lane: its manifest picks model and sampling; the
				// json flag rides along so the server enforces object output.
				const answer = await llm(system, JSON.stringify(payload), { ...lane, json: true })
				// The membrane seam (0130): an actor whose logic exports
				// shape() parses the raw text INSIDE its sandbox — the host never
				// interprets model output for it. Malformed text = structured
				// failure, actor state untouched.
				if (shapesModelText(actor)) {
					const shaped = await actor.shapeModelText(answer)
					if (!shaped) throw new Error('the model answer did not shape into ops')
					return { ok: true, out: shaped as unknown as Record<string, unknown> }
				}
				const parsed = this.extractJson(answer)
				if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
				// The memory seam: a record-keeping actor remembers what it just
				// produced — running "make an appointment" IS filling the calendar.
				if (keepsRecords(actor)) actor.remember(parsed)
				return { ok: true, out: parsed }
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err)
				return { ok: false, out: { ok: false, error: `llm execution failed: ${reason}` } }
			}
		}
		return {
			ok: false,
			out: { ok: false, error: `${actor.manifest.id} has neither a handler nor llm:true` }
		}
	}
}

let nextRun = 0

/** One executed (or failed) step of a run — the proof tree, walked for real. */
export interface RunStep {
	/** The producing actor, or null for an external fact / unproducible goal. */
	actor: string | null
	predicate: string
	in: Record<string, unknown>
	out: unknown
	ok: boolean
	duration: number
	/** Which candidate producer this was — >1 means backtracking happened. */
	attempt: number
}

export interface Run {
	id: string
	goal: string
	status: 'ok' | 'failed'
	startedAt: number
	steps: RunStep[]
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
