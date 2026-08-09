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

/** A predicate as written in a contract: `mail(M)`, `intent(M, Class)`. */
export type Predicate = string

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
}

/** What a handler gives back: a record for the UI, prose for the model. */
export interface HandlerResult {
	record: string
	wire: string
}

export type Handler = (payload: Record<string, unknown>) => HandlerResult | Promise<HandlerResult>

/** The natural-language service an ask() consults; injected, never imported. */
export type Llm = (system: string, question: string) => Promise<string>

/** The manifest, spoken — the fallback self-description and the LLM's context. */
export function manifestProse(m: Manifest): string {
	const contracts = (spec: { requires?: Predicate[]; produces?: Predicate[] }) => {
		const parts: string[] = []
		if (spec.requires?.length) parts.push(`braucht ${spec.requires.join(', ')}`)
		if (spec.produces?.length) parts.push(`erzeugt ${spec.produces.join(', ')}`)
		return parts.length > 0 ? ` (${parts.join('; ')})` : ''
	}
	const methods =
		m.methods.length > 0
			? ` Methoden: ${m.methods.map((x) => `${x.name} — ${x.description}${contracts(x)}`).join(' · ')}`
			: ''
	return `Ich bin ${m.name} (${m.id}). ${m.description}${contracts(m)}.${methods}`
}

export class Actor {
	readonly manifest: Manifest
	#handlers: Record<string, Handler>

	constructor(manifest: Manifest, handlers: Record<string, Handler> = {}) {
		this.manifest = manifest
		this.#handlers = handlers
	}

	/** Every contract this actor participates in, method- and actor-level. */
	get requires(): Predicate[] {
		return [
			...(this.manifest.requires ?? []),
			...this.manifest.methods.flatMap((m) => m.requires ?? [])
		]
	}

	get produces(): Predicate[] {
		return [
			...(this.manifest.produces ?? []),
			...this.manifest.methods.flatMap((m) => m.produces ?? [])
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
				error: `${this.manifest.id} kennt ${method} nicht`
			})
			return { record, wire: `${this.manifest.id} kennt ${method} nicht` }
		}
		try {
			return await handler(payload)
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err)
			const record = JSON.stringify({ ok: false, error: `${method} scheiterte: ${reason}` })
			return { record, wire: `${method} scheiterte: ${reason}` }
		}
	}

	/**
	 * The interview. Answers as itself from its own manifest (and whatever the
	 * subclass adds via `situation()`); the LLM is consulted when one is given
	 * and the manifest prose stands in when not.
	 */
	async ask(question: string, llm?: Llm): Promise<string> {
		const self = manifestProse(this.manifest)
		const state = this.situation()
		const context = state ? `${self} Aktueller Zustand: ${state}` : self
		if (!llm) return context
		return llm(
			`Du bist der Actor "${this.manifest.name}" in avenOS und antwortest als du selbst, ` +
				`knapp und auf Deutsch. Alles was du über dich weißt: ${context}`,
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
