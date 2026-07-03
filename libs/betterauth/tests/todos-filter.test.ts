import { describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { crud } from '../src/actor-run'
import { db } from '../src/db'

// board 0107 — UNIVERSAL list filtering via crud(): a {field, value, op} filter builds a validated QuerySpec
// over ANY projected field of todos.list (priority / due / done / title) — no configured per-filter op, no
// hardcoded vocabulary. Asserted over live data: `done` (a boolean satellite) partitions the list, and a
// `priority` (place) filter returns exactly the rows of that priority.

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
type Row = { priority?: string; title?: string }
const rows = (out: unknown): Row[] => ((out as { items?: Row[] })?.items ?? []) as Row[]
const list = (filter?: { field: string; value?: unknown; op?: string }) =>
	crud(UID, { schema: 'todos', action: 'list', ...(filter ? { filter } : {}) })

d('board 0107 — universal crud() filters', () => {
	test('boolean `done` field: done ⊎ open = the full list', async () => {
		const all = rows(await list())
		const done = rows(await list({ field: 'done', value: true }))
		const open = rows(await list({ field: 'done', value: false }))
		expect(done.length + open.length).toBe(all.length)
	})

	test('place `priority` field: returns exactly the rows of that priority', async () => {
		const all = rows(await list())
		const medium = rows(await list({ field: 'priority', value: 'medium' }))
		expect(medium.every((t) => t.priority === 'medium')).toBe(true)
		expect(medium.length).toBe(all.filter((t) => t.priority === 'medium').length)
	})

	// board 0112 — string eq is CASE-INSENSITIVE: goal/tag/location values are free-text labels a model
	// capitalizes however it read them. This is the one reason "show me my Healthy Eating todos" returned 0
	// (the stored goal is "Healthy eating"). Exact-case and off-case filters must return the SAME rows.
	test('string filter is case-insensitive (the "Healthy Eating" vs "Healthy eating" bug)', async () => {
		const exact = rows(await list({ field: 'priority', value: 'medium' }))
		const upper = rows(await list({ field: 'priority', value: 'MEDIUM' }))
		const mixed = rows(await list({ field: 'priority', value: 'Medium' }))
		expect(upper.length).toBe(exact.length)
		expect(mixed.length).toBe(exact.length)
	})
})
