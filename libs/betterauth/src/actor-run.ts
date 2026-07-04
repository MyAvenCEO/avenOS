import { sql } from 'kysely'
import type { TypeSpec } from '@avenos/aven-ontology'
import { type Caps, runActorCode } from './actor-sandbox'
import type { DataCrudArgs } from '@avenos/skills/tools'
import { type ActorRow, engineFor } from './config'
import { db } from './db'
import {
	type Filter,
	type OperationRow,
	type ProjectEntry,
	type QuerySpec,
	runOperation,
	runQuery
} from './queries'
import { ensureVocab } from './vocab'

// board 0111 — the actor RUNNER. An actor's behavior is bound either as sandboxed `code` (QuickJS-in-WASM,
// this card) or a by-name `engine` (the code registry, board 0110). A `code` actor runs in the sandbox with
// ONLY the capabilities its `caps` list grants, each wired here to a real host function. This is the SSOT
// seam: the chat tool loop AND the vibe UI post to the SAME actor row's mailbox.

/** Fetch a named `data_operations` row — the user's own, else the global (user_id NULL) one. */
export async function fetchOp(uid: string, name: string): Promise<OperationRow> {
	const r = await sql`
		SELECT id, name, kind, spec FROM data_operations
		WHERE name = ${name} AND (user_id = ${uid} OR user_id IS NULL)
		ORDER BY (user_id IS NULL) ASC LIMIT 1
	`.execute(db())
	const row = r.rows[0] as OperationRow | undefined
	if (!row) throw new Error(`ops: no operation "${name}"`)
	return row
}

/** Run a named `data_operations` row (query or mutation) with params — the `ops` capability. */
export async function runNamedOp(
	uid: string,
	name: string,
	params: Record<string, unknown>
): Promise<unknown> {
	return runOperation(uid, await fetchOp(uid, name), params)
}

/**
 * board 0107 — UNIVERSAL list filtering. Turn a `{field, value, op}` filter into ONE validated where-clause
 * over the list query's OWN projection — ANY projected field is filterable, with zero hardcoded vocabulary.
 * A boolean satellite (an `exists` projection, e.g. `done`) filters by presence (notnull/isnull); a place
 * field (priority, due, title, …) filters by value with the given op (default `eq`). The engine validates +
 * binds every value, so a filter value can never become SQL.
 */
type CrudFilter = { field?: string; value?: unknown; op?: string }
function deriveFilter(spec: QuerySpec, f: CrudFilter): Filter {
	const field = f.field ?? ''
	const entry = (spec.project ?? []).find((e: ProjectEntry) =>
		typeof e === 'string' ? e === field : e.as === field
	)
	if (!entry) throw new Error(`filter: "${field}" is not a field of this list`)
	if (typeof entry === 'object' && 'exists' in entry) {
		const present = f.value === true || f.value === 'true' || f.value === 1
		return { join: entry.join, place: 'id', op: present ? 'notnull' : 'isnull' }
	}
	const op = (f.op as Filter['op']) ?? 'eq'
	if (typeof entry === 'string') return { place: entry, op, value: f.value }
	return { join: entry.join, place: entry.place, op, value: f.value }
}

/** Build the capability object an actor is allowed, from its declared `caps` list. Only granted names get a
 *  host function; everything else is absent (so the sandbox fails closed). board 0111. */
export function buildCaps(uid: string, capList: string[] | null): Caps {
	const want = new Set(capList ?? [])
	const caps: Caps = {}
	if (want.has('ops')) {
		caps.ops = (name: unknown, params: unknown) =>
			runNamedOp(uid, String(name), (params as Record<string, unknown>) ?? {})
	}
	return caps
}

export type CodeRunResult = { ran: true; result: unknown } | { ran: false }

/**
 * If the actor carries sandboxed `code`, run it in the sandbox (with its granted caps + its prompt/ctx) and
 * return the result. If it has no code (an `engine` actor), return `{ ran: false }` so the caller falls back
 * to the existing by-name engine dispatch. board 0111.
 */
export async function runCodeActor(
	actor: Pick<ActorRow, 'name' | 'code' | 'caps' | 'prompt' | 'engine'>,
	msg: unknown,
	uid: string
): Promise<CodeRunResult> {
	if (!actor.code) return { ran: false }
	const result = await runActorCode(actor.code, msg, buildCaps(uid, actor.caps), {
		prompt: actor.prompt ?? ''
	})
	return { ran: true, result }
}

/** Behavior is bound as `code` XOR `engine`. Resolve which one an actor uses (for the runner + the viewer). */
export function actorBinding(actor: Pick<ActorRow, 'code' | 'engine'>): 'code' | 'engine' | 'none' {
	if (actor.code) return 'code'
	if (actor.engine && engineFor(actor.engine)) return 'engine'
	return 'none'
}

