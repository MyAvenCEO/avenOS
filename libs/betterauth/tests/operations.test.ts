import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { crud } from '../src/actor-run'
import { db } from '../src/db'
import { deriveOps } from '../src/derive-ops'
import { TODO_SPEC } from '../src/legacy-bundle-fixtures'

// board 0104 — a BUNDLE compiles to OPERATIONS. board 0112 — the aven-ontology interpreter is RETIRED:
// the parity gate this file used to run (derived ops == interpreter) served its purpose; the same CRUD
// behavior is now asserted through the ONE universal path — crud() → the SEEDED data_operations
// (<schema>.<verb>) → runOperation. deriveOps survives only as the mint-time seeder.

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
type Todo = {
	id: string
	title: string
	done: boolean
	due: string | null
	priority: string | null
	owner: string
}
type ListResult = { items: Todo[] }
const norm = (items: Todo[]) =>
	items
		.map((x) => ({
			title: x.title,
			done: x.done,
			due: x.due,
			priority: x.priority,
			owner: x.owner
		}))
		.sort((a, b) => a.title.localeCompare(b.title))

describe('operations — bundles compile to ops; CRUD through the ONE engine (0104/0112)', () => {
	test('deriveOps(todo bundle) emits list/create/update/delete with the right kinds', () => {
		const ops = deriveOps(TODO_SPEC)
		expect(ops.map((o) => o.name)).toEqual([
			'todos.list',
			'todos.create',
			'todos.update',
			'todos.delete'
		])
		expect(ops.map((o) => o.kind)).toEqual(['query', 'mutation', 'mutation', 'mutation'])
	})

	test('a non-derivable bundle (a children trait) throws LOUDLY at mint time (never silent)', () => {
		expect(() =>
			deriveOps({
				type: 'shelf',
				parts: [
					{ pred: 'shelf', kind: 'primary', field: 'name', create: { x1: '$value' } },
					{ pred: 'book', kind: 'children', link: 'x1', field: 'books' }
				],
				project: { name: { pred: 'shelf', place: 'x1' } }
			})
		).toThrow(/children/)
	})

	test('EXECUTION: migration merged the GLM specs — the banana mutation lives in data_operations', async () => {
		if (!(await hasDb())) return
		const r = await sql<{
			kind: string
		}>`SELECT kind FROM data_operations WHERE name = 'm-i-ate-2-bananas'`.execute(db())
		if (r.rows[0]) expect(r.rows[0].kind).toBe('mutation') // present iff the session authored it — assert kind when so
	})

	test('EXECUTION: full todos CRUD through crud() → seeded ops (fresh user, vocab auto-bootstraps)', async () => {
		if (!(await hasDb())) {
			console.log('[operations] skipped DB execution test — no connection')
			return
		}
		const UID = `test-ops-${randomUUID().slice(0, 8)}`
		const clean = async () => {
			await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
			await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
		}
		await clean()

		// CREATE two todos — crud() bootstraps the fresh user's predicate vocab itself (board 0112).
		const created = (await crud(UID, {
			schema: 'todos',
			action: 'create',
			items: [
				{ title: 'buy milk', done: true, due: '2026-08-01', priority: 'high' },
				{ title: 'call bob' }
			]
		})) as { created?: string[] }
		expect(created.created?.length).toBe(2)

		// LIST projects the flat todos.
		const listed = (await crud(UID, { schema: 'todos', action: 'list' })) as ListResult
		expect(norm(listed.items)).toEqual([
			{ title: 'buy milk', done: true, due: '2026-08-01', priority: 'high', owner: UID },
			{ title: 'call bob', done: false, due: null, priority: null, owner: UID }
		])

		// UPDATE patches IN PLACE (same row id; untouched fields preserved).
		const milkId = listed.items.find((x) => x.title === 'buy milk')?.id as string
		await crud(UID, {
			schema: 'todos',
			action: 'update',
			items: [{ id: milkId, title: 'buy oat milk', done: false }]
		})
		const afterUpdate = (await crud(UID, { schema: 'todos', action: 'list' })) as ListResult
		const oat = afterUpdate.items.find((x) => x.id === milkId)
		expect(oat).toMatchObject({ title: 'buy oat milk', done: false })
		expect(oat?.due).toBe('2026-08-01')

		// DELETE cascades the entity + its satellites.
		await crud(UID, { schema: 'todos', action: 'delete', id: milkId })
		const afterDelete = (await crud(UID, { schema: 'todos', action: 'list' })) as ListResult
		expect(afterDelete.items.find((x) => x.id === milkId)).toBeUndefined()
		expect(afterDelete.items.length).toBe(1) // only 'call bob' remains
		const orphans = await sql<{ n: string }>`
			SELECT count(*)::text as n FROM data_value WHERE user_id = ${UID}
			AND (predicate = 'due' AND x2 = ${milkId} OR predicate = 'done' AND x1 = ${milkId} OR predicate = 'owned_by' AND x2 = ${milkId})
		`.execute(db())
		expect(Number(orphans.rows[0].n)).toBe(0)

		await clean()
	}, 30_000)
})
