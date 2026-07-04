import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { TOOL_ACTORS } from '@avenos/skills/tools'
import { sql } from 'kysely'
import { crud, fetchOp, runNamedOp } from '../src/actor-run'
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
// board 0112 REIFICATION — goals are entities now; the goals ACTOR owns the grid + rename/merge/delete
// (resolving the user's NAMES to entity ids). Test the real user path with a live ctx.
const goalsCtx = {
	userId: UID,
	data: (a: Parameters<typeof crud>[1]) => crud(UID, a),
	ops: (n: string, p?: Record<string, unknown>) => runNamedOp(UID, n, p ?? {})
}
const runGoals = (raw: Record<string, unknown>) =>
	TOOL_ACTORS.goals.handle(goalsCtx as never, raw) as Promise<{
		content: { goals?: { key: string; total: number; done: number }[] }
	}>
const goalNames = async (): Promise<string[]> =>
	(((await runNamedOp(UID, 'goal.list', {})) as { rows?: { name?: string }[] }).rows ?? []).map((g) =>
		String(g.name)
	)

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

	test('GOALS: the goals actor grids goal ENTITIES with per-goal counts (reified)', async () => {
		// the aggregate keys by goal ID now; the actor maps id→name off goal.list and includes EMPTY goals.
		const grid = (await runGoals({})).content.goals ?? []
		const m = Object.fromEntries(grid.map((g) => [g.key, g.total]))
		expect(m.Fitness).toBe(1) // meal prep (gym moved out then cleared)
		expect(m.Admin).toBe(1)
		expect(m.Health).toBe(0) // the emptied goal still EXISTS as an entity — impossible pre-reification
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

	test('GOAL MERGE (reified): merging Admin into Fitness repoints memberships + drops the Admin entity', async () => {
		await runGoals({ rename: { from: 'Admin', to: 'Fitness' } })
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(all, 'file taxes')?.goal).toBe('Fitness') // moved to the surviving goal by ID
		expect(await goalNames()).not.toContain('Admin') // the merged-away ENTITY is gone
		const grid = (await runGoals({})).content.goals ?? []
		expect(grid.find((g) => g.key === 'Fitness')?.total).toBe(2) // meal prep + file taxes
	})

	test('GOAL RENAME (reified): renaming onto a NEW name relabels the SAME entity (one edit)', async () => {
		const before = ((await runNamedOp(UID, 'goal.list', {})) as { rows?: { id?: string; name?: string }[] })
			.rows?.find((g) => g.name === 'Fitness')?.id
		await runGoals({ rename: { from: 'Fitness', to: 'Wellness' } })
		const after = ((await runNamedOp(UID, 'goal.list', {})) as { rows?: { id?: string; name?: string }[] })
			.rows?.find((g) => g.name === 'Wellness')?.id
		expect(after).toBe(before) // SAME entity id — a relabel, not a new goal
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(all, 'meal prep')?.goal).toBe('Wellness') // its members follow the rename for free
	})

	test('GOAL DELETE (reified): removing a goal dissolves memberships (tasks survive) + drops the entity', async () => {
		await runGoals({ remove: { name: 'Wellness' } })
		const all = items(await crud(UID, { schema: 'todos', action: 'list' }))
		expect(byTitle(all, 'meal prep')).toBeDefined() // the tasks still exist…
		expect(byTitle(all, 'file taxes')).toBeDefined()
		expect(byTitle(all, 'meal prep')?.goal).toBeNull() // …just without the goal
		expect(byTitle(all, 'file taxes')?.goal).toBeNull()
		expect(await goalNames()).not.toContain('Wellness') // the entity itself is gone
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
