import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { db } from '../src/db'
import { type QuerySpec, runQuery, validateQuerySpec } from '../src/queries'

// board 0112 — CHAINED joins: a join's `base` may reference an EARLIER join ({join:N, place}), so one
// validated spec walks a predication graph to explicit depth. Proven over the live store with a 3-level
// referent chain — item → quantity(x1=item id) → unit(x1=quantity ROW id) — i.e. the 0103 reified model
// ("2 kg of rice"): the unit predication points at the QUANTITY's row, not at the item, so projecting it
// REQUIRES join-to-join correlation (inexpressible in the old star-shaped grammar). Fail-closed: a
// forward/self chain ref is rejected before any SQL.

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
const UID = 'zzz-chain-join-test'
const SID = randomUUID()

async function ins(predicate: string, cells: { x1?: string; x2?: string }): Promise<string> {
	const id = randomUUID()
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, predicate, x1, x2, created_at, updated_at)
		VALUES (${id}, ${UID}, ${SID}, ${predicate}, ${cells.x1 ?? null}, ${cells.x2 ?? null}, now(), now())
	`.execute(db())
	return id
}

const CHAIN_SPEC: QuerySpec = {
	from: 'item',
	join: [
		{ predicate: 'quantity', kind: 'left', on: { place: 'x1', base: 'id' } },
		{ predicate: 'unit', kind: 'left', on: { place: 'x1', base: { join: 0, place: 'id' } } }
	],
	project: [
		'id',
		{ place: 'x2', as: 'name' },
		{ join: 0, place: 'x2', as: 'qty' },
		{ join: 1, place: 'x2', as: 'unit' }
	]
}

d('board 0112 — chained joins (explicit-depth graph queries)', () => {
	test('3-level referent chain projects across item → quantity → unit', async () => {
		await sql`
			INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
			VALUES (${SID}, ${UID}, ${'zzz-chain'}, ${'{}'}::jsonb, now(), now())
		`.execute(db())
		const itemId = await ins('item', { x2: 'rice' })
		const qtyId = await ins('quantity', { x1: itemId, x2: '2' }) // quantity of the ITEM
		await ins('unit', { x1: qtyId, x2: 'kg' }) // unit of the QUANTITY row — 3rd level

		const rows = await runQuery(UID, CHAIN_SPEC)
		expect(rows).toEqual([{ id: itemId, name: 'rice', qty: '2', unit: 'kg' }])
	})

	test('fail-closed: a forward or self chain ref is rejected before SQL', async () => {
		const forward: QuerySpec = {
			from: 'item',
			join: [
				// join 0 referencing join 1 — forward ref, must throw at compile.
				{ predicate: 'unit', kind: 'left', on: { place: 'x1', base: { join: 1, place: 'id' } } },
				{ predicate: 'quantity', kind: 'left', on: { place: 'x1', base: 'id' } }
			]
		}
		expect(runQuery(UID, forward)).rejects.toThrow(/earlier join/)
		const self: QuerySpec = {
			from: 'item',
			join: [{ predicate: 'unit', kind: 'left', on: { place: 'x1', base: { join: 0, place: 'id' } } }]
		}
		expect(runQuery(UID, self)).rejects.toThrow(/earlier join/)
	})

	test('the AJV meta-schema accepts the chain form and still rejects junk', () => {
		expect(validateQuerySpec(CHAIN_SPEC)).toBe(true)
		expect(
			validateQuerySpec({
				from: 'item',
				join: [{ predicate: 'unit', on: { place: 'x1', base: { join: 0 } } }] // missing place
			})
		).toBe(false)
	})

	afterAll(async () => {
		if (!DB) return
		await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
		await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
	})
})
