import { Actor, functor, type Manifest } from './actor'
import {
	type Capability,
	createSession,
	type ReduceOutcome,
	type VibeEvent,
	type VibeSession
} from './sandbox'

/**
 * The vibe actor: an actor whose ENTIRE behaviour is its sandboxed logic —
 * the unification the explorer made obvious (0130).
 *
 * Three formerly separate mechanisms are one primitive here:
 *
 * - **State machine**: `reduce(state, event)` in the QuickJS VM is the only
 *   transition; `vibeState` is merely its latest result, mirrored for the
 *   windows.
 * - **Tool adapters**: a method whose spec declares `event` needs no
 *   hand-written handler — ONE generic adapter maps the tool payload
 *   verbatim into the event and returns what the sandbox SAID (`said` as
 *   the wire, `record` as the structured result). The host carries zero
 *   behaviour knowledge, not even the words.
 * - **Prolog clause**: the same declared method doubles as the clause body
 *   for its `produces` — it is ALSO bound under the produced functor, so
 *   the engine's backward chaining (`satisfy('workitem(W)')`) lands in the
 *   same sandboxed reduce as a voice tool call or a UI click.
 *
 * Subclasses `declare vibeState` and choose its storage — the Svelte layer
 * uses `$state` for reactivity; tests use a plain field. The base never
 * initializes the field (that would shadow a subclass accessor).
 */
export class VibeActor extends Actor {
	declare vibeState: Record<string, unknown>
	#session: VibeSession | null = null
	#ready: Promise<void>

	constructor(manifest: Manifest, caps: Record<string, Capability> = {}) {
		super(manifest, {})
		this.#ready = this.#boot(manifest, caps)
		// The generic adapter, bound for every declared method — and again
		// under the produced functor, which makes it the engine's clause body.
		for (const method of manifest.methods) {
			const send = method.event?.send
			if (!send) continue
			const adapter = (p: Record<string, unknown>) => this.#adapt(send, p)
			this.bind({ [method.name]: adapter })
			const produced = method.produces?.[0]
			if (produced && !this.handles(functor(produced))) {
				this.bind({ [functor(produced)]: adapter })
			}
		}
	}

	async #boot(manifest: Manifest, caps: Record<string, Capability>): Promise<void> {
		const logic = manifest.vibe?.logic
		if (!logic) return
		// Fail-closed grants: the session receives EXACTLY the declared and
		// provided capabilities — an undeclared name never enters the VM.
		const granted = Object.fromEntries(
			(manifest.capabilities ?? []).flatMap((name) => (caps[name] ? [[name, caps[name]]] : []))
		)
		this.#session = await createSession(logic, granted)
		this.vibeState = await this.#session.initState(manifest.vibe?.source ?? {})
	}

	/**
	 * The one door for every state change — UI events, voice tools and the
	 * proof engine all land here, so the paths cannot drift apart.
	 */
	async applyEvent(event: VibeEvent): Promise<ReduceOutcome> {
		await this.#ready
		if (!this.#session) throw new Error(`${this.manifest.id} has no vibe session`)
		const outcome = await this.#session.reduce(this.vibeState, event)
		this.vibeState = outcome.state
		return outcome
	}

	/**
	 * The membrane seam: raw model text is parsed by the SANDBOXED shape(),
	 * never by the host. Garbage returns null and the state stays exactly
	 * what it was.
	 */
	async shapeModelText(
		rawText: string
	): Promise<{ state?: Record<string, unknown>; ops?: unknown[] } | null> {
		await this.#ready
		if (!this.#session) return null
		const shaped = await this.#session.shape(this.vibeState, rawText)
		if (shaped?.state) this.vibeState = shaped.state
		return shaped
	}

	/** Tool payload → event, verbatim; the sandbox answers with words and data. */
	async #adapt(send: string, payload: Record<string, unknown>) {
		const outcome = await this.applyEvent({ send, payload })
		const record = outcome.record ?? { ok: true }
		return {
			record: JSON.stringify('ok' in record ? record : { ok: true, ...record }),
			wire: outcome.said ?? JSON.stringify(record)
		}
	}
}
