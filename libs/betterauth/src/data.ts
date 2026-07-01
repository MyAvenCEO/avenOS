import { randomUUID } from 'node:crypto'
import { create, query, remove, update } from '@avenos/aven-ontology'
import type { Cell, PredicationStore, TypeSpec } from '@avenos/aven-ontology'
import {
	contactPredicateSchemas,
	documentPredicateSchemas,
	invoicePredicateSchemas,
	todoPredicateSchemas
} from '@avenos/aven-vibes/predicate'
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
	// The atomic x1–x5 data types (task/valid/due/prioritized) are NOT exposed to the model — todos
	// are managed ONLY through the consolidated `todos` type, which writes that bundle underneath
	// (the generic ontology engine). Identify those data types by their `predicate` discriminator (no prefix —
	// the bare name is the universal data type). Never let the model query them directly. board 0087.
	const lines = rows
		.filter((r) => {
			const s = asJson(r.json_schema) as { properties?: Record<string, unknown> } | null
			return !s?.properties?.predicate
		})
		.map((r) => `- ${r.name}: ${JSON.stringify(asJson(r.json_schema))}`)
	// `todos` is virtual (backed by predications); describe its fields incl. due + priority.
	lines.unshift(
		'- todos: { "title": string, "done"?: boolean, "due"?: "YYYY-MM-DD", "priority"?: "high" | "medium" | "low" } — the ONE way to manage tasks. ' +
			'These are the ONLY fields — there is NO "valid", "from/until", or interval field; do not invent one. ' +
			'`due` is the DEADLINE: for "due/by/until/till <date>", "tomorrow", "next week", etc., set `due` to the resolved ABSOLUTE date as "YYYY-MM-DD" (use the current date above). ' +
			'`done` (boolean) = completed. `priority` is "high" | "medium" | "low". ' +
			'Never query the underlying data types (task/valid/due/prioritized) directly.'
	)
	const now = new Date()
	// Inject a compact snapshot of the CURRENT todos (id · title · done) so the model can `update` /
	// `delete` a task by id in ONE round — WITHOUT a preceding `list` call. Cutting that extra gemma
	// round is the single biggest latency win for "mark X done" / "delete Y". board 0099.
	let todosSnapshot = '\n\nCURRENT TODOS: (none yet).'
	try {
		const res = (await executeDataTool(uid, { schema: 'todos', action: 'list' })) as {
			items?: { id: string; title?: string; done?: boolean }[]
		}
		const list = (res.items ?? [])
			.map((task) => `${task.id} · "${task.title ?? ''}"${task.done ? ' ✓done' : ''}`)
			.join('\n')
		if (list)
			todosSnapshot = `\n\nCURRENT TODOS (id · title · done) — for update/delete use these ids DIRECTLY, do NOT call list first:\n${list}`
	} catch {
		/* best-effort snapshot; the model can still list */
	}
	return `Current date & time: ${now.toISOString()} — resolve any relative dates the user mentions ("today", "tomorrow", "in 3 days", "next Monday") against THIS instant; emit absolute ISO dates.\n\nThe data_crud tool operates on these schemas for the current user. Use EXACTLY these field names (values are validated against the schema):\n${lines.join('\n')}${todosSnapshot}\n\nIMPORTANT: the current todos are listed above — for update/delete, reference their ids DIRECTLY (one tool call, no preceding list). Only call data_crud action="list" schema="todos" when the user explicitly asks to SEE / show / list / check their todos (any wording, any language) — that re-renders their live card. Never answer about todos from memory with a plain-text list.`
}

/** Ensure the per-user gismu DATA-TYPE schemas (task/valid/due/prioritized) exist + are in sync.
 *  Returns predicate-name → schema_id — the map the engine's store resolves predicates through. */
