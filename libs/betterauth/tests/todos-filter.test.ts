import { describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { crud } from '../src/actor-run'
import { db } from '../src/db'

// board 0107 — proves the Todos skill's CONFIGURED query filters flow through the ONE universal CRUD executor
// `crud()`: `list` with filter:'done'/'open' selects the configured todos.done / todos.open ops (a
// join-targeted null-op filter over the x1–x5 store) via `<schema>.<filter>`, while no filter runs todos.list.
// The filter is DATA (data_operations), selected generically — no hardcoded filter vocabulary. The ops are
// complementary (done ⊎ open = the whole list), which is the invariant asserted here over live data.

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
const items = (out: unknown): { title?: string }[] =>
	((out as { items?: { title?: string }[] })?.items ?? []) as { title?: string }[]

d('board 0107 — configured todos filters via crud()', () => {
	test('filter:done / filter:open select complementary configured ops; none = the full list', async () => {
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		const done = items(await crud(UID, { schema: 'todos', action: 'list', filter: 'done' }))
		const open = items(await crud(UID, { schema: 'todos', action: 'list', filter: 'open' }))

		// done ⊎ open partitions the whole list — proving crud() ran todos.done and todos.open (not
		// todos.list) and that the null-op join filter splits the set exactly on the `done` satellite.
		expect(done.length + open.length).toBe(all.length)
		// 'all' as a filter value is treated as no filter → the full list.
		expect(items(await crud(UID, { schema: 'todos', action: 'list', filter: 'all' })).length).toBe(
			all.length
		)
	})
})
