import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { describe, expect, test } from 'bun:test'
import { db } from '../src/db'
import {
	compileQuery,
	type MutationSpec,
	type QuerySpec,
	runMutation,
	runQuery,
	validateMutationSpec,
	validateQuerySpec
} from '../src/queries'

// board 0101 — the DETERMINISTIC proof: validated query/mutation specs compile to SAFE parameterized SQL
// and run correctly over the x1–x5 store (filter+join+count queries; transactional mutations). GLM
// authoring quality is a separate human-checked acceptance criterion.

const UID = `test-queries-${randomUUID().slice(0, 8)}`
async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}

describe('queries — validated specs over the x1–x5 store (board 0101)', () => {
	test('AJV rejects a malformed query spec (never reaches SQL)', () => {
		expect(validateQuerySpec({ from: 'owned_by' })).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ from: 'owned_by', where: [{ place: 'x9', op: 'eq', value: 1 }] } as any)).toBe(false)
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ where: [] } as any)).toBe(false) // missing `from`
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ from: 'x', bogus: 1 } as any)).toBe(false) // extra prop
	})

	test('AJV rejects a malformed mutation spec', () => {
		expect(
			validateMutationSpec({ ops: [{ op: 'insert', predicate: 'owned_by', cells: { x1: 'a', x2: 'b' } }] })
		).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateMutationSpec({ ops: [] } as any)).toBe(false) // empty ops
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateMutationSpec({ ops: [{ op: 'nuke', predicate: 'x' }] } as any)).toBe(false) // bad op
	})

	test('a query spec compiles to PARAMETERIZED SQL — the value is bound, not interpolated (injection-safe)', () => {
		const evil = "'; DROP TABLE data_value; --"
		const spec: QuerySpec = { from: 'owned_by', where: [{ place: 'x1', op: 'eq', value: evil }], project: ['x2'] }
		const { sql: text, parameters } = compileQuery('u1', spec).compile(db())
		expect(text).toContain('data_value')
		expect(text).not.toContain('DROP TABLE') // the malicious value is NOT in the SQL text…
		expect(parameters).toContain(evil) // …it's a bound parameter
	})

	test('a count + HAVING query compiles the aggregate', () => {
		const spec: QuerySpec = {
			from: 'owned_by',
			group_by: 'x1',
			count: { having: { op: 'gt', value: 3 } },
			project: ['x1']
		}
		const { sql: text } = compileQuery('u1', spec).compile(db())
		const low = text.toLowerCase()
		expect(low).toContain('group by')
		expect(low).toContain('having count(*) >')
	})

	test('EXECUTION: filter+join+count returns the right rows incl. HAVING; a transfer mutation is transactional', async () => {
		if (!(await hasDb())) {
			console.log('[queries] skipped DB execution test — no connection')
			return
		}
		const clean = async () => {
			await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
			await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
		}
		await clean()
		const schemaId = randomUUID()
		await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
			VALUES (${schemaId}, ${UID}, 'owned_by', '{"properties":{"predicate":{}}}'::jsonb, now(), now())`.execute(db())
		const ins = (x1: string, x2: string) =>
			sql`INSERT INTO data_value (id, user_id, schema_id, predicate, x1, x2, created_at, updated_at)
				VALUES (${randomUUID()}, ${UID}, ${schemaId}, 'owned_by', ${x1}, ${x2}, now(), now())`.execute(db())
		for (const t of ['t1', 't2', 't3', 't4']) await ins('owner-aaaaaa', `co-${t}`) // owns 4
		for (const t of ['t5', 't6']) await ins('owner-bbbbbb', `co-${t}`) // owns 2

		// "owners with > 3 companies" — filter/group/count/having
		const rows = await runQuery(UID, {
			from: 'owned_by',
			group_by: 'x1',
			count: { having: { op: 'gt', value: 3 } },
			project: ['x1']
		})
		expect(rows.length).toBe(1)
		expect(rows[0].key).toBe('owner-aaaaaa')
		expect(Number(rows[0].n)).toBe(4)

		// transfer ownership of co-t1 from owner-aaaaaa → owner-cccccc: a delete + insert, ONE transaction
		const transfer: MutationSpec = {
			params: ['thing', 'from', 'to'],
			ops: [
				{ op: 'delete', predicate: 'owned_by', where: [{ place: 'x2', op: 'eq', param: 'thing' }, { place: 'x1', op: 'eq', param: 'from' }] },
				{ op: 'insert', predicate: 'owned_by', cells: { x1: { param: 'to' }, x2: { param: 'thing' } } }
			]
		}
		await runMutation(UID, transfer, { thing: 'co-t1', from: 'owner-aaaaaa', to: 'owner-cccccc' })
		const moved = await runQuery(UID, { from: 'owned_by', where: [{ place: 'x2', op: 'eq', value: 'co-t1' }], project: ['x1'] })
		expect(moved.length).toBe(1)
		expect(moved[0].x1).toBe('owner-cccccc') // ownership moved

		// ROLLBACK: a mutation whose 2nd op fails (unknown predicate) must roll back the 1st op's delete
		const beforeCount = (
			await runQuery(UID, { from: 'owned_by', where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }] })
		).length
		await expect(
			runMutation(UID, {
				ops: [
					{ op: 'delete', predicate: 'owned_by', where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }] },
					{ op: 'insert', predicate: 'nonexistent_predicate', cells: { x1: 'z' } } // fails → rollback
				]
			})
		).rejects.toThrow()
		const afterCount = (
			await runQuery(UID, { from: 'owned_by', where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }] })
		).length
		expect(afterCount).toBe(beforeCount) // the delete rolled back — NO partial write

		await clean()
	})
})
