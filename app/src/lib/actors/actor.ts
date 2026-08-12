/**
 * The one primitive. Everything above this file is composition.
 *
 * An actor is an id, a manifest, private state, and handlers — the classic
 * Hewitt shape, Abject-flavored (abject.world), local-only. Two ideas carried
 * over deliberately:
 *
 * - **Messaging is the design surface.** Actors interact only through
 *   envelopes on the bus; the model's tool calls, the UI's clicks and (later)
 *   other machines are just different senders.
 * - **ask() is the one LLM-touching handler.** Every actor can be interviewed
 *   in natural language and answers *as itself*, from its own manifest and
 *   state. Ordinary messages stay deterministic. Without an LLM available the
 *   answer degrades to manifest prose — the cheap answer, never no answer.
 *
 * Contracts are Prolog-flavored: methods (and the actor itself) declare
 * `requires` / `produces` predicates like `work(M, Spark)`. Nothing is wired
 * by hand — the flow graph is DERIVED by unifying produces against requires
 * ("compression, not abstraction": a stored flow template would freeze a
 * judgment; the derivation regenerates with the registry).
 */

import type { StyleDef, ViewDef } from '@avenos/aven-ui'

/** A predicate as written in a contract: `mail(M)`, `intent(M, Class)`. */
export type Predicate = string

/**
 * A vibe: the actor's face as pure data + sandboxed behaviour (0130).
 *
 * `view`/`style` are validated JSON the aven-ui engine renders into a shadow
 * root; `logic` is the QuickJS-sandboxed program exporting
 * `initState`/`reduce`/`shape`; `source` seeds the initial state. The actor
 * paints its own face — the host renders, never interprets.
 */
export interface VibeSpec {
	view: ViewDef
	style: StyleDef
	/** Seed data handed to the logic's initState; defaults to {}. */
	source?: Record<string, unknown>
	/** The sandboxed program. Shared across an actor's vibes via the manifest. */
	logic: string
}

/** `mail(M)` → `mail` — predicates unify on their functor name. */
export function functor(p: Predicate): string {
	const at = p.indexOf('(')
	return (at === -1 ? p : p.slice(0, at)).trim()
}

export interface MethodSpec {
	name: string
	description: string
	/** JSON schema for the arguments, exactly what the LLM tool layer wants. */
	parameters: Record<string, unknown>
	requires?: Predicate[]
	produces?: Predicate[]
	/**
	 * Declared behaviour (0130): the tool call IS this event into the actor's
	 * sandboxed reducer — payload passes through verbatim. With it, no handler
	 * is written by hand: ONE generic adapter serves every declared method,
	 * and the method doubles as the Prolog clause body for its `produces`.
	 */
	event?: { send: string }
}

/** Per-actor model lane: which model answers as this actor, and how. */
export interface LlmSettings {
	/** Model id; unset = the app's default execution model. */
	model?: string
	temperature?: number
}

/**
 * The memory seam: an actor that keeps records. The engine calls `remember`
 * with each successful llm-execution output, so running "make an appointment"
 * IS what fills the calendar. Duck-typed so the bus needs no import of any
 * concrete class.
 */
export interface RecordKeeper {
	remember(out: unknown): void
	/** The newest record's data, if any — the shape template for the next run. */
	latestRecord?(): unknown
}

export function keepsRecords(actor: Actor): actor is Actor & RecordKeeper {
	return typeof (actor as Partial<RecordKeeper>).remember === 'function'
}

/**
 * The membrane seam (0130): an actor whose sandboxed logic exports shape()
 * parses raw model text ITSELF — the host hands the string in and receives
 * structured ops or null, never interpreting the text. Duck-typed like the
 * record seam.
 */
export interface ModelTextShaper {
	shapeModelText(rawText: string): { state?: Record<string, unknown>; ops?: unknown[] } | null
}

export function shapesModelText(actor: Actor): actor is Actor & ModelTextShaper {
	return typeof (actor as Partial<ModelTextShaper>).shapeModelText === 'function'
}

