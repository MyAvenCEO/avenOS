import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { crud, fetchOp } from '../src/actor-run'
import { db } from '../src/db'
import { type QuerySpec, runOperation, runQuery } from '../src/queries'

// board 0112 — the Planner BATTLE TEST: goals + sub-tasks + tags added as PURE CONFIG (migration 0073),
// exercised end-to-end through the ONE universal engine. Each block stresses a different capability:
//   goals      → derived replace-trait CRUD, the universal {field:'goal'} filter, group_by/count aggregates
//   sub-tasks  → self-referential joins: top-level filter (isnull) + a GRANDPARENT chain query (join→join)
//   tags       → many-to-many via hand-authored ops (todos.tag/untag) + an `in` filter query
// Zero engine code changed for any of this — that IS the test.

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
const UID = `test-planner-${randomUUID().slice(0, 8)}`
type Row = Record<string, unknown>
const items = (out: unknown): Row[] => ((out as { items?: Row[] })?.items ?? []) as Row[]
const byTitle = (rows: Row[], t: string): Row | undefined => rows.find((r) => r.title === t)
const tagOp = async (name: string, params: Record<string, unknown>) =>
	runOperation(UID, await fetchOp(UID, name), params)

d('board 0112 — Planner battle test (goals · sub-tasks · tags), config-only', () => {
	let gymId = ''
	let planId = ''
	let stepsId = ''

	test('GOALS: create with goal → projected; universal {field:goal} filter; move + clear via update', async () => {
		await crud(UID, {
			schema: 'todos',
			action: 'create',
			items: [
				{ title: 'go to the gym', goal: 'Fitness', priority: 'high' },
				{ title: 'meal prep', goal: 'Fitness' },
				{ title: 'file taxes', goal: 'Admin' },
				{ title: 'free floater' }
			]
		})
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(all.length).toBe(4)
		gymId = String(byTitle(all, 'go to the gym')?.id)
		expect(byTitle(all, 'go to the gym')?.goal).toBe('Fitness')
		expect(byTitle(all, 'free floater')?.goal).toBeNull()

		// the universal filter over the NEW projected field — no code, the projection defines it.
		const fitness = items(
			await crud(UID, { schema: 'todos', action: 'list', filter: { field: 'goal', value: 'Fitness' } })
		)
		expect(fitness.map((r) => r.title).sort()).toEqual(['go to the gym', 'meal prep'])

		// move a task to another goal (replace-trait: clear + re-insert), then clear it entirely.
		await crud(UID, { schema: 'todos', action: 'update', items: [{ id: gymId, goal: 'Health' }] })
		let after = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(after, 'go to the gym')?.goal).toBe('Health')
		await crud(UID, { schema: 'todos', action: 'update', items: [{ id: gymId, goal: '' }] })
		after = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(after, 'go to the gym')?.goal).toBeNull()
	})

	test('GOALS: group_by + count — open todos per goal (the aggregate grammar live)', async () => {
		const perGoal: QuerySpec = { from: 'member_of', group_by: 'x2', count: {} }
		const rows = await runQuery(UID, perGoal)
		const m = Object.fromEntries(rows.map((r) => [r.key, r.n]))
		expect(m.Fitness).toBe(1) // meal prep (gym moved out then cleared)
		expect(m.Admin).toBe(1)
	})

	test('SUB-TASKS: parent projected; top-level filter (isnull); grandparent via a CHAIN query', async () => {
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		planId = String(byTitle(all, 'file taxes')?.id)
		// a sub-task under "file taxes", then a sub-sub-task under it — 3-level hierarchy.
		await crud(UID, {
			schema: 'todos',
			action: 'create',
			items: [{ title: 'collect receipts', parent: planId }]
		})
		stepsId = String(
			byTitle(items(await crud(UID, { schema: 'todos', action: 'list' })), 'collect receipts')?.id
		)
		await crud(UID, {
			schema: 'todos',
			action: 'create',
			items: [{ title: 'scan invoices', parent: stepsId }]
		})

		const withParents = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(withParents, 'collect receipts')?.parent).toBe(planId)
		expect(byTitle(withParents, 'scan invoices')?.parent).toBe(stepsId)

		// top-level only — isnull over the projected parent field, through the SAME universal filter.
		const top = items(
			await crud(UID, { schema: 'todos', action: 'list', filter: { field: 'parent', op: 'isnull' } })
		)
		expect(top.map((r) => r.title).sort()).toEqual([
			'file taxes',
			'free floater',
			'go to the gym',
			'meal prep'
		])

		// GRANDPARENT: task → part_of (j0: my parent) → part_of (j1: the parent's parent) — a chained join.
		const grandparent: QuerySpec = {
			from: 'task',
			join: [
				{ predicate: 'part_of', kind: 'inner', on: { place: 'x1', base: 'id' } },
				{ predicate: 'part_of', kind: 'inner', on: { place: 'x1', base: { join: 0, place: 'x2' } } }
			],
			project: ['id', { place: 'x2', as: 'title' }, { join: 1, place: 'x2', as: 'grandparent' }]
		}
		const rows = await runQuery(UID, grandparent)
		expect(rows).toEqual([{ id: expect.any(String), title: 'scan invoices', grandparent: planId }])
	})

	test('TAGS: many-to-many via the hand-authored ops + an `in` filter query', async () => {
		// two tags on one task + one shared tag on another — via the configured universal-grammar ops.
		await tagOp('todos.tag', { tag: 'paperwork', id: planId })
		await tagOp('todos.tag', { tag: 'urgent', id: planId })
		await tagOp('todos.tag', { tag: 'paperwork', id: stepsId })

		const tagged: QuerySpec = {
			from: 'task',
			join: [{ predicate: 'tagged', kind: 'inner', on: { place: 'x2', base: 'id' } }],
			where: [{ join: 0, place: 'x1', op: 'in', value: ['paperwork'] }],
			project: ['id', { place: 'x2', as: 'title' }]
		}
		const rows = await runQuery(UID, tagged)
		expect(rows.map((r) => r.title).sort()).toEqual(['collect receipts', 'file taxes'])

		// untag is targeted (tag+id), not a cascade.
		await tagOp('todos.untag', { tag: 'paperwork', id: planId })
		const after = await runQuery(UID, tagged)
		expect(after.map((r) => r.title)).toEqual(['collect receipts'])
		// the other tag on the task survives.
		const urgent = await sql<{ n: string }>`
			SELECT count(*)::text as n FROM data_value WHERE user_id = ${UID} AND predicate = 'tagged' AND x1 = 'urgent'
		`.execute(db())
		expect(Number(urgent.rows[0].n)).toBe(1)
	})

	test('DELETE cascades the new satellites too (goal/parent/tags of the deleted task)', async () => {
		await crud(UID, { schema: 'todos', action: 'delete', id: stepsId })
		const orphans = await sql<{ n: string }>`
			SELECT count(*)::text as n FROM data_value WHERE user_id = ${UID}
			AND ((predicate = 'part_of' AND x1 = ${stepsId}) OR (predicate = 'tagged' AND x2 = ${stepsId}) OR (predicate = 'member_of' AND x1 = ${stepsId}))
		`.execute(db())
		expect(Number(orphans.rows[0].n)).toBe(0)
	})

	afterAll(async () => {
		if (!DB) return
		await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
		await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
	})
})
