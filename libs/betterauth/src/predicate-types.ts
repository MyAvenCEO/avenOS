import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
import { db } from './db'

// Admin-owned CRUD for the composite TYPE registry (board 0088, Layer A). A "type" is a declarative
// bundle spec (an aven-ontology TypeSpec) over x1–x5 predications — platform structure, NOT user
// data — so (like /api/admin/flows) these routes are admin-only. The generic engine in data.ts
// loads a spec from here to run CRUD/projection for any registered type. [[two-layer-schema-split]]

/** 401 if unauthenticated, 403 if not an admin, else null (proceed). Mirrors flows.ts:adminGate. */
async function adminGate(c: Context): Promise<Response | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if ((session.user as { role?: string }).role !== 'admin')
		return c.json({ error: 'admin_only' }, 403)
	return null
}

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

function jsonb(value: unknown) {
	return sql<unknown>`${JSON.stringify(value ?? null)}::jsonb`
}

/** GET /api/admin/types — all registered type specs (admin only). */
export async function listTypes(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const rows = await db()
		.selectFrom('predicate_type')
		.select(['type', 'spec'])
		.orderBy('type', 'asc')
		.execute()
	return c.json({ types: rows.map((r) => ({ type: r.type, spec: asJson(r.spec) })) })
}

/** GET /api/admin/types/:type — one type spec (admin only). */
export async function getType(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const type = c.req.param('type')
	if (!type) return c.json({ error: 'type required' }, 400)
	const row = await db()
		.selectFrom('predicate_type')
		.select(['type', 'spec'])
		.where('type', '=', type)
		.executeTakeFirst()
	if (!row) return c.json({ error: 'not found' }, 404)
	return c.json({ type: row.type, spec: asJson(row.spec) })
}

/** POST /api/admin/types — create/update (by type) a type spec (admin only). */
export async function upsertType(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const body = (await c.req.json().catch(() => null)) as { type?: string; spec?: unknown } | null
	const spec = body?.spec as { parts?: unknown; project?: unknown } | undefined
	if (!body?.type || !spec || !Array.isArray(spec.parts) || !spec.project) {
		return c.json({ error: 'type + spec{parts[],project} required' }, 400)
	}
	await db()
		.insertInto('predicate_type')
		.values({ type: body.type, spec: jsonb(spec), created_at: new Date(), updated_at: new Date() })
		.onConflict((oc) => oc.column('type').doUpdateSet({ spec: jsonb(spec), updated_at: new Date() }))
		.execute()
	return c.json({ type: body.type })
}

/** DELETE /api/admin/types/:type — remove a type spec (admin only). */
export async function deleteType(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const type = c.req.param('type')
	if (!type) return c.json({ error: 'type required' }, 400)
	await db().deleteFrom('predicate_type').where('type', '=', type).execute()
	return c.json({ ok: true, type })
}
