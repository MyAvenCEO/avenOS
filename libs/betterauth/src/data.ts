import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import type { DataCrudArgs } from '@avenos/skills/tools'
import Ajv from 'ajv'
import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
import { registerContextProvider } from './context'
import { crud } from './actor-run'
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
		.select(['id', 'data', 'x1', 'x2', 'x3', 'x4', 'x5', 'created_at'])
		.where('user_id', '=', uid)
		.where('schema_id', '=', schemaId)
		.orderBy('created_at', 'asc')
		.execute()
	// board 0104+ writes populate the x1–x5 predication columns and leave the legacy `data` jsonb NULL on
	// those rows. Read the x-columns as the source of truth (same {x1..x5} shape the viewer projects),
	// falling back to the legacy jsonb only for pre-migration rows — otherwise every new predication renders
	// as an empty "ghost" row in the DB viewer (and its label is missing from ref resolution). board 0106.
	return c.json({
		values: rows.map((r) => {
			const fromX: Record<string, unknown> = {}
			for (const k of ['x1', 'x2', 'x3', 'x4', 'x5'] as const) {
				if (r[k] !== null && r[k] !== undefined) fromX[k] = r[k]
			}
			return { id: r.id, data: Object.keys(fromX).length > 0 ? fromX : asJson(r.data) }
		})
	})
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

/** Resolve the id(s) a delete targets: explicit `ids`, a single `id`, or the ids inside `items`. */
function deleteIds(args: DataCrudArgs): string[] {
	if (args.ids?.length) return args.ids.filter((x) => typeof x === 'string' && x)
	if (args.id) return [args.id]
	return (args.items ?? [])
		.map((i) => (i as { id?: string }).id)
		.filter((x): x is string => typeof x === 'string' && !!x)
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
			'CLEAN THE TITLE — write each `title` as a tidy, correctly-spelled item: silently fix obvious ' +
			'misspellings and speech-to-text garbles (e.g. "anandas" → "Ananas", "mandarina" → "Mandarine"), ' +
			'and strip filler / nonsense / duplicate tokens, keeping ONLY the real item (e.g. "akdjfasg ' +
			'pineapple" → "Pineapple", "buy buy milk" → "Buy milk"). Keep the user\'s language and any real ' +
			'quantity ("3 apples" stays "3 apples"); never invent details the user did not say. ' +
			'Never query the underlying data types (task/valid/due/prioritized) directly.'
	)
	const now = new Date()
	// Inject a compact snapshot of the CURRENT todos (id · title · done) so the model can `update` /
	// `delete` a task by id in ONE round — WITHOUT a preceding `list` call. Cutting that extra gemma
	// round is the single biggest latency win for "mark X done" / "delete Y". board 0099.
	let todosSnapshot = '\n\nCURRENT TODOS: (none yet).'
	try {
		const res = (await crud(uid, { schema: 'todos', action: 'list' })) as {
			items?: { id: string; title?: string; done?: boolean }[]
		}
		// SHORT ids (8 chars) — gemma can't copy 36-char UUIDs verbatim (it hallucinates them, so the
		// update/delete misses); 8 hex chars are reliable and the server resolves them back. board 0099.
		const list = (res.items ?? [])
			.map(
				(task) =>
					`${String(task.id).slice(0, 8)} · "${task.title ?? ''}"${task.done ? ' ✓done' : ''}`
			)
			.join('\n')
		if (list)
			todosSnapshot = `\n\nCURRENT TODOS (id · title · done) — for update/delete pass the exact 8-char id shown here as \`id\` (or in \`ids\` for a batch delete); do NOT call list first, and NEVER invent an id:\n${list}`
	} catch {
		/* best-effort snapshot; the model can still list */
	}
	return `Current date & time: ${now.toISOString()} — resolve any relative dates the user mentions ("today", "tomorrow", "in 3 days", "next Monday") against THIS instant; emit absolute ISO dates.\n\nThe data_crud tool operates on these schemas for the current user. Use EXACTLY these field names (values are validated against the schema):\n${lines.join('\n')}${todosSnapshot}\n\nIMPORTANT: the current todos are listed above — for update/delete, reference their ids DIRECTLY (one tool call, no preceding list). Only call data_crud action="list" schema="todos" when the user explicitly asks to SEE / show / list / check their todos (any wording, any language) — that re-renders their live card. Never answer about todos from memory with a plain-text list.`
}



/** A registered bundle's spec from the `data_bundles` registry — the transparency provider's read. */
async function bundleSpec(name: string): Promise<TypeSpec | null> {
	const row = await db()
		.selectFrom('data_bundles')
		.select('spec')
		.where('type', '=', name)
		.executeTakeFirst()
	return row ? (asJson(row.spec) as TypeSpec) : null
}

// board 0100 — a UNIVERSAL "type" context provider: given a type name (arg), expose HOW `data_crud`
// actually queries + mutates it under the hood — the composite `TypeSpec` (the x1–x5 projection recipe:
// which predicate each field maps to, the part kinds + links) PLUS each involved atomic predicate's
// JSON-Schema (the AJV validation). Wired onto the data_crud actor nodes, so the Skills/Runs config aside
// transparently shows the multi-predicate machinery + schemas behind a simple `data_crud` call.
registerContextProvider('type', async (uid, arg) => {
	const name = arg ?? ''
	const spec = await bundleSpec(name)
	if (!spec) return { kind: 'text', label: `${name} type`, text: `(no registered type "${name}")` }
	const preds = new Set<string>()
	const collect = async (s: TypeSpec): Promise<void> => {
		for (const p of s.parts) {
			preds.add(p.pred)
			const sub = (p as { sub?: string }).sub
			if (sub) {
				const child = await bundleSpec(sub)
				if (child) await collect(child)
			}
		}
	}
	await collect(spec)
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	const predicate_schemas: Record<string, unknown> = {}
	for (const r of rows) if (preds.has(r.name)) predicate_schemas[r.name] = asJson(r.json_schema)
	return {
		kind: 'text',
		label: `${name} — projection recipe + predicate schemas`,
		text: JSON.stringify({ type: spec.type, projection: spec, predicate_schemas }, null, 2),
		meta: { predicates: preds.size, source: 'data_bundles + data_schema' }
	}
})


// ── Todos REST (board 0087) ─────────────────────────────────────────────────────
// The Todos vibe UI reads/writes through these, which delegate to the SAME generic engine path
// (the `todos` registered type) the LLM's data_crud tool uses — one source of truth, projected
// by the aven-ontology matcher. board 0088.

/** GET /api/data/todos — the user's todos (projected by the generic engine). */
export async function listTodos(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	// board 0107 — the universal {field,value,op} filter rides as a JSON query param so the vibe's OWN fetch
	// returns the filtered subset (one data path: vibe → here → crud → engine).
	const raw = c.req.query('filter')
	let filter: DataCrudArgs['filter']
	if (raw) {
		try {
			filter = JSON.parse(raw)
		} catch {
			/* ignore a malformed filter → full list */
		}
	}
	const res = (await crud(uid, { schema: 'todos', action: 'list', filter })) as {
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
	// board 0112 — through the ONE engine: a registered bundle's list op is seeded at mint time.
	const res = (await crud(uid, { schema: type, action: 'list' })) as { items?: unknown[] }
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
		(await crud(uid, {
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
		(await crud(uid, {
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
	return c.json((await crud(uid, { schema: 'todos', action: 'delete', id })) as object)
}

