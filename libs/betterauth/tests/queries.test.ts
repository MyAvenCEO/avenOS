import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
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
		expect(
			validateQuerySpec({ from: 'owned_by', where: [{ place: 'x9', op: 'eq', value: 1 }] } as any)
		).toBe(false)
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ where: [] } as any)).toBe(false) // missing `from`
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ from: 'x', bogus: 1 } as any)).toBe(false) // extra prop
	})

	test('AJV rejects a malformed mutation spec', () => {
		expect(
			validateMutationSpec({
				ops: [{ op: 'insert', predicate: 'owned_by', cells: { x1: 'a', x2: 'b' } }]
			})
		).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateMutationSpec({ ops: [] } as any)).toBe(false) // empty ops
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateMutationSpec({ ops: [{ op: 'nuke', predicate: 'x' }] } as any)).toBe(false) // bad op
	})

	test('a query spec compiles to PARAMETERIZED SQL — the value is bound, not interpolated (injection-safe)', () => {
		const evil = "'; DROP TABLE data_value; --"
		const spec: QuerySpec = {
			from: 'owned_by',
			where: [{ place: 'x1', op: 'eq', value: evil }],
			project: ['x2']
		}
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
			VALUES (${schemaId}, ${UID}, 'owned_by', '{"properties":{"predicate":{}}}'::jsonb, now(), now())`.execute(
			db()
		)
		const ins = (x1: string, x2: string) =>
			sql`INSERT INTO data_value (id, user_id, schema_id, predicate, x1, x2, created_at, updated_at)
				VALUES (${randomUUID()}, ${UID}, ${schemaId}, 'owned_by', ${x1}, ${x2}, now(), now())`.execute(
				db()
			)
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
				{
					op: 'delete',
					predicate: 'owned_by',
					where: [
						{ place: 'x2', op: 'eq', param: 'thing' },
						{ place: 'x1', op: 'eq', param: 'from' }
					]
				},
				{
					op: 'insert',
					predicate: 'owned_by',
					cells: { x1: { param: 'to' }, x2: { param: 'thing' } }
				}
			]
		}
		await runMutation(UID, transfer, { thing: 'co-t1', from: 'owner-aaaaaa', to: 'owner-cccccc' })
		const moved = await runQuery(UID, {
			from: 'owned_by',
			where: [{ place: 'x2', op: 'eq', value: 'co-t1' }],
			project: ['x1']
		})
		expect(moved.length).toBe(1)
		expect(moved[0].x1).toBe('owner-cccccc') // ownership moved

		// ROLLBACK: a mutation whose 2nd op fails (unknown predicate) must roll back the 1st op's delete
		const beforeCount = (
			await runQuery(UID, {
				from: 'owned_by',
				where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }]
			})
		).length
		await expect(
			runMutation(UID, {
				ops: [
					{
						op: 'delete',
						predicate: 'owned_by',
						where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }]
					},
					{ op: 'insert', predicate: 'nonexistent_predicate', cells: { x1: 'z' } } // fails → rollback
				]
			})
		).rejects.toThrow()
		const afterCount = (
			await runQuery(UID, {
				from: 'owned_by',
				where: [{ place: 'x1', op: 'eq', value: 'owner-bbbbbb' }]
			})
		).length
		expect(afterCount).toBe(beforeCount) // the delete rolled back — NO partial write

		await clean()
	})

	test('AJV: an insert cell may be a literal, a {param}, or a {ref} — the meta-schema accepts all three', () => {
		expect(
			validateMutationSpec({
				ops: [
					{ op: 'insert', predicate: 'banana', cells: { x1: 'me' } },
					{ op: 'insert', predicate: 'quantity', cells: { x1: { ref: 0 }, x2: { param: 'n' } } }
				]
			})
		).toBe(true)
	})

	test('EXECUTION: reified nesting — {ref} binds an earlier insert; a referent join reads the quantity (board 0103)', async () => {
		if (!(await hasDb())) {
			console.log('[queries] skipped DB execution test — no connection')
			return
		}
		const clean = async () => {
			await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
			await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
		}
		await clean()
		for (const p of ['banana', 'quantity', 'eat']) {
			await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
				VALUES (${randomUUID()}, ${UID}, ${p}, '{"properties":{"predicate":{}}}'::jsonb, now(), now())`.execute(
				db()
			)
		}

		// "I ate 2 bananas" reified — NOT eat(x2="2 bananas") but three flat predications sharing a referent B
		// (op 0's generated row id): banana(x1=B-owner) is the portion, quantity(x1=B, x2="2"), eat(x1=me, x2=B).
		const eat2Bananas: MutationSpec = {
			ops: [
				{ op: 'insert', predicate: 'banana', cells: { x1: 'owner-me' } }, // op 0 → referent B = this row id
				{ op: 'insert', predicate: 'quantity', cells: { x1: { ref: 0 }, x2: '2' } }, // B measures 2
				{ op: 'insert', predicate: 'eat', cells: { x1: 'owner-me', x2: { ref: 0 } } } // me ate B
			]
		}
		const res = await runMutation(UID, eat2Bananas)
		expect(res.ops.length).toBe(3)

		// all three landed; exactly one banana referent
		expect((await runQuery(UID, { from: 'banana', project: ['x1'] })).length).toBe(1)

		// the reference RESOLVED to the SAME referent — quantity.x1 and eat.x2 both equal banana's row id.
		const bananaId = (
			await sql<{
				id: string
			}>`SELECT id FROM data_value WHERE user_id = ${UID} AND predicate = 'banana' LIMIT 1`.execute(
				db()
			)
		).rows[0]?.id
		// read the quantity of what was eaten THROUGH the referent join (quantity ⨝ eat on eat.x2 = quantity.x1)
		const eaten = await runQuery(UID, {
			from: 'quantity',
			join: [{ predicate: 'eat', on: { place: 'x2', base: 'x1' } }],
			project: ['x1', 'x2']
		})
		expect(eaten.length).toBe(1)
		expect(Number(eaten[0].x2)).toBe(2) // "how many bananas?" → 2, read via the referent join
		expect(eaten[0].x1).toBe(bananaId) // the join correlated on the real referent

		// FAIL-CLOSED: a forward/self ref (no earlier insert to bind) rolls the whole transaction back.
		await expect(
			runMutation(UID, {
				ops: [{ op: 'insert', predicate: 'quantity', cells: { x1: { ref: 0 }, x2: '9' } }]
			})
		).rejects.toThrow()
		// FAIL-CLOSED: a ref to a DELETE op (which generates no referent) is rejected.
		await expect(
			runMutation(UID, {
				ops: [
					{
						op: 'delete',
						predicate: 'banana',
						where: [{ place: 'x1', op: 'eq', value: 'nobody' }]
					},
					{ op: 'insert', predicate: 'quantity', cells: { x1: { ref: 0 }, x2: '1' } }
				]
			})
		).rejects.toThrow()

		await clean()
	})
})