/**
 * board 0107 — the ONE data-CRUD executor. CRUD is not special: list/create/update/delete + a configured
 * `filter` are just NAMED operations (`<schema>.<verb>` rows in data_operations, query or mutation specs)
 * run through the universal engine. Every caller — the chat tool loop, the delete-confirm path, and the
 * /api/data REST handlers — dispatches here; there is no separate sandbox-code / typeSpec / raw-jsonb path.
 * Config-as-data SSOT: the available verbs (and list filters like `todos.done`) ARE the seeded ops.
 */
/** Parse a jsonb column that may arrive as a string or an already-decoded object. */
function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

/** Load a bundle spec from the registry — read for entity-ref (`refType`) resolution. board 0112. */
async function loadBundle(type: string): Promise<TypeSpec | null> {
	const row = await db()
		.selectFrom('data_bundles')
		.select('spec')
		.where('type', '=', type)
		.executeTakeFirst()
	return row ? (asJson(row.spec) as TypeSpec) : null
}

/**
 * board 0112 REIFICATION — resolve every entity-ref field of an item (a NAME the user typed) to the
 * referenced entity's id, FIND-OR-CREATING it. Fully generic: driven by the bundle's `refType` traits, so
 * goal (member_of.x2 → a `goal`), location (located.x2 → a `location`) and any future ref work the same.
 * Match is case-insensitive (a value already equal to an existing id is left as-is). Returns a copy.
 */
async function resolveRefs(
	uid: string,
	bundle: TypeSpec,
	item: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const refParts = bundle.parts.filter((p) => p.refType && p.field)
	if (!refParts.length) return item
	const out = { ...item }
	for (const p of refParts) {
		const field = p.field as string
		const raw = out[field]
		if (raw == null || raw === '') continue
		const name = String(raw)
		const listed = (await runNamedOp(uid, `${p.refType as string}.list`, {})) as {
			rows?: { id?: string; name?: string }[]
		}
		const rows = listed.rows ?? []
		if (rows.some((r) => r.id === name)) continue // already the entity id
		const hit = rows.find((r) => String(r.name ?? '').toLowerCase() === name.toLowerCase())
		if (hit?.id) {
			out[field] = hit.id
			continue
		}
		const created = (await runNamedOp(uid, `${p.refType as string}.create`, { name })) as {
			ids?: (string | null)[]
		}
		if (created.ids?.[0]) out[field] = created.ids[0]
	}
	return out
}

export async function crud(uid: string, args: DataCrudArgs): Promise<unknown> {
	const schema = args.schema
	if (!schema) return { ok: false, error: 'schema name required' }
	// fresh-user vocab bootstrap (once per process per user) — the seeded todo predicates must exist
	// before any mutation resolves its schema_id. board 0112 (moved from the retired interpreter path).
	await ensureVocab(uid)
	const op = (verb: string) => `${schema}.${verb}`
	const action = args.action ?? 'list'

	if (action === 'list') {
		if (args.filter?.field) {
			// UNIVERSAL filter: build a validated QuerySpec = the list op's spec + one derived where-clause
			// over any of its projected fields (priority, due, done, …). No configured per-filter op needed.
			const listSpec = (await fetchOp(uid, op('list'))).spec as QuerySpec
			const spec: QuerySpec = {
				...listSpec,
				where: [...(listSpec.where ?? []), deriveFilter(listSpec, args.filter)]
			}
			return { ok: true, action: 'list', items: await runQuery(uid, spec) }
		}
		const res = (await runNamedOp(uid, op('list'), {})) as { rows?: unknown[] }
		return { ok: true, action: 'list', items: res.rows ?? [] }
	}
	if (action === 'create') {
		// board 0112 — resolve any entity-ref fields (goal/location NAME → its entity id) before the write.
		const bundle = await loadBundle(schema)
		const created: string[] = []
		for (const item of args.items ?? []) {
			const row = bundle ? await resolveRefs(uid, bundle, item as Record<string, unknown>) : item
			const res = (await runNamedOp(uid, op('create'), row as Record<string, unknown>)) as {
				ids?: (string | null)[]
			}
			const id = res.ids?.[0]
			if (id) created.push(id)
		}
		return { ok: true, action: 'create', created, errors: [] }
	}
	if (action === 'update') {
		const bundle = await loadBundle(schema)
		const updated: string[] = []
		for (const item of args.items ?? []) {
			const id = (item as { id?: string }).id
			if (!id) continue
			const row = bundle ? await resolveRefs(uid, bundle, item as Record<string, unknown>) : item
			await runNamedOp(uid, op('update'), row as Record<string, unknown>)
			updated.push(id)
		}
		return { ok: true, action: 'update', updated, errors: [] }
	}
	if (action === 'delete') {
		const ids = args.ids ?? (args.id ? [args.id] : [])
		if (ids.length === 0) return { ok: false, error: 'delete requires id(s)' }
		for (const id of ids) await runNamedOp(uid, op('delete'), { id })
		return { ok: true, action: 'delete', deleted: ids }
	}
	return { ok: false, error: `unknown action: ${String(args.action)}` }
}
