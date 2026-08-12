import { getQuickJS, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten'

/**
 * The containment layer (0130): every actor's logic runs HERE, in a QuickJS
 * VM compiled to WASM — one path for browser dev and the native app alike.
 *
 * The VM's surface is empty by construction. There is no fetch, no require,
 * no process, no import, no timer — not because we removed them but because
 * a fresh QuickJS context never had them; what is not injected does not
 * exist. The host injects NOTHING in this slice (the fixed surface is the
 * evaluated logic itself), so the only way in or out is JSON across the
 * three entry points every vibe logic exports:
 *
 * - `initState(source)`  → the state the face first renders
 * - `reduce(state, ev)`  → the next state, for UI events and messages alike
 * - `shape(state, text)` → `{state?, ops?}` — the ONLY place raw model
 *   output is parsed; a malformed answer returns null and the host keeps
 *   its state untouched.
 *
 * Runaway logic is killed by fuel: an interrupt handler enforces a
 * wall-clock deadline per call, and the runtime carries a memory cap.
 */

export interface VibeEvent {
	send: string
	payload?: Record<string, unknown>
}

export interface ShapeResult {
	/** Replacement state, when the model output changed it. */
	state?: Record<string, unknown>
	/** Validated operations for the host to apply — never raw model text. */
	ops?: unknown[]
}

/**
 * What one reduction yields. Plain-state returns stay valid (a reducer may
 * just return the next state); a full return also SPEAKS: `said` is the
 * wire sentence for the model, `record` the structured result fragment —
 * both authored in the sandbox, so the host carries zero behaviour
 * knowledge, not even the words.
 */
export interface ReduceOutcome {
	state: Record<string, unknown>
	said?: string
	record?: Record<string, unknown>
}

/** Wall-clock budget per call into the VM; a spinning reducer dies here. */
const FUEL_MS = 250
/** Heap cap per session — vibe logic is state shaping, not data science. */
const MEMORY_LIMIT = 32 * 1024 * 1024

export class SandboxError extends Error {}

/**
 * One actor's logic, resident in its own context: evaluated once, then
 * called through JSON until `dispose`. Sessions are cheap; contexts share
 * the module but nothing else.
 */
export class VibeSession {
	#runtime: QuickJSRuntime
	#vm: QuickJSContext
	#deadline = 0
	#disposed = false

	constructor(runtime: QuickJSRuntime, vm: QuickJSContext) {
		this.#runtime = runtime
		this.#vm = vm
	}

	initState(source: Record<string, unknown>): Record<string, unknown> {
		const out = this.#call(`initState(${JSON.stringify(source)})`)
		return this.#object(out, 'initState')
	}

	reduce(state: Record<string, unknown>, event: VibeEvent): ReduceOutcome {
		const out = this.#object(
			this.#call(
				`reduce(${JSON.stringify(state)}, ${JSON.stringify({ send: event.send, payload: event.payload ?? {} })})`
			),
			'reduce'
		)
		// Normalize both shapes: a full outcome carries `state`; a bare next
		// state IS the state.
		if (out.state && typeof out.state === 'object' && !Array.isArray(out.state)) {
			return {
				state: out.state as Record<string, unknown>,
				...(typeof out.said === 'string' && { said: out.said }),
				...(out.record && typeof out.record === 'object'
					? { record: out.record as Record<string, unknown> }
					: {})
			}
		}
		return { state: out }
	}

	/**
	 * Model text goes IN as an opaque string and comes back as structured
	 * data or null — parsing happens behind the membrane, so a model that
	 * answers garbage can corrupt nothing but its own return value.
	 */
	shape(state: Record<string, unknown>, rawText: string): ShapeResult | null {
		const out = this.#call(`shape(${JSON.stringify(state)}, ${JSON.stringify(rawText)})`)
		if (out === null || out === undefined) return null
		if (typeof out !== 'object') return null
		return out as ShapeResult
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#vm.dispose()
		this.#runtime.dispose()
	}

	/** Evaluate one expression under fuel, marshal the result out as JSON. */
	#call(expression: string): unknown {
		if (this.#disposed) throw new SandboxError('session is disposed')
		this.#deadline = Date.now() + FUEL_MS
		const result = this.#vm.evalCode(
			`JSON.stringify((function(){ return (${expression}) })() ?? null)`
		)
		if (result.error) {
			const reason = this.#vm.dump(result.error)
			result.error.dispose()
			throw new SandboxError(
				typeof reason === 'object' && reason !== null && 'message' in reason
					? String((reason as { message: unknown }).message)
					: String(reason)
			)
		}
		const json = this.#vm.getString(result.value)
		result.value.dispose()
		return json === 'undefined' ? undefined : JSON.parse(json)
	}

	#object(value: unknown, entry: string): Record<string, unknown> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new SandboxError(`${entry} must return an object, got ${JSON.stringify(value)}`)
		}
		return value as Record<string, unknown>
	}

	/** The fuel gauge, read by the runtime's interrupt handler. */
	get deadline(): number {
		return this.#deadline
	}

	/** Arm the fuel before an evaluation the session did not start itself. */
	arm(): void {
		this.#deadline = Date.now() + FUEL_MS
	}

	/**
	 * Run the VM's pending promise jobs (under fuel). There is no module
	 * loader and no host promise ever enters, so this exists mainly to let
	 * tests observe that a dynamic import REJECTS instead of loading.
	 */
	pump(): void {
		this.arm()
		this.#runtime.executePendingJobs()
	}
}

/**
 * Evaluate a vibe's logic in a fresh, empty VM and hand back the session.
 * Throws when the logic itself fails to evaluate (syntax error, top-level
 * crash) — a broken face never reaches the window.
 */
export async function createSession(logic: string): Promise<VibeSession> {
	const quickjs = await getQuickJS()
	const runtime = quickjs.newRuntime()
	runtime.setMemoryLimit(MEMORY_LIMIT)
	const vm = runtime.newContext()
	const session = new VibeSession(runtime, vm)
	// The interrupt handler is the fuel: called by the engine mid-execution,
	// returning true aborts the current evaluation.
	runtime.setInterruptHandler(() => Date.now() > session.deadline)
	session.arm()
	const evaluated = vm.evalCode(logic)
	if (evaluated.error) {
		const reason = vm.dump(evaluated.error)
		evaluated.error.dispose()
		session.dispose()
		throw new SandboxError(
			typeof reason === 'object' && reason !== null && 'message' in reason
				? String((reason as { message: unknown }).message)
				: String(reason)
		)
	}
	evaluated.value.dispose()
	return session
}
