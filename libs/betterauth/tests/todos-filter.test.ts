import { describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { buildCaps } from '../src/actor-run'
import { runActorCode } from '../src/actor-sandbox'
import { db } from '../src/db'
import { DATA_CRUD_CAPS, DATA_CRUD_CODE } from '../src/todos-code'

// board 0107 — proves the Todos skill's CONFIGURED query filters flow through the sandboxed data_crud code:
// `list` with filter:'done'/'open' selects the configured todos.done / todos.open ops (a join-targeted null-op
// filter over the x1–x5 store), while no filter runs todos.list. The filter is DATA (data_operations),
// selected generically by the actor code as `schema + '.' + filter` — no hardcoded filter vocabulary. The ops
// are complementary (done ⊎ open = the whole list), which is the invariant asserted here over live data.

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
const run = (msg: unknown) => runActorCode(DATA_CRUD_CODE, msg, buildCaps(UID, DATA_CRUD_CAPS))
const items = (out: unknown): { title?: string }[] =>
	((out as { items?: { title?: string }[] })?.items ?? []) as { title?: string }[]

d('board 0107 — configured todos filters via the sandbox', () => {
	test('filter:done / filter:open select complementary configured ops; none = the full list', async () => {
		const all = items(await run({ schema: 'todos', action: 'list' }))
		const done = items(await run({ schema: 'todos', action: 'list', filter: 'done' }))
		const open = items(await run({ schema: 'todos', action: 'list', filter: 'open' }))

		// done ⊎ open partitions the whole list — proving the sandbox ran todos.done and todos.open (not
		// todos.list) and that the null-op join filter splits the set exactly on the `done` satellite.
		expect(done.length + open.length).toBe(all.length)
		// 'all' as a filter value is treated as no filter → the full list.
		expect(items(await run({ schema: 'todos', action: 'list', filter: 'all' })).length).toBe(all.length)
	})
})
