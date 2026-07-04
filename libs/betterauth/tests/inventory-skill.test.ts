import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { crud, runNamedOp } from '../src/actor-run'
import { db } from '../src/db'
import { advertisedTools, chatToolDefinitionsFor, skillMenu } from '../src/config'

// board 0113 — the SKILLIFY PROOF: a complete NEW skill ("Inventory") minted as PURE CONFIG (migration
// 0080 — vocab + bundle + ops + skill/actor rows + vibes) runs END-TO-END through the same universal
// machinery as todos, with ZERO new engine code. This test reads EVERYTHING back from the DB: the router
// menu, the advertised tools/mailbox, and full CRUD + the universal filter + the locations aggregate.

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
const UID = 'CkoZlEwLP8nOeBV5UYTmmfdrzyBd4zpt' // has the migrated vocab (fresh-user bootstrap is todos-only)
type Row = Record<string, unknown>
const items = (out: unknown): Row[] => ((out as { items?: Row[] })?.items ?? []) as Row[]
const byName = (rows: Row[], n: string): Row | undefined => rows.find((r) => r.name === n)
const N = (s: string) => `zzz-inv-${s}`

d('board 0113 — the Inventory skill, pure config, end to end from the DB', () => {
	test('the skill is WIRED from the DB: router menu + advertised tools + mailbox', async () => {
		const menu = await skillMenu()
		expect(menu.some((s) => s.id === 'inventory')).toBe(true)
		// board 0112 — the inventory skill now also carries the `locations` grid actor.
		expect(await advertisedTools('inventory')).toEqual(['data_crud', 'locations'])
		const defs = await chatToolDefinitionsFor('inventory')
		expect(defs.map((x) => x.function.name)).toEqual(['data_crud', 'locations'])
		expect(JSON.stringify(defs[0]?.function.parameters)).toContain('inventory') // the inventory mailbox
	})

	test('CRUD + projection: create items with location/amount, list projects them', async () => {
		await crud(UID, {
			schema: 'inventory',
			action: 'create',
			items: [
				{ name: N('Hammer'), location: 'Garage', amount: '3' },
				{ name: N('Dübel'), location: 'Garage', amount: '200' },
				{ name: N('Mehl'), location: 'Keller', amount: '2' }
			]
		})
		const all = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		const mine = all.filter((r) => String(r.name).startsWith('zzz-inv-'))
		expect(mine.length).toBe(3)
		expect(byName(mine, N('Hammer'))).toMatchObject({ location: 'Garage', amount: '3', owner: UID })
	})

	test('the UNIVERSAL filter works on the new projection (location) with zero code', async () => {
		const garage = items(
			await crud(UID, {
				schema: 'inventory',
				action: 'list',
				filter: { field: 'location', value: 'Garage' }
			})
		).filter((r) => String(r.name).startsWith('zzz-inv-'))
		expect(garage.map((r) => r.name).sort()).toEqual([N('Dübel'), N('Hammer')])
	})

	test('UPDATE (restock) replaces the amount in place; the locations aggregate counts per place', async () => {
		const all = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		const hammer = byName(all, N('Hammer'))
		await crud(UID, {
			schema: 'inventory',
			action: 'update',
			items: [{ id: hammer?.id, amount: '5' }]
		})
		const after = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		expect(byName(after, N('Hammer'))).toMatchObject({ amount: '5', location: 'Garage' })

		// board 0112 REIFICATION — located.x2 is a location ENTITY id now; the aggregate keys by that id, so
		// resolve the names off location.list first (the location grid actor does the same id→name mapping).
		const agg = (await runNamedOp(UID, 'inventory.locations', {})) as { rows?: Row[] }
		const locs =
			((await runNamedOp(UID, 'location.list', {})) as { rows?: { id?: string; name?: string }[] }).rows ??
			[]
		const idOf = (name: string) => String(locs.find((l) => l.name === name)?.id)
		const countBy = Object.fromEntries((agg.rows ?? []).map((r) => [String(r.key), Number(r.n)]))
		expect(countBy[idOf('Garage')]).toBeGreaterThanOrEqual(2)
		expect(countBy[idOf('Keller')]).toBeGreaterThanOrEqual(1)
	})

	test('DELETE cascades the satellites (located/quantity/owned_by rows go with the item)', async () => {
		const all = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		const mehl = byName(all, N('Mehl'))
		await crud(UID, { schema: 'inventory', action: 'delete', id: String(mehl?.id) })
		const orphans = await sql<{ n: string }>`
			SELECT count(*)::text as n FROM data_value WHERE user_id = ${UID}
			AND (x1 = ${String(mehl?.id)} OR x2 = ${String(mehl?.id)})
		`.execute(db())
		expect(Number(orphans.rows[0].n)).toBe(0)
	})

	afterAll(async () => {
		if (!DB) return
		const rows = await sql<{ id: string }>`
			SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = 'stock' AND x2 LIKE 'zzz-inv-%'
		`.execute(db())
		for (const r of rows.rows) {
			await sql`
				DELETE FROM data_value WHERE user_id = ${UID} AND (id = ${r.id} OR x1 = ${r.id} OR x2 = ${r.id})
			`.execute(db())
		}
	})
})
