import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { db } from '../src/db'
import { type QuerySpec, runQuery } from '../src/queries'

// board 0107 — proves the query engine can express DYNAMIC todo filters over the x1–x5 store WITHOUT any
// hardcoded per-filter SQL: a filter that targets a JOIN place (due-date range) and one that tests a
// satellite's EXISTENCE (done vs open, via notnull/isnull on the join id). Every value stays a bound param
// and the spec is AJV-validated before it reaches SQL — the "show me done todos / due this week" capability.

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
const UID = 'zzz-query-filter-test'
const SID = randomUUID() // schema_id is NOT NULL, but a query never reads it (it filters by user+predicate)

async function ins(predicate: string, cells: { x1?: string; x2?: string }): Promise<string> {
	const id = randomUUID()
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, predicate, x1, x2, created_at, updated_at)
		VALUES (${id}, ${UID}, ${SID}, ${predicate}, ${cells.x1 ?? null}, ${cells.x2 ?? null}, now(), now())
	`.execute(db())
	return id
}
const titles = (rows: Record<string, unknown>[]): string[] => rows.map((r) => String(r.title))
const dayOffset = (days: number): string =>
	new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

d('board 0107 — dynamic todo filters', () => {
	let doneId = ''
	test('setup: a done task, an open task, and a task due in 3 days', async () => {
		// data_value.schema_id has a FK to data_schema — seed one throwaway schema the rows can reference.
		await sql`
			INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
			VALUES (${SID}, ${UID}, ${'zzz-test'}, ${'{}'}::jsonb, now(), now())
		`.execute(db())
		doneId = await ins('task', { x2: 'zzz done task' })
		await ins('task', { x2: 'zzz open task' })
		const dueId = await ins('task', { x2: 'zzz due task' })
		await ins('done', { x1: doneId }) // done satellite → this task is "done"
		await ins('due', { x1: dayOffset(3), x2: dueId }) // due.x1 = date, due.x2 = task id
	})

	test('DONE filter — notnull on the done join → only the done task', async () => {
		const spec: QuerySpec = {
			from: 'task',
			join: [{ predicate: 'done', on: { place: 'x1', base: 'id' }, kind: 'left' }],
			where: [{ join: 0, place: 'id', op: 'notnull' }],
			project: ['id', { as: 'title', place: 'x2' }]
		}
		expect(titles(await runQuery(UID, spec))).toEqual(['zzz done task'])
	})

	test('OPEN filter — isnull on the done join → the two not-done tasks', async () => {
		const spec: QuerySpec = {
			from: 'task',
			join: [{ predicate: 'done', on: { place: 'x1', base: 'id' }, kind: 'left' }],
			where: [{ join: 0, place: 'id', op: 'isnull' }],
			project: ['id', { as: 'title', place: 'x2' }]
		}
		expect(titles(await runQuery(UID, spec)).sort()).toEqual(['zzz due task', 'zzz open task'])
	})

	test('DUE-THIS-WEEK filter — gte/lte param on the due join → the task due in 3 days', async () => {
		const spec: QuerySpec = {
			from: 'task',
			join: [{ predicate: 'due', on: { place: 'x2', base: 'id' }, kind: 'left' }],
			where: [
				{ join: 0, place: 'x1', op: 'gte', param: 'from' },
				{ join: 0, place: 'x1', op: 'lte', param: 'to' }
			],
			project: ['id', { as: 'title', place: 'x2' }]
		}
		const rows = await runQuery(UID, spec, { from: dayOffset(0), to: dayOffset(7) })
		expect(titles(rows)).toEqual(['zzz due task'])
	})

	afterAll(async () => {
		if (!DB) return
		await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
		await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
	})
})
