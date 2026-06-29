import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
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

/** GET /api/admin/flows — all flow configs (admin only). */
export async function listFlows(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const rows = await db()
		.selectFrom('flow')
		.select(['id', 'name', 'description', 'nodes', 'edges', 'triggers', 'resource_labels'])
		.orderBy('name', 'asc')
		.execute()
	return c.json({ flows: rows.map(toFlow) })
}

/** GET /api/admin/flows/:id — one flow config (admin only). */
export async function getFlow(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	const row = await db()
		.selectFrom('flow')
		.select(['id', 'name', 'description', 'nodes', 'edges', 'triggers', 'resource_labels'])
		.where('id', '=', id)
		.executeTakeFirst()
	if (!row) return c.json({ error: 'not found' }, 404)
	return c.json(toFlow(row))
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
