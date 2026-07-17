import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { db } from '../src/db'
import { composeFlows } from '../src/flows'
import { recordActorRun } from '../src/skills-run'

// board 0114 — ONE skill config: the Skills read-model derives every skill's flow from its actor rows
// (label from skill.label — Planner, not the stale "Todos" seed; a config-minted skill is INSTANTLY
// visible), an edge-carrying flow row overrides the derived graph, and tracing is keyed generically by
// (routed skill, actor name) so every skill's tool calls land in Runs.

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
const UID = `test-readmodel-${randomUUID().slice(0, 8)}`

d('board 0114 — the Skills read-model + generic tracing', () => {
	test('every skill row appears, graph DERIVED from actor rows (inventory included)', async () => {
		const flows = await composeFlows()
		const inv = flows.find((f) => f.id === 'inventory')
		expect(inv).toBeDefined()
		expect(inv?.name).toBe('Inventory')
		// sync_* connectors are DYNAMIC user config (board 0117) — the fixed core must be there,
		// whatever connectors the user has wired.
		expect(
			(inv?.nodes as { id: string }[]).map((n) => n.id).filter((id) => !id.startsWith('sync_'))
		).toEqual(['data_crud', 'locations'])
	})

	test('the Planner is the LIVING explicit-flow override: mode nodes + step vibes, no dispatch', async () => {
		// board 0114/0088/0119r — a flow row with STEP-LEVEL config (per-node vibes — richness one
		// actor row cannot express) overrides the derived hub. The dispatcher routes; it is NOT a
		// step inside skill flows (it has its own system skill), so no dispatch node/edges here.
		// Name comes from the flow row and MUST say Planner (the stale "Todos" seed name was the
		// original drift).
		const flows = await composeFlows()
		const planner = flows.find((f) => f.id === 'todos')
		expect(planner?.name).toBe('Planner')
		const nodes = planner?.nodes as { id: string; vibe?: string }[]
		expect(nodes.map((n) => n.id).sort()).toEqual(['create', 'delete', 'edit', 'goals', 'read'])
		expect(Object.fromEntries(nodes.filter((n) => n.vibe).map((n) => [n.id, n.vibe]))).toEqual({
			read: 'todos',
			create: 'todos-created',
			edit: 'todos-edited',
			delete: 'todos-deleted',
			goals: 'goals'
		})
		expect(nodes.some((n) => n.id === 'dispatch')).toBe(false)
	})

	test('an EDGE-carrying flow row overrides the derived graph', async () => {
		await sql`
			INSERT INTO flow (id, name, description, nodes, edges, created_at, updated_at)
			VALUES ('website', 'Website (orchestrated)', 'override probe',
				${JSON.stringify([{ id: 'a', name: 'A', inputs: ['intent'], outputs: ['site'] }])}::jsonb,
				${JSON.stringify([{ from: 'a', to: 'a' }])}::jsonb, now(), now())
			ON CONFLICT (id) DO UPDATE SET edges = EXCLUDED.edges, name = EXCLUDED.name
		`.execute(db())
		try {
			const flows = await composeFlows()
			const site = flows.find((f) => f.id === 'website')
			expect(site?.name).toBe('Website (orchestrated)') // the override won
			expect((site?.nodes as unknown[]).length).toBe(1)
		} finally {
			await sql`DELETE FROM flow WHERE id = 'website'`.execute(db())
		}
	})

	test('traces are keyed by (routed skill, actor name) — inventory runs land in flow_run', async () => {
		await recordActorRun(UID, {
			flowId: 'inventory',
			nodeId: 'data_crud',
			label: 'list inventory',
			outputs: ['inventory']
		})
		await recordActorRun(UID, {
			flowId: 'inventory',
			nodeId: 'locations',
			label: 'locations',
			outputs: ['inventory-locations']
		})
		const r = await sql<{ flow_id: string; label: string }>`
			SELECT flow_id, label FROM flow_run WHERE user_id = ${UID} ORDER BY created_at
		`.execute(db())
		expect(r.rows.map((x) => x.flow_id)).toEqual(['inventory', 'inventory'])
		expect(r.rows.map((x) => x.label)).toEqual(['list inventory', 'locations'])
	})

	afterAll(async () => {
		if (!DB) return
		await sql`DELETE FROM flow_run WHERE user_id = ${UID}`.execute(db())
	})
})