export interface Manifest {
	id: string
	name: string
	description: string
	/** Display grouping — a "flow" is a tag, not a stored thing. */
	tags: string[]
	methods: MethodSpec[]
	/** Actor-level contracts, for actors whose role is one transformation. */
	requires?: Predicate[]
	produces?: Predicate[]
	/**
	 * Declared LLM actor: its description becomes its instruction (board
	 * 0129). `true` = default lane; an object picks the model and sampling
	 * for THIS actor — a careful worker may pin a slower model while a
	 * summarizer stays on the fast lane, each declared in its own manifest.
	 */
	llm?: boolean | LlmSettings
	/**
	 * The actor's face as a vibe (0130): validated view/style JSON rendered
	 * by aven-ui, behaviour sandboxed in QuickJS — the actor paints its own
	 * face, the host only renders.
	 */
	vibe?: VibeSpec
	/**
	 * Additional named vibes — the workitems pattern (list + board over one
	 * subject): each entry becomes its OWN window over the SAME actor.
	 */
	vibes?: { key: string; name: string; spec: VibeSpec }[]
}

/** The declared model lane, normalized: null when the actor is not an llm actor. */
export function llmSettings(m: Manifest): LlmSettings | null {
	if (m.llm === true) return {}
	if (m.llm && typeof m.llm === 'object') return m.llm
	return null
}

/** What a handler gives back: a record for the UI, prose for the model. */
export interface HandlerResult {
	record: string
	wire: string
}

export type Handler = (payload: Record<string, unknown>) => HandlerResult | Promise<HandlerResult>

/**
 * The natural-language service an ask() consults; injected, never imported.
 * `json` rides along on machine lanes (llm-actor execution) so the transport
 * can enforce object output; ask() leaves it unset and gets prose.
 */
export type Llm = (
	system: string,
	question: string,
	settings?: LlmSettings & { json?: boolean }
) => Promise<string>

/** The manifest, spoken — the fallback self-description and the LLM's context. */
export function manifestProse(m: Manifest): string {
	const contracts = (spec: { requires?: Predicate[]; produces?: Predicate[] }) => {
		const parts: string[] = []
		if (spec.requires?.length) parts.push(`requires ${spec.requires.join(', ')}`)
		if (spec.produces?.length) parts.push(`produces ${spec.produces.join(', ')}`)
		return parts.length > 0 ? ` (${parts.join('; ')})` : ''
	}
	const methods =
		m.methods.length > 0
			? ` Methods: ${m.methods.map((x) => `${x.name} — ${x.description}${contracts(x)}`).join(' · ')}`
			: ''
	return `I am ${m.name} (${m.id}). ${m.description}${contracts(m)}.${methods}`
}

export class Actor {
	readonly manifest: Manifest
	#handlers: Record<string, Handler>
	/** Supervision bookkeeping: how often handlers died, and the last reason. */
	failures = 0
	lastError: string | null = null

	constructor(manifest: Manifest, handlers: Record<string, Handler> = {}) {
		this.manifest = manifest
		this.#handlers = handlers
	}

	/** Every contract this actor participates in, method- and actor-level, deduped. */
	get requires(): Predicate[] {
		return [
			...new Set([
				...(this.manifest.requires ?? []),
				...this.manifest.methods.flatMap((m) => m.requires ?? [])
			])
		]
	}

	get produces(): Predicate[] {
		return [
			...new Set([
				...(this.manifest.produces ?? []),
				...this.manifest.methods.flatMap((m) => m.produces ?? [])
			])
		]
	}

