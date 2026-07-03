import { getQuickJS, type QuickJSContext } from 'quickjs-emscripten'

// board 0111 — the ONE behavior model: an actor's `code` is a QuickJS module `handle(msg, caps, ctx)`
// executed in a QuickJS-in-WASM sandbox with NO ambient authority. The VM has no fetch, no filesystem, no
// require/import, no network, no host globals — ONLY the capabilities the host injects by name (built from
// the actor row's `caps`). A call to anything ungranted is a plain error; a runaway loop is killed by the
// interrupt deadline; memory is capped. Fail-closed: the sandbox can only message the caps it was handed.
// Everything crosses the boundary as JSON, so no host object reference ever leaks into (or out of) the VM.
//
// Slice 1 (this card) proves the security boundary with SYNCHRONOUS caps. Async caps (a DB `ops` call that
// suspends the VM) need the asyncify variant and are the todos-port slice — see the card.

/** A capability = a host function the sandbox may call by name. Args + return marshal as JSON. */
export type Caps = Record<string, (...args: unknown[]) => unknown>

export type SandboxOptions = {
	/** wall-clock budget; a longer-running script is interrupted (fuel). */
	deadlineMs?: number
	/** hard memory ceiling for the VM. */
	memoryBytes?: number
}

const DEFAULT_DEADLINE_MS = 3000
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
	const QuickJS = await getQuickJS()
	const vm: QuickJSContext = QuickJS.newContext()
	const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS)
	vm.runtime.setInterruptHandler(() => Date.now() > deadline)
	vm.runtime.setMemoryLimit(opts.memoryBytes ?? DEFAULT_MEMORY)
	try {
		// Inject the caps as an object of host functions: each takes ONE JSON-string arg (the args array) and
		// returns a JSON-string result. Only these names exist on `__caps`; anything else is `undefined`.
		const capsObj = vm.newObject()
		for (const [name, fn] of Object.entries(caps)) {
			const f = vm.newFunction(name, (argHandle) => {
				const args = JSON.parse(vm.getString(argHandle)) as unknown[]
				return vm.newString(JSON.stringify(fn(...args) ?? null))
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
		const res = vm.evalCode(wrapper)
		if (res.error) {
			const e = vm.dump(res.error)
			res.error.dispose()
			throw new Error(`[sandbox] ${errText(e)}`)
		}
		// `handle` may be async → the wrapper returns a Promise; drain the job queue and read its state.
		const promiseHandle = res.value
		vm.runtime.executePendingJobs()
		const state = vm.getPromiseState(promiseHandle)
		promiseHandle.dispose()
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
		// still pending after draining jobs → an unresolved await (a real async cap; slice 2 / asyncify).
		throw new Error('[sandbox] actor did not settle — an unresolved async await (async caps land in the todos-port slice)')
	} finally {
		vm.dispose()
	}
}
