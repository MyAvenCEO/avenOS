import { afterAll, describe, expect, test } from 'bun:test'
import { TOOL_ACTORS } from '@avenos/skills/tools'
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

	test('MOVE by NAME: the data_crud actor resolves a name→id so an update hits the right row', async () => {
		// the reported bug: the card shows no ids, so the model passes the item NAME as `id` on an update
		// ("move the Hammer to Keller") — the actor must resolve it to the real row and apply the move.
		const ctx = {
			userId: UID,
			data: (a: Parameters<typeof crud>[1]) => crud(UID, a),
			ops: (n: string, p?: Record<string, unknown>) => runNamedOp(UID, n, p ?? {})
		}
		await TOOL_ACTORS.data_crud.handle(ctx as never, {
			schema: 'inventory',
			action: 'update',
			items: [{ id: N('Hammer'), location: 'Keller' }] // id = the NAME, not a uuid
		})
		const moved = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		expect(byName(moved, N('Hammer'))?.location).toBe('Keller')
	})

	test('HONEST FAILURE: a garbled name that matches nothing returns an error, never fake-success', async () => {
		// the live bug: "move mozzaralal into garage" → "Updated inventory." while nothing moved.
		const ctx = {
			userId: UID,
			data: (a: Parameters<typeof crud>[1]) => crud(UID, a),
			ops: (n: string, p?: Record<string, unknown>) => runNamedOp(UID, n, p ?? {})
		}
		const r = (await TOOL_ACTORS.data_crud.handle(ctx as never, {
			schema: 'inventory',
			action: 'update',
			items: [{ id: 'zzz-inv-Hammr-garble', location: 'Garage' }]
		})) as { content: { ok?: boolean; error?: string; available?: string[] } }
		expect(r.content.ok).toBe(false)
		expect(String(r.content.error)).toContain('zzz-inv-Hammr-garble')
		expect(Array.isArray(r.content.available)).toBe(true) // the real names, so the model self-corrects
	})

	test('LOCATION RENAME (reified): relabels the SAME entity; every item follows by id', async () => {
		const ctx = {
			userId: UID,
			data: (a: Parameters<typeof crud>[1]) => crud(UID, a),
			ops: (n: string, p?: Record<string, unknown>) => runNamedOp(UID, n, p ?? {})
		}
		await TOOL_ACTORS.locations.handle(ctx as never, { rename: { from: 'Keller', to: 'zzz-Vorratsraum' } })
		const inv = items(await crud(UID, { schema: 'inventory', action: 'list' }))
		expect(byName(inv, N('Hammer'))?.location).toBe('zzz-Vorratsraum') // moved there in the MOVE test
		await TOOL_ACTORS.locations.handle(ctx as never, { rename: { from: 'zzz-Vorratsraum', to: 'Keller' } })
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
