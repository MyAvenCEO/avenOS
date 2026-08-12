import { describe, expect, test } from 'bun:test'
import { createSession, SandboxError } from '../src/lib/actors/sandbox'

/**
 * The 0130 proof, slice A: the containment layer itself.
 *
 * Actor logic runs in a QuickJS WASM VM whose surface is EMPTY — host
 * ambient authority (fetch, require, process, dynamic import) does not
 * exist inside, a spinning reducer dies by fuel, and raw model text is
 * parsed only behind the membrane (shape), so a lying model can corrupt
 * nothing but its own return value.
 */

const COUNTER_LOGIC = `
function initState(source) {
	return { count: Number(source.start) || 0, label: String(source.label || 'counter') }
}
function reduce(state, ev) {
	if (ev.send === 'INC') return Object.assign({}, state, { count: state.count + 1 })
	if (ev.send === 'ADD') return Object.assign({}, state, { count: state.count + Number(ev.payload.n || 0) })
	return state
}
function shape(state, rawText) {
	var parsed
	try { parsed = JSON.parse(rawText) } catch (e) { return null }
	if (!parsed || typeof parsed !== 'object' || typeof parsed.count !== 'number') return null
	return { state: Object.assign({}, state, { count: parsed.count }), ops: [{ op: 'set', count: parsed.count }] }
}
`

describe('vibe sandbox (0130 slice A)', () => {
	test('initState derives the rendered state from source', async () => {
		const session = await createSession(COUNTER_LOGIC)
		try {
			expect(session.initState({ start: 4, label: 'Habits' })).toEqual({
				count: 4,
				label: 'Habits'
			})
		} finally {
			session.dispose()
		}
	})

	test('reduce is the one state transition for UI events and messages alike', async () => {
		const session = await createSession(COUNTER_LOGIC)
		try {
			const s0 = session.initState({ start: 0 })
			const s1 = session.reduce(s0, { send: 'INC' })
			const s2 = session.reduce(s1, { send: 'ADD', payload: { n: 40 } })
			expect(s2.count).toBe(41)
			// unknown events are a no-op, never a crash
			expect(session.reduce(s2, { send: 'NOPE' }).count).toBe(41)
		} finally {
			session.dispose()
		}
	})

	test('fail-closed: fetch, require, process and dynamic import do not exist', async () => {
		const session = await createSession(`
			function initState() { return {} }
			function reduce(state, ev) {
				if (ev.send === 'FETCH') fetch('https://example.com')
				if (ev.send === 'REQUIRE') require('node:fs')
				if (ev.send === 'PROCESS') process.exit(1)
				if (ev.send === 'IMPORT') {
					import('node:fs').then(
						function () { importOutcome = 'loaded' },
						function () { importOutcome = 'rejected' }
					)
				}
				if (ev.send === 'CHECK') return { importOutcome: importOutcome }
				return state
			}
			var importOutcome = 'pending'
		`)
		try {
			for (const send of ['FETCH', 'REQUIRE', 'PROCESS']) {
				expect(() => session.reduce({}, { send })).toThrow(SandboxError)
			}
			// dynamic import: no module loader exists, so the promise REJECTS —
			// a module can never actually arrive
			session.reduce({}, { send: 'IMPORT' })
			session.pump()
			expect(session.reduce({}, { send: 'CHECK' })).toEqual({ importOutcome: 'rejected' })
			// the Function-constructor escape reaches only the VM's own globals,
			// where fetch still does not exist
			const probe = await createSession(`
				function initState() { return {} }
				function reduce(state) {
					var g = globalThis.constructor && globalThis.constructor.constructor
						? globalThis.constructor.constructor('return this')()
						: globalThis
					return { hasFetch: typeof g.fetch, hasProcess: typeof g.process }
				}
			`)
			try {
				expect(probe.reduce({}, { send: 'X' })).toEqual({
					hasFetch: 'undefined',
					hasProcess: 'undefined'
				})
			} finally {
				probe.dispose()
			}
		} finally {
			session.dispose()
		}
	})

	test('a while(true) reducer is killed by fuel', async () => {
		const session = await createSession(`
			function initState() { return {} }
			function reduce(state, ev) { while (true) {} }
		`)
		try {
			const before = Date.now()
			expect(() => session.reduce({}, { send: 'SPIN' })).toThrow()
			// the deadline is a quarter second — well under a hung test runner
			expect(Date.now() - before).toBeLessThan(2000)
		} finally {
			session.dispose()
		}
	})

	test('broken logic never becomes a session', async () => {
		await expect(createSession('function initState( {')).rejects.toThrow(SandboxError)
	})

	test('shape parses model text behind the membrane; garbage returns null', async () => {
		const session = await createSession(COUNTER_LOGIC)
		try {
			const state = session.initState({ start: 1 })
			// a well-formed model answer becomes structured ops + state
			const good = session.shape(state, '{"count": 9}')
			expect(good?.state?.count).toBe(9)
			expect(good?.ops).toEqual([{ op: 'set', count: 9 }])
			// malformed model output yields null — the HOST state is whatever it
			// was; nothing threw, nothing mutated
			expect(session.shape(state, 'I apologize, as an AI I cannot…')).toBeNull()
			expect(session.shape(state, '{"count": "NaN-ish"}')).toBeNull()
			expect(state.count).toBe(1)
		} finally {
			session.dispose()
		}
	})
})
