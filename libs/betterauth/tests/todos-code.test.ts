import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { runActorCode } from '../src/actor-sandbox'
import { buildCaps } from '../src/actor-run'
import { db } from '../src/db'
import { DATA_CRUD_CAPS, DATA_CRUD_CODE } from '../src/todos-code'

// board 0111 — proves the todos vertical's FULL CRUD ports into sandboxed actor `code`: the DATA_CRUD_CODE
// module, run in the WASM sandbox with only the `ops` cap, does create → list → update → delete against the
// REAL operation engine, exactly like the chat data_crud path. Additive — nothing live flips here.

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
const TITLE = 'zzz-todos-code-crud'

const run = (msg: unknown) => runActorCode(DATA_CRUD_CODE, msg, buildCaps(UID, DATA_CRUD_CAPS))
const taskId = async (): Promise<string | undefined> => {
	const r = await sql`
		SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = ${'task'} AND x2 = ${TITLE} LIMIT 1
	`.execute(db())
	return (r.rows[0] as { id: string } | undefined)?.id
}

d('board 0111 — todos CRUD as sandboxed code', () => {
	test('CREATE → the task exists in the predication store', async () => {
		await run({ schema: 'todos', action: 'create', items: [{ title: TITLE, priority: 'high' }] })
		expect(await taskId()).toBeTruthy()
	})

	test('LIST → returns the created task', async () => {
		// a query op returns { rows } (the projected view: title/done/due/owner/priority).
		const out = (await run({ schema: 'todos', action: 'list' })) as { items?: { title?: string }[] }
		expect(out.items?.some((t) => t.title === TITLE)).toBe(true)
	})

	test('UPDATE → marking done is reflected', async () => {
		const id = await taskId()
		expect(id).toBeTruthy()
		await run({ schema: 'todos', action: 'update', items: [{ id, done: true }] })
		const done = await sql`
			SELECT 1 FROM data_value WHERE user_id = ${UID} AND predicate = ${'done'} AND x1 = ${id}
		`.execute(db())
		expect(done.rows.length).toBeGreaterThan(0)
	})

	test('DELETE → the task (and satellites) are gone', async () => {
		const id = await taskId()
		await run({ schema: 'todos', action: 'delete', ids: [id] })
		expect(await taskId()).toBeUndefined()
		const satellites = await sql`
			SELECT 1 FROM data_value WHERE user_id = ${UID} AND x1 = ${id}
		`.execute(db())
		expect(satellites.rows.length).toBe(0)
	})

	afterAll(async () => {
		if (!DB) return
		const rows = await sql`
			SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = ${'task'} AND x2 = ${TITLE}
		`.execute(db())
		for (const t of rows.rows as { id: string }[]) {
			await sql`
				DELETE FROM data_value WHERE user_id = ${UID} AND (id = ${t.id} OR x1 = ${t.id} OR x2 = ${t.id})
			`.execute(db())
		}
	})
})
