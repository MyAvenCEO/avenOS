import { newAsyncContext, type QuickJSAsyncContext } from 'quickjs-emscripten'

// board 0111 — the ONE behavior model: an actor's `code` is a QuickJS module `handle(msg, caps, ctx)`
// executed in a QuickJS-in-WASM sandbox with NO ambient authority. The VM has no fetch, no filesystem, no
// require/import, no network, no host globals — ONLY the capabilities the host injects by name (built from
// the actor row's `caps`). A call to anything ungranted is a plain error; a runaway loop is killed by the
// interrupt deadline; memory is capped. Fail-closed: the sandbox can only message the caps it was handed.
// Everything crosses the boundary as JSON, so no host object reference ever leaks into (or out of) the VM.
//
// Caps may be ASYNC (a DB `ops` call): the async context + asyncified host functions suspend the VM while
// the host promise settles, so `await caps.ops(...)` inside the actor works transparently.

/** A capability = a (possibly async) host function the sandbox may call by name. Args + return are JSON. */
export type Caps = Record<string, (...args: unknown[]) => unknown | Promise<unknown>>

export type SandboxOptions = {
	/** wall-clock budget; a longer-running script is interrupted (fuel). */
	deadlineMs?: number
	/** hard memory ceiling for the VM. */
	memoryBytes?: number
}

const DEFAULT_DEADLINE_MS = 5000
const DEFAULT_MEMORY = 32 * 1024 * 1024

const errText = (e: unknown): string =>
	typeof e === 'object' && e
		? ((e as { message?: string }).message ?? JSON.stringify(e))
		: String(e)

/**
 * Run an actor's `code` (an ES snippet defining `handle(msg, caps, ctx)`, sync or async) in the sandbox and
 * return its JSON result. `caps` is the ONLY authority the code gets. Throws if the code throws, calls an
 * ungranted capability, references a non-existent global (fetch/require/process/…), or blows the fuel/memory.
 */
export async function runActorCode(
	code: string,
	msg: unknown,
	caps: Caps,
	ctxData: Record<string, unknown> = {},
	opts: SandboxOptions = {}
): Promise<unknown> {
	const vm: QuickJSAsyncContext = await newAsyncContext()
	const fuelMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS
	// fuel is PER VM SLICE: each await of a host cap refuels, so an actor doing several sequential DB
	// calls isn't killed by wall-clock spent WAITING on the host — only runaway VM execution is.
	let deadline = Date.now() + fuelMs
	vm.runtime.setInterruptHandler(() => Date.now() > deadline)
	vm.runtime.setMemoryLimit(opts.memoryBytes ?? DEFAULT_MEMORY)
	try {
		// Inject the caps as an object of ASYNCIFIED host functions: each takes ONE JSON-string arg (the args
		// array) and returns a JSON-string result. asyncify suspends the VM while an async host fn (a DB call)
		// settles. Only these names exist on `__caps`; anything else is `undefined`.
		const capsObj = vm.newObject()
		for (const [name, fn] of Object.entries(caps)) {
			const f = vm.newAsyncifiedFunction(name, async (argHandle) => {
				const args = JSON.parse(vm.getString(argHandle)) as unknown[]
				const out = JSON.stringify((await fn(...args)) ?? null)
				deadline = Date.now() + fuelMs // refuel: the wait was host time, not VM time
				return vm.newString(out)
			})
			vm.setProp(capsObj, name, f)
			f.dispose()
		}
		vm.setProp(vm.global, '__caps', capsObj)
		capsObj.dispose()

		for (const [g, val] of [
			['__msgJson', msg ?? null],
			['__ctxJson', ctxData ?? {}]
		] as const) {
			const h = vm.newString(JSON.stringify(val))
			vm.setProp(vm.global, g, h)
			h.dispose()
		}

		// `caps` in the VM JSON-marshals args + results around the host functions. Calling an ungranted name
		// hits `__caps[name]` === undefined → a TypeError → the handle rejects → we throw (fail-closed).
		const wrapper = `
			const caps = new Proxy({}, {
				get: (_t, name) => (...args) => JSON.parse(__caps[name](JSON.stringify(args)))
			});
			${code}
			;(async () => JSON.stringify((await handle(JSON.parse(__msgJson), caps, JSON.parse(__ctxJson))) ?? null))()
		`
		const res = await vm.evalCodeAsync(wrapper)
		if (res.error) {
			const e = vm.dump(res.error)
			res.error.dispose()
			throw new Error(`[sandbox] ${errText(e)}`)
		}
		// ASYNCIFY CONTRACT (board 0117, learned the hard way): a host cap can only suspend the VM
		// during the MAIN eval. A cap call inside a promise CONTINUATION (i.e. after an `await`) is
		// unsupported — pumping executePendingJobs across a suspension corrupts the WASM ("Out of
		// bounds memory access"). Therefore actor code calls caps SYNCHRONOUSLY (they block via
		// asyncify — any number of calls) and the single drain below only unwraps the final value;
		// legacy `async handle` with ONE trailing await still settles on this drain.
		vm.runtime.executePendingJobs()
		const state = vm.getPromiseState(res.value)
		res.value.dispose()
		if (state.type === 'fulfilled') {
			const s = vm.getString(state.value)
			state.value.dispose()
			return JSON.parse(s)
		}
		if (state.type === 'rejected') {
			const e = vm.dump(state.error)
			state.error.dispose()
			throw new Error(`[sandbox] ${errText(e)}`)
		}
		throw new Error(
			'[sandbox] actor did not settle — a caps call happened AFTER an await; write handle as a PLAIN SYNCHRONOUS function (caps.ops() returns directly)'
		)
	} finally {
		vm.dispose()
	}
}