describe('queries — DSL growth: left join, object projection, exists, when, update, $user (board 0104)', () => {
	const UID2 = `test-dsl-${randomUUID().slice(0, 8)}`

	test('compile: left join + id-base + object projection + exists emit the expected SQL', () => {
		const spec: QuerySpec = {
			from: 'task',
			join: [
				{ predicate: 'owned_by', kind: 'left', on: { place: 'x2', base: 'id' } },
				{ predicate: 'done', kind: 'left', on: { place: 'x1', base: 'id' } }
			],
			project: [
				'id',
				{ place: 'x2', as: 'title' },
				{ join: 0, place: 'x1', as: 'owner' },
				{ join: 1, exists: true, as: 'done' }
			]
		}
		expect(validateQuerySpec(spec)).toBe(true)
		const { sql: text } = compileQuery('u1', spec).compile(db())
		const low = text.toLowerCase()
		expect(low).toContain('left join')
		expect(low).toContain('"b"."id"') // id-base correlation + projection
		expect(low).toContain('is not null') // the `done` exists boolean
		expect(text).toContain('as "title"')
		expect(text).toContain('as "owner"')
	})

	test('AJV rejects a malformed projection entry', () => {
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ from: 'task', project: [{ exists: true }] } as any)).toBe(false) // exists needs join+as
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(validateQuerySpec({ from: 'task', project: [{ place: 'x9' }] } as any)).toBe(false)
	})

	test('AJV accepts when-guard + update op + $user bind', () => {
		expect(
			validateMutationSpec({
				ops: [
					{ op: 'insert', predicate: 'task', cells: { x1: { bind: '$user' }, x2: 'hi' } },
					{
						op: 'update',
						predicate: 'task',
						where: [{ place: 'x1', op: 'eq', value: 'a' }],
						cells: { x2: 'ho' }
					},
					{
						op: 'insert',
						predicate: 'due',
						when: { param: 'due' },
						cells: { x1: { param: 'due' }, x2: 'a' }
					}
				]
			})
		).toBe(true)
	})

	test('EXECUTION: a todos-shaped left-join projection assembles the flat entity (deriveOps precursor)', async () => {
		if (!(await hasDb())) {
			console.log('[queries] skipped DB execution test — no connection')
			return
		}
		const clean = async () => {
			await sql`DELETE FROM data_value WHERE user_id = ${UID2}`.execute(db())
			await sql`DELETE FROM data_schema WHERE user_id = ${UID2}`.execute(db())
		}
		await clean()
		for (const p of ['task', 'owned_by', 'done', 'due']) {
			await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
				VALUES (${randomUUID()}, ${UID2}, ${p}, '{"properties":{"predicate":{}}}'::jsonb, now(), now())`.execute(
				db()
			)
		}
		// task T1 (done + due) via mutations that use the $user bind + reified id refs, then a plain T2.
		await runMutation(
			UID2,
			{
				ops: [
					{ op: 'insert', predicate: 'task', cells: { x1: { bind: '$user' }, x2: 'buy milk' } }, // op 0 → T1
					{ op: 'insert', predicate: 'owned_by', cells: { x1: { bind: '$user' }, x2: { ref: 0 } } },
					{ op: 'insert', predicate: 'done', cells: { x1: { ref: 0 } } },
					{
						op: 'insert',
						predicate: 'due',
						when: { param: 'due' },
						cells: { x1: { param: 'due' }, x2: { ref: 0 } }
					}
				]
			},
			{ due: '2026-08-01' }
		)
		await runMutation(UID2, {
			ops: [
				{ op: 'insert', predicate: 'task', cells: { x1: { bind: '$user' }, x2: 'call bob' } },
				{ op: 'insert', predicate: 'owned_by', cells: { x1: { bind: '$user' }, x2: { ref: 0 } } },
				{
					op: 'insert',
					predicate: 'due',
					when: { param: 'due' },
					cells: { x1: { param: 'due' }, x2: { ref: 0 } }
				} // skipped: no due
			]
		})

		const rows = await runQuery(UID2, {
			from: 'task',
			join: [
				{ predicate: 'owned_by', kind: 'left', on: { place: 'x2', base: 'id' } },
				{ predicate: 'done', kind: 'left', on: { place: 'x1', base: 'id' } },
				{ predicate: 'due', kind: 'left', on: { place: 'x2', base: 'id' } }
			],
			project: [
				'id',
				{ place: 'x2', as: 'title' },
				{ join: 0, place: 'x1', as: 'owner' },
				{ join: 1, exists: true, as: 'done' },
				{ join: 2, place: 'x1', as: 'due' }
			]
		})
		const milk = rows.find((r) => r.title === 'buy milk')
		const bob = rows.find((r) => r.title === 'call bob')
		expect(milk).toMatchObject({ owner: UID2, done: true, due: '2026-08-01' })
		expect(milk?.id).toBeTruthy()
		expect(bob).toMatchObject({ owner: UID2, done: false, due: null }) // when-guard skipped its due; no done row

		// update op patches IN PLACE — same row id, new title (a delete+insert would change the id).
		const beforeId = milk?.id as string
		await runMutation(UID2, {
			ops: [
				{
					op: 'update',
					predicate: 'task',
					where: [{ place: 'x2', op: 'eq', value: 'buy milk' }],
					cells: { x2: 'buy oat milk' }
				}
			]
		})
		const after = await runQuery(UID2, {
			from: 'task',
			where: [{ place: 'x2', op: 'eq', value: 'buy oat milk' }],
			project: ['id', 'x2']
		})
		expect(after.length).toBe(1)
		expect(after[0].id).toBe(beforeId) // id preserved

		await clean()
	})
})
