import { randomUUID } from 'node:crypto'
import Ajv from 'ajv'
import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
import { db } from './db'
import { publish } from './events'

// Generic, schema-driven user data store. `data_schema` rows are JSON Schema definitions;
// `data_value` rows reference a schema and hold a JSONB value validated against it on write.
// Everything is scoped to the authenticated user. board 0053.

const ajv = new Ajv({ allErrors: true, strict: false })

/** jsonb reads come back as objects on the pg/Neon driver; be defensive about strings. */
function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

/** A jsonb write: JSON-encode + cast, so it works regardless of driver param handling. */
function jsonb(value: unknown) {
	return sql<unknown>`${JSON.stringify(value)}::jsonb`
}

async function userId(c: Context): Promise<string | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	return session?.user?.id ?? null
}

/** Validate `data` against a JSON Schema; returns an array of error strings, or null if valid. */
function validate(jsonSchema: unknown, data: unknown): string[] | null {
	let check: ReturnType<typeof ajv.compile>
	try {
		check = ajv.compile(jsonSchema as object)
	} catch (e) {
		return [`invalid schema: ${e instanceof Error ? e.message : String(e)}`]
	}
	if (check(data)) return null
	return (check.errors ?? []).map((e) =>
		`${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim()
	)
}

// ── Schemas ──────────────────────────────────────────────────────────────────

/** POST /api/data/schemas — create or update (by name) a schema. */
export async function createSchema(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const body = (await c.req.json().catch(() => null)) as {
		name?: string
		jsonSchema?: unknown
	} | null
	if (!body?.name || typeof body.jsonSchema !== 'object' || body.jsonSchema === null) {
		return c.json({ error: 'name and jsonSchema (object) required' }, 400)
	}
	try {
		ajv.compile(body.jsonSchema as object) // reject a malformed schema up front
	} catch (e) {
		return c.json({ error: `invalid jsonSchema: ${e instanceof Error ? e.message : e}` }, 400)
	}
	const existing = await db()
		.selectFrom('data_schema')
		.select('id')
		.where('user_id', '=', uid)
		.where('name', '=', body.name)
		.executeTakeFirst()
	const id = existing?.id ?? randomUUID()
	if (existing) {
		await db()
			.updateTable('data_schema')
			.set({ json_schema: jsonb(body.jsonSchema), updated_at: new Date() })
			.where('id', '=', id)
			.execute()
	} else {
		await db()
			.insertInto('data_schema')
			.values({
				id,
				user_id: uid,
				name: body.name,
				json_schema: jsonb(body.jsonSchema),
				created_at: new Date(),
				updated_at: new Date()
			})
			.execute()
	}
	publish(uid, { entity: 'data' })
	return c.json({ id, name: body.name, jsonSchema: body.jsonSchema })
}

/** Server-side: register/upsert a named JSON Schema for a user (idempotent). Returns the schema id.
 *  Used by the document-extract loop to ensure the doctype schema exists before storing a value
 *  (the same data_schema table the todos/data_crud path uses). board 0064. */
export async function ensureDocSchema(
	uid: string,
	name: string,
	jsonSchema: unknown
): Promise<string> {
	try {
		ajv.compile(jsonSchema as object) // reject a malformed schema up front
	} catch (e) {
		throw new Error(`invalid schema "${name}": ${e instanceof Error ? e.message : String(e)}`)
	}
	const existing = await db()
		.selectFrom('data_schema')
		.select('id')
		.where('user_id', '=', uid)
		.where('name', '=', name)
		.executeTakeFirst()
	if (existing) {
		await db()
			.updateTable('data_schema')
			.set({ json_schema: jsonb(jsonSchema), updated_at: new Date() })
			.where('id', '=', existing.id)
			.execute()
		return existing.id
	}
	const id = randomUUID()
	await db()
		.insertInto('data_schema')
		.values({
			id,
			user_id: uid,
			name,
			json_schema: jsonb(jsonSchema),
			created_at: new Date(),
			updated_at: new Date()
		})
		.execute()
	publish(uid, { entity: 'data' })
	return id
}

/** GET /api/data/schemas — the user's schemas. */
export async function listSchemas(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const rows = await db()
		.selectFrom('data_schema')
		.select(['id', 'name', 'json_schema'])
		.where('user_id', '=', uid)
		.orderBy('name', 'asc')
		.execute()
	return c.json({
		schemas: rows.map((r) => ({ id: r.id, name: r.name, jsonSchema: asJson(r.json_schema) }))
	})
}

// ── Values ───────────────────────────────────────────────────────────────────

async function loadOwnedSchema(uid: string, schemaId: string) {
	return db()
		.selectFrom('data_schema')
		.select(['id', 'json_schema'])
		.where('id', '=', schemaId)
		.where('user_id', '=', uid)
		.executeTakeFirst()
}

/** POST /api/data/schemas/:schemaId/values — create a value (validated against the schema). */
export async function createValue(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const schemaId = c.req.param('schemaId')
	if (!schemaId) return c.json({ error: 'schemaId required' }, 400)
	const schema = await loadOwnedSchema(uid, schemaId)
	if (!schema) return c.json({ error: 'schema not found' }, 404)
	const body = (await c.req.json().catch(() => null)) as { data?: unknown } | null
	const errors = validate(asJson(schema.json_schema), body?.data)
	if (errors) return c.json({ error: 'validation', details: errors }, 400)
	const id = randomUUID()
	await db()
		.insertInto('data_value')
		.values({
			id,
			user_id: uid,
			schema_id: schemaId,
			data: jsonb(body?.data),
			created_at: new Date(),
			updated_at: new Date()
		})
		.execute()
	publish(uid, { entity: 'data' })
	return c.json({ id, schemaId, data: body?.data })
}

/** GET /api/data/schemas/:schemaId/values — the user's values for a schema (oldest first). */
export async function listValues(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const schemaId = c.req.param('schemaId')
	if (!schemaId) return c.json({ error: 'schemaId required' }, 400)
	const rows = await db()
		.selectFrom('data_value')
		.select(['id', 'data', 'created_at'])
		.where('user_id', '=', uid)
		.where('schema_id', '=', schemaId)
		.orderBy('created_at', 'asc')
		.execute()
	return c.json({ values: rows.map((r) => ({ id: r.id, data: asJson(r.data) })) })
}

/** PATCH /api/data/values/:id — replace a value's data (re-validated against its schema). */
export async function updateValue(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	const row = await db()
		.selectFrom('data_value')
		.select(['id', 'schema_id'])
		.where('id', '=', id)
		.where('user_id', '=', uid)
		.executeTakeFirst()
	if (!row) return c.json({ error: 'not found' }, 404)
	const schema = await loadOwnedSchema(uid, row.schema_id)
	if (!schema) return c.json({ error: 'schema not found' }, 404)
	const body = (await c.req.json().catch(() => null)) as { data?: unknown } | null
	const errors = validate(asJson(schema.json_schema), body?.data)
	if (errors) return c.json({ error: 'validation', details: errors }, 400)
	await db()
		.updateTable('data_value')
		.set({ data: jsonb(body?.data), updated_at: new Date() })
		.where('id', '=', id)
		.execute()
	publish(uid, { entity: 'data' })
	return c.json({ id, data: body?.data })
}

/** DELETE /api/data/values/:id — remove a value the user owns. */
export async function deleteValue(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	await db().deleteFrom('data_value').where('id', '=', id).where('user_id', '=', uid).execute()
	publish(uid, { entity: 'data' })
	return c.json({ ok: true, id })
}

// ── LLM tool executor ──────────────────────────────────────────────────────────
// Runs the generic `data_crud` tool (schema @avenos/aven-vibes/tools) against the store,
// scoped to a user. Validates writes against the schema; never throws (returns {ok,...}).

type DataCrudArgs = {
	schema?: string
	action?: 'list' | 'create' | 'update' | 'delete'
	items?: Record<string, unknown>[]
	id?: string
}

/** A system-prompt hint listing the user's schemas + their JSON Schema, so the LLM uses
 *  the exact field names when calling data_crud (else writes fail validation). */
export async function schemasPromptHint(uid: string): Promise<string> {
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	if (rows.length === 0) return ''
	const lines = rows.map((r) => `- ${r.name}: ${JSON.stringify(asJson(r.json_schema))}`)
	return `The data_crud tool operates on these schemas for the current user. Use EXACTLY these field names (values are validated against the schema):\n${lines.join('\n')}`
}

export async function executeDataTool(uid: string, args: DataCrudArgs): Promise<unknown> {
	const name = args?.schema
	if (!name) return { ok: false, error: 'schema name required' }
	const schema = await db()
		.selectFrom('data_schema')
		.select(['id', 'json_schema'])
		.where('user_id', '=', uid)
		.where('name', '=', name)
		.executeTakeFirst()
	if (!schema) return { ok: false, error: `no schema named "${name}"` }
	const jsonSchema = asJson(schema.json_schema)

	if (args.action === 'list') {
		const rows = await db()
			.selectFrom('data_value')
			.select(['id', 'data'])
			.where('user_id', '=', uid)
			.where('schema_id', '=', schema.id)
			.orderBy('created_at', 'asc')
			.execute()
		return {
			ok: true,
			action: 'list',
			items: rows.map((r) => ({ id: r.id, ...(asJson(r.data) as object) }))
		}
	}

	if (args.action === 'create') {
		const created: string[] = []
		const errors: string[] = []
		for (const item of args.items ?? []) {
			const e = validate(jsonSchema, item)
			if (e) {
				errors.push(...e)
				continue
			}
			const id = randomUUID()
			await db()
				.insertInto('data_value')
				.values({
					id,
					user_id: uid,
					schema_id: schema.id,
					data: jsonb(item),
					created_at: new Date(),
					updated_at: new Date()
				})
				.execute()
			created.push(id)
		}
		if (created.length > 0) publish(uid, { entity: 'data' })
		return { ok: errors.length === 0, action: 'create', created, errors }
	}

	if (args.action === 'update') {
		const updated: string[] = []
		const errors: string[] = []
		for (const item of args.items ?? []) {
			const { id, ...patch } = item as { id?: string } & Record<string, unknown>
			if (!id) {
				errors.push('update item missing id')
				continue
			}
			const owns = await db()
				.selectFrom('data_value')
				.select(['id', 'data'])
				.where('id', '=', id)
				.where('user_id', '=', uid)
				.executeTakeFirst()
			if (!owns) {
				errors.push(`no value ${id}`)
				continue
			}
			// MERGE the patch onto the existing value (PATCH semantics): a partial update keeps the other
			// fields, and validation runs on the MERGED object so required fields stay satisfied. Without
			// this a partial update (e.g. set one field) failed validation + wiped the rest. board 0082.
			const merged = { ...(asJson(owns.data) as Record<string, unknown>), ...patch }
			const e = validate(jsonSchema, merged)
			if (e) {
				errors.push(...e)
				continue
			}
			await db()
				.updateTable('data_value')
				.set({ data: jsonb(merged), updated_at: new Date() })
				.where('id', '=', id)
				.execute()
			updated.push(id)
		}
		if (updated.length > 0) publish(uid, { entity: 'data' })
		return { ok: errors.length === 0, action: 'update', updated, errors }
	}

	if (args.action === 'delete') {
		if (!args.id) return { ok: false, error: 'delete requires id' }
		await db()
			.deleteFrom('data_value')
			.where('id', '=', args.id)
			.where('user_id', '=', uid)
			.execute()
		publish(uid, { entity: 'data' })
		return { ok: true, action: 'delete', deleted: [args.id] }
	}

	return { ok: false, error: `unknown action: ${args.action}` }
}