async function ensurePredicateSchemas(uid: string): Promise<Record<string, string>> {
	const ids: Record<string, string> = {}
	// Seed every registered type's atomic data-type schemas (todo + document + invoice). board 0087/0089/0090.
	for (const { name, jsonSchema } of [
		...todoPredicateSchemas(),
		...documentPredicateSchemas(),
		...invoicePredicateSchemas(),
		...contactPredicateSchemas()
	]) {
		const existing = await db()
			.selectFrom('data_schema')
			.select('id')
			.where('user_id', '=', uid)
			.where('name', '=', name)
			.executeTakeFirst()
		if (existing) {
			// keep the stored schema in sync with the current vocab (gismu/place-structure edits)
			await db()
				.updateTable('data_schema')
				.set({ json_schema: jsonb(jsonSchema), updated_at: new Date() })
				.where('id', '=', existing.id)
				.execute()
			ids[name] = existing.id
			continue
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
		ids[name] = id
	}
	return ids
}

// ── The generic predication engine (board 0088) ─────────────────────────────────
// A composite TYPE (e.g. `todos`) is a declarative bundle spec in the `predicate_type` registry;
// the pure aven-ontology engine runs CRUD + projection against the x1–x5 predications with ZERO
// per-type code. `pgStore` adapts the engine's PredicationStore onto data_value (user-scoped).

/** Adapt the engine's PredicationStore onto data_value, resolving each predicate to its schema_id. */
function pgStore(uid: string, schemaIdByPred: Record<string, string>): PredicationStore {
	const schemaOf = (pred: string): string => {
		const id = schemaIdByPred[pred]
		if (!id) throw new Error(`[ontology] no data_schema for predicate "${pred}"`)
		return id
	}
	return {
		async rows(pred) {
			const r = await sql<{ id: string; data: Record<string, Cell> }>`
				SELECT id, data FROM data_value
				WHERE user_id = ${uid} AND schema_id = ${schemaOf(pred)} ORDER BY id
			`.execute(db())
			return r.rows.map((row) => {
				const d = asJson(row.data) as Record<string, Cell>
				// all five places — x4/x5 carry e.g. skicu's description + janta's biller. board 0092.
				return { id: row.id, x1: d.x1 ?? null, x2: d.x2 ?? null, x3: d.x3 ?? null, x4: d.x4 ?? null, x5: d.x5 ?? null }
			})
		},
		async insert(pred, cells) {
			const id = randomUUID()
			await db()
				.insertInto('data_value')
				.values({
					id,
					user_id: uid,
					schema_id: schemaOf(pred),
					data: jsonb({ predicate: pred, ...cells }),
					created_at: new Date(),
					updated_at: new Date()
				})
				.execute()
			return id
		},
		async patch(id, cells) {
			await sql`UPDATE data_value SET data = data || ${JSON.stringify(cells)}::jsonb, updated_at = now()
				WHERE id = ${id} AND user_id = ${uid}`.execute(db())
		},
		async patchWhere(pred, place, equals, cells) {
			await sql`UPDATE data_value SET data = data || ${JSON.stringify(cells)}::jsonb, updated_at = now()
				WHERE user_id = ${uid} AND schema_id = ${schemaOf(pred)} AND data->>${place} = ${equals}`.execute(
				db()
			)
		},
		async deleteWhere(pred, place, equals) {
			await sql`DELETE FROM data_value
				WHERE user_id = ${uid} AND schema_id = ${schemaOf(pred)} AND data->>${place} = ${equals}`.execute(
				db()
			)
		},
		async remove(id) {
			await db().deleteFrom('data_value').where('id', '=', id).where('user_id', '=', uid).execute()
		}
	}
}

/** Load a registered composite type's bundle spec from the admin-owned registry. */
export async function loadTypeSpec(name: string): Promise<TypeSpec | null> {
	const row = await db()
		.selectFrom('predicate_type')
		.select('spec')
		.where('type', '=', name)
		.executeTakeFirst()
	return row ? (asJson(row.spec) as TypeSpec) : null
}

/** Run a list/create/update/delete action for a registered type through the generic engine. */
async function runType(uid: string, spec: TypeSpec, args: DataCrudArgs): Promise<unknown> {
	const ids = await ensurePredicateSchemas(uid)
	const store = pgStore(uid, ids)
	const ctx = { user: uid, now: () => new Date().toISOString() }

	if (!args.action || args.action === 'list') {
		return { ok: true, action: 'list', items: await query(spec, store) }
	}
	if (args.action === 'create') {
		const created: string[] = []
		for (const item of args.items ?? []) {
			const id = await create(spec, store, item as Record<string, unknown>, ctx)
			if (id) created.push(id)
		}
		if (created.length > 0) publish(uid, { entity: 'data' })
		return { ok: true, action: 'create', created, errors: [] }
	}
	if (args.action === 'update') {
		const updated: string[] = []
		for (const item of args.items ?? []) {
			const id = await update(spec, store, item as Record<string, unknown>, ctx)
			if (id) updated.push(id)
		}
		if (updated.length > 0) publish(uid, { entity: 'data' })
		return { ok: true, action: 'update', updated, errors: [] }
	}
	if (args.action === 'delete') {
		const id = args.id ?? (args.items?.[0] as { id?: string } | undefined)?.id
		if (!id) return { ok: false, error: 'delete requires id' }
		await remove(spec, store, id)
		publish(uid, { entity: 'data' })
		return { ok: true, action: 'delete', deleted: [id] }
	}
	return { ok: false, error: `unknown action: ${args.action}` }
}

// ── Todos REST (board 0087) ─────────────────────────────────────────────────────
// The Todos vibe UI reads/writes through these, which delegate to the SAME generic engine path
// (the `todos` registered type) the LLM's data_crud tool uses — one source of truth, projected
// by the aven-ontology matcher. board 0088.

/** GET /api/data/todos — the user's todos (projected by the generic engine). */
export async function listTodos(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const res = (await executeDataTool(uid, { schema: 'todos', action: 'list' })) as {
		items?: unknown[]
	}
	return c.json({ todos: res.items ?? [] })
}

/** GET /api/data/type/:type — list ANY registered composite type's rows for the signed-in user (board
 *  0096). Lets the addressbook read `company`/`person` from the ontology, not the legacy contact store. */
export async function listDataType(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const type = c.req.param('type')
	if (!type) return c.json({ error: 'type required' }, 400)
	const res = (await executeDataTool(uid, { schema: type, action: 'list' })) as { items?: unknown[] }
	return c.json({ items: res.items ?? [] })
}

/** POST /api/data/todos — create todos (each {title, done?}). */
export async function createTodos(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const body = (await c.req.json().catch(() => null)) as {
		items?: Record<string, unknown>[]
	} | null
	return c.json(
		(await executeDataTool(uid, {
			schema: 'todos',
			action: 'create',
			items: body?.items ?? []
		})) as object
	)
}

/** PATCH /api/data/todos — update todos by id (title and/or done). */
export async function updateTodos(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const body = (await c.req.json().catch(() => null)) as {
		items?: Record<string, unknown>[]
	} | null
	return c.json(
		(await executeDataTool(uid, {
			schema: 'todos',
			action: 'update',
			items: body?.items ?? []
		})) as object
	)
}

/** DELETE /api/data/todos/:id — delete a todo (and the predications that ref it). */
export async function deleteTodo(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	return c.json((await executeDataTool(uid, { schema: 'todos', action: 'delete', id })) as object)
}

export async function executeDataTool(uid: string, args: DataCrudArgs): Promise<unknown> {
	const name = args?.schema
	if (!name) return { ok: false, error: 'schema name required' }
	// A registered composite TYPE (board 0088) routes through the generic predication engine —
	// no per-type code. Falls through to raw single-schema CRUD when the name isn't a registered type.
	const typeSpec = await loadTypeSpec(name)
	if (typeSpec) return runType(uid, typeSpec, args)
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