	/**
	 * Late-bound handlers, for subclasses whose handlers close over `this` —
	 * class fields are not initialized yet when super() runs.
	 */
	protected bind(handlers: Record<string, Handler>): void {
		Object.assign(this.#handlers, handlers)
	}

	handles(method: string): boolean {
		return method in this.#handlers
	}

	/**
	 * The handler's actual source — derived from the running function, never
	 * stored ("compression, not abstraction"): change the handler and the
	 * next read changes with it. This is the Abject move of answering from
	 * one's own code, minus the LLM.
	 */
	handlerSource(method: string): string | null {
		const handler = this.#handlers[method]
		return handler ? handler.toString() : null
	}

	/** Messages waiting in the mailbox right now. */
	get pending(): number {
		return this.#mailbox.length
	}

	/**
	 * The mailbox: messages are processed strictly one at a time, in arrival
	 * order — the actor-model guarantee that makes per-actor reasoning local.
	 * Ordinary messages stay deterministic (no LLM anywhere in this path); a
	 * handler that throws is contained as a structured error result and the
	 * mailbox keeps pumping.
	 */
	#mailbox: {
		method: string
		payload: Record<string, unknown>
		resolve: (r: HandlerResult) => void
	}[] = []
	#pumping = false

	deliver(method: string, payload: Record<string, unknown>): Promise<HandlerResult> {
		return new Promise((resolve) => {
			this.#mailbox.push({ method, payload, resolve })
			void this.#pump()
		})
	}

	async #pump(): Promise<void> {
		if (this.#pumping) return
		this.#pumping = true
		try {
			while (this.#mailbox.length > 0) {
				const message = this.#mailbox.shift()
				if (!message) break
				message.resolve(await this.#handle(message.method, message.payload))
			}
		} finally {
			this.#pumping = false
		}
	}

	async #handle(method: string, payload: Record<string, unknown>): Promise<HandlerResult> {
		const handler = this.#handlers[method]
		if (!handler) {
			const record = JSON.stringify({
				ok: false,
				error: `${this.manifest.id} does not know ${method}`
			})
			return { record, wire: `${this.manifest.id} does not know ${method}` }
		}
		// Supervision as backtracking, the runtime half: a handler that throws
		// gets one fresh attempt — the Erlang restart in miniature. Only after
		// the retry also dies is the failure recorded and returned as a
		// structured result; ok:false results are answers, not crashes, and are
		// never retried.
		for (let attempt = 0; ; attempt++) {
			try {
				return await handler(payload)
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err)
				if (attempt === 0) continue
				this.failures++
				this.lastError = `${method}: ${reason}`
				const record = JSON.stringify({ ok: false, error: `${method} failed: ${reason}` })
				return { record, wire: `${method} failed: ${reason}` }
			}
		}
	}

	/**
	 * The interview. Answers as itself from its own manifest (and whatever the
	 * subclass adds via `situation()`); the LLM is consulted when one is given
	 * and the manifest prose stands in when not. Caller-aware per the Ask
	 * Protocol: the answer may depend on WHO asks — a fellow actor gets
	 * protocol detail where a human gets orientation.
	 */
	async ask(question: string, llm?: Llm, asker?: string): Promise<string> {
		const self = manifestProse(this.manifest)
		const state = this.situation()
		const context = state ? `${self} Current state: ${state}` : self
		if (!llm) return context
		return llm(
			`You are the actor "${this.manifest.name}" in avenOS, answering as yourself, ` +
				'briefly, in the language of the question. ' +
				(asker
					? `You are being asked by "${asker}" — tailor the answer to them: a human wants ` +
						'orientation, a fellow actor or the chat model wants exact method names and ' +
						'payload shapes to collaborate. '
					: '') +
				`Everything you know about yourself: ${context}`,
			question
		)
	}

	/** Live state, in words, for ask(). Subclasses override; default: nothing. */
	protected situation(): string {
		return ''
	}

	/**
	 * The template/instance split, made explicit. The manifest is the CLASS —
	 * the timeless contract: what this kind of actor is, does, requires and
	 * produces. `instanceState()` is the INSTANCE — what this particular
	 * running one holds right now. Stubs return null: they are templates that
	 * no execution has instantiated yet.
	 */
	instanceState(): Record<string, unknown> | null {
		return null
	}
}
