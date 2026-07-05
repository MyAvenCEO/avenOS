import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
import { type ActorRow, readActors, readSkills, type SkillRow } from './config'
import { db } from './db'

// Admin-owned CRUD for flow/skill CONFIG templates (board 0087, Layer A). These are platform
// structure, NOT user data — so unlike /api/data/* (user-scoped) these routes are admin-only.
// The Skills/Runs UI reads flows from here instead of a static JSON import. [[two-layer-schema-split]]

/** 401 if unauthenticated, 403 if not an admin, else null (proceed). Mirrors inbox.ts:adminGate. */
async function adminGate(c: Context): Promise<Response | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if ((session.user as { role?: string }).role !== 'admin')
		return c.json({ error: 'admin_only' }, 403)
	return null
}

/** jsonb reads come back parsed on the pg/Neon driver; be defensive about strings. */
function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

function jsonb(value: unknown) {
	return sql<unknown>`${JSON.stringify(value ?? null)}::jsonb`
}

type FlowRow = {
	id: string
	name: string
	description: string
	nodes: unknown
	edges: unknown
	triggers: unknown
	resource_labels: unknown
}

/** Row → the `Flow` wire shape the UI expects. */
function toFlow(r: FlowRow) {
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		nodes: asJson(r.nodes),
		edges: asJson(r.edges),
		triggers: asJson(r.triggers) ?? undefined,
		resourceLabels: asJson(r.resource_labels) ?? undefined
	}
}

// board 0114 — the ONE Skills read-model: every `skill` row becomes a Flow DERIVED from its actor rows
// (hub layout — actors as nodes, nothing to hand-seed, so a config-minted skill is INSTANTLY visible and
// the label always matches skill.label — Planner, not the stale "Todos" seed). A `flow` row overrides the
// derived graph ONLY when it expresses something the hub cannot: EDGES (real orchestration) or
// STEP-LEVEL node config (per-step vibe/hitl/flowRef — e.g. crud mode nodes sharing one data_crud
// actor, each with its own vibe). Plain edge-less hub seeds are thereby retired without a migration.
// board 0119r — the dispatcher routes; it is NOT a step inside skill flows (it has its own system
// skill), so skill flow rows no longer carry dispatch nodes/star-edges. Flow rows whose id matches
// no skill (demos) pass through unchanged.
type WireFlow = ReturnType<typeof toFlow>

/** Derive a skill's hub Flow from its actor rows. */
function deriveFlow(skill: SkillRow, actors: ActorRow[]): WireFlow {
	return {
		id: skill.id,
		name: skill.label,
		description: skill.description,
		nodes: actors.map((a) => ({
			id: a.name,
			name: a.name.replace(/_/g, ' '),
			actor: a.engine ?? a.name,
			inputs: ['intent'],
			outputs: [skill.id],
			note: a.mailbox?.description ?? undefined,
			system_prompt: a.prompt ?? undefined,
			context: a.context?.map((arg) => ({ arg })) ?? undefined,
			vibe: a.vibe ?? undefined
		})),
		edges: [],
		triggers: undefined,
		resourceLabels: undefined
	}
}

/** The composed Skills read-model: derived-from-actors; edge-carrying flow rows override; demos append. */
export async function composeFlows(): Promise<WireFlow[]> {
	const [skills, actors, flowRows] = await Promise.all([
		readSkills(),
		readActors(),
		db()
			.selectFrom('flow')
			.select(['id', 'name', 'description', 'nodes', 'edges', 'triggers', 'resource_labels'])
			.orderBy('name', 'asc')
			.execute()
	])
	const byId = new Map(flowRows.map((r) => [r.id, r]))
	const skillIds = new Set(skills.map((s) => s.id))
	const out: WireFlow[] = skills.map((s) => {
		const override = byId.get(s.id)
		const edges = override ? ((asJson(override.edges) as unknown[] | null) ?? []) : []
		const nodes = override
			? ((asJson(override.nodes) as { vibe?: unknown; hitl?: unknown; flowRef?: unknown }[] | null) ?? [])
			: []
		const explicit =
			edges.length > 0 || nodes.some((n) => n.vibe != null || n.hitl != null || n.flowRef != null)
		return override && explicit
			? toFlow(override)
			: deriveFlow(
					s,
					actors.filter((a) => a.skill_id === s.id)
				)
	})
	for (const r of flowRows) if (!skillIds.has(r.id)) out.push(toFlow(r)) // standalone demo flows
	return out
}

/** GET /api/admin/flows — the composed Skills read-model (admin only). board 0114. */
export async function listFlows(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	return c.json({ flows: await composeFlows() })
}

/** GET /api/admin/flows/:id — one flow from the composed read-model (derived flows included). */
export async function getFlow(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	const flow = (await composeFlows()).find((f) => f.id === id)
	if (!flow) return c.json({ error: 'not found' }, 404)
	return c.json(flow)
}

/** POST /api/admin/flows — create/update (by id) a flow config (admin only). */
export async function upsertFlow(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const body = (await c.req.json().catch(() => null)) as {
		id?: string
		name?: string
		description?: string
		nodes?: unknown
		edges?: unknown
		triggers?: unknown
		resourceLabels?: unknown
	} | null
	if (!body?.name || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
		return c.json({ error: 'name, nodes[] and edges[] required' }, 400)
	}
	const id = body.id?.trim() || randomUUID()
	await db()
		.insertInto('flow')
		.values({
			id,
			name: body.name,
			description: body.description ?? '',
			nodes: jsonb(body.nodes),
			edges: jsonb(body.edges),
			triggers: jsonb(body.triggers ?? null),
			resource_labels: jsonb(body.resourceLabels ?? null)
		})
		.onConflict((oc) =>
			oc.column('id').doUpdateSet({
				name: body.name as string,
				description: body.description ?? '',
				nodes: jsonb(body.nodes),
				edges: jsonb(body.edges),
				triggers: jsonb(body.triggers ?? null),
				resource_labels: jsonb(body.resourceLabels ?? null),
				updated_at: new Date()
			})
		)
		.execute()
	return c.json({ id })
}

/** DELETE /api/admin/flows/:id — remove a flow config (admin only). */
export async function deleteFlow(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	await db().deleteFrom('flow').where('id', '=', id).execute()
	return c.json({ ok: true, id })
}
