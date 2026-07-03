import { describe, expect, test } from 'bun:test'
import { runActorCode } from '../src/actor-sandbox'

// board 0111 — the actor sandbox is the security boundary: actor `code` runs in a QuickJS-in-WASM VM with
// ONLY injected capabilities. This proves it is fail-closed — no fetch/fs/import/ambient globals (not even
// via the Function constructor), ungranted caps throw, runaway loops are killed — and that granted caps work.

describe('board 0111 — actor sandbox', () => {
	test('runs handle() and returns its JSON result', async () => {
		const out = await runActorCode(
			`async function handle(msg) { return { doubled: msg.n * 2, who: msg.who } }`,
			{ n: 21, who: 'sam' },
			{}
		)
		expect(out).toEqual({ doubled: 42, who: 'sam' })
	})

	test('a granted capability is callable; args + result marshal as JSON', async () => {
		const calls: unknown[][] = []
		const out = await runActorCode(
			`async function handle(msg, caps) {
				const row = await caps.ops('todos.create', { title: msg.title });
				return { made: row }
			}`,
			{ title: 'buy milk' },
			{
				ops: (name: string, payload: unknown) => {
					calls.push([name, payload])
					return { id: 'row-1', ...(payload as object) }
				}
			}
		)
		expect(out).toEqual({ made: { id: 'row-1', title: 'buy milk' } })
		expect(calls).toEqual([['todos.create', { title: 'buy milk' }]])
	})

	test('FAIL-CLOSED: an ungranted capability throws', async () => {
		await expect(
			runActorCode(`async function handle(_m, caps) { return await caps.ops('x', {}) }`, {}, {})
		).rejects.toThrow()
	})

	test('FAIL-CLOSED: fetch / require / process / dynamic import are unavailable', async () => {
		for (const evil of [
			`fetch('http://evil')`,
			`require('fs')`,
			`process.exit(1)`,
			`import('node:fs')`
		]) {
			await expect(
				runActorCode(`async function handle() { return ${evil} }`, {}, {})
			).rejects.toThrow()
		}
	})

	test('FAIL-CLOSED: the Function constructor cannot reach host globals', async () => {
		const out = await runActorCode(
			`async function handle() {
				return { proc: typeof (new Function('return this')()).process, fetch: typeof fetch, req: typeof require }
			}`,
			{},
			{}
		)
		expect(out).toEqual({ proc: 'undefined', fetch: 'undefined', req: 'undefined' })
	})

	test('FUEL: a runaway loop is killed by the deadline', async () => {
		await expect(
			runActorCode(`async function handle() { while (true) {} }`, {}, {}, {}, { deadlineMs: 200 })
		).rejects.toThrow()
	})

	test('a throwing actor surfaces its error (not a silent pass)', async () => {
		await expect(
			runActorCode(`async function handle() { throw new Error('boom') }`, {}, {})
		).rejects.toThrow('boom')
	})
})
