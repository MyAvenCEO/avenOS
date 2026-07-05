import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { actorBinding, buildCaps, runCodeActor } from '../src/actor-run'
import { db } from '../src/db'

// board 0111 — the actor RUNNER: code XOR engine dispatch, and real capability wiring. Proves an actor's
// sandboxed `code` runs with ONLY its granted caps, and that the `ops` cap writes through the REAL operation
// engine — i.e. a `code` todos actor creates a todo exactly like the chat tool path (the SSOT seam).

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
const DB = await hasDb()
const d = DB ? describe : describe.skip
const UID = 'CkoZlEwLP8nOeBV5UYTmmfdrzyBd4zpt'
const TITLE = 'zzz-actor-run-parity'

d('board 0111 — actor runner', () => {
	test('buildCaps grants ONLY the listed caps', () => {
		expect(typeof buildCaps(UID, ['ops']).ops).toBe('function')
		expect(buildCaps(UID, []).ops).toBeUndefined()
		expect(buildCaps(UID, null).ops).toBeUndefined()
	})

	test('actorBinding: code XOR engine', () => {
		expect(actorBinding({ code: 'x', engine: null })).toBe('code')
		expect(actorBinding({ code: null, engine: 'data_crud' })).toBe('engine')
		expect(actorBinding({ code: null, engine: 'nope' })).toBe('none')
	})

	test('an engine actor (no code) → { ran:false } so the caller uses engine dispatch', async () => {
		const r = await runCodeActor(
			{ name: 'data_crud', code: null, caps: null, prompt: null, engine: 'data_crud' },
			{},
			UID
		)
		expect(r).toEqual({ ran: false })
	})

	test('SSOT: a todos.create CODE actor runs in the sandbox + writes via the REAL ops cap', async () => {
		const code = `async function handle(msg, caps) { return await caps.ops('todos.create', { title: msg.title }) }`
		const r = await runCodeActor(
			{ name: 'todos.create', code, caps: ['ops'], prompt: null, engine: null },
			{ title: TITLE },
			UID
		)
		expect(r.ran).toBe(true)
		// the todo now exists in the predication store — same write the chat data_crud path produces.
		const rows = await sql`
			SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = ${'task'} AND x2 = ${TITLE}
		`.execute(db())
		expect(rows.rows.length).toBeGreaterThan(0)
	})

	afterAll(async () => {
		if (!DB) return
		const tasks = await sql`
			SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = ${'task'} AND x2 = ${TITLE}
		`.execute(db())
		for (const t of tasks.rows as { id: string }[]) {
			await sql`
				DELETE FROM data_value WHERE user_id = ${UID} AND (id = ${t.id} OR x1 = ${t.id} OR x2 = ${t.id})
			`.execute(db())
		}
	})
})
