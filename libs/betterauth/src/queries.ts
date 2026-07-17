import { randomUUID } from 'node:crypto'
import Ajv from 'ajv'
import { type Kysely, type RawBuilder, sql } from 'kysely'
import { type Database, db } from './db'
import { publish } from './events'

// board 0101 — DYNAMIC queries + mutations as VALIDATED SPECS over the x1–x5 store. A spec is a small
// declarative JSON object (AJV-validated against a fixed meta-schema); a generic compiler turns it into ONE
// parameterized SQL (queries) or a TRANSACTION of parameterized predication writes (mutations). GLM authors
// the SPEC, never raw SQL — every value is a bound parameter, every column an allow-listed place, so a
// malicious value can never become SQL. Filter + join + count (queries); insert/delete ops (mutations).

type Place = 'x1' | 'x2' | 'x3' | 'x4' | 'x5'
const PLACES: Place[] = ['x1', 'x2', 'x3', 'x4', 'x5']
// Binary ops take a value/param; the two NULL ops take none (existence over a LEFT join — e.g. a `done`
// satellite present or absent, which is how "done" vs "open" todos filter). board 0107.
type BinOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
type NullOp = 'isnull' | 'notnull'
type Op = BinOp | NullOp
const OPS: Record<BinOp, string> = {
	eq: '=',
	neq: '<>',
	gt: '>',
	gte: '>=',
	lt: '<',
	lte: '<=',
	in: 'in'
}

// board 0112 — user-facing filter/match values are free-text LABELS a model capitalizes however it read
// them ("Healthy eating" the stored goal vs "Healthy Eating" from the user's phrasing). So string eq/neq
// compare CASE-INSENSITIVELY — the single reason "show me my Healthy Eating todos" returned 0. Numbers
// and ids are unaffected (lower() of a digit/uuid string is identity); ordering ops keep exact semantics.
// Used by BOTH the query filter and the mutation matcher, so rename/merge/delete-by-name are fuzzy too.
function compare(col: RawBuilder<unknown>, op: BinOp, v: unknown): RawBuilder<unknown> {
	if ((op === 'eq' || op === 'neq') && typeof v === 'string')
		return sql`lower(${col}) ${sql.raw(OPS[op])} lower(${v})`
	return sql`${col} ${sql.raw(OPS[op])} ${v}`
}

// board 0107 — a filter targets the base predicate by default, or a JOIN (`join` = its index) so a query can
// filter on a satellite place (e.g. due date on the `due` join) or a satellite's existence (a `notnull`/
// `isnull` on the join's id → the `done` predicate present/absent). Every value stays a bound param.
export type Filter = { place: Place | 'id'; op: Op; value?: unknown; param?: string; join?: number }
// board 0104 — a join may match on the base ROW ID (`base:'id'`) so a satellite predicate correlates on the
// entity id (e.g. done.x1 = <task row id>), and may be a LEFT join so a missing satellite projects as null.
// board 0112 — CHAINED joins: `base` may instead reference an EARLIER join ({join:N, place}) so a query
// walks a predication graph to any explicit depth (task → referent → referent …). Fail-closed like the
// mutation {ref:N} rule: N must index a STRICTLY EARLIER join — never forward, never self.
type JoinBase = Place | 'id' | { join: number; place: Place | 'id' }
export type JoinSpec = {
	predicate: string
	on: { place: Place; base: JoinBase }
	kind?: 'inner' | 'left'
}
// board 0104 — a projection entry: a bare base place (`"x2"`), the base row id (`"id"`), a place from the
// base or a join (`{place, as?, join?}`), or a presence boolean over a LEFT join (`{join, exists, as}` →
// true iff the joined row exists, e.g. `done`).
type ProjPlace = Place | 'id'
export type ProjectEntry =
	| ProjPlace
	| { place: ProjPlace; as?: string; join?: number }
	| { join: number; exists: true; as: string }
export type QuerySpec = {
	name?: string
	from: string
	where?: Filter[]
	join?: JoinSpec[]
	group_by?: Place
	count?: { having?: { op: Op; value: number } }
	project?: ProjectEntry[]
}
export type MutationOp = {
	op: 'insert' | 'delete' | 'update'
	predicate: string
	where?: Filter[]
	cells?: Record<string, unknown>
	/** board 0104 — skip this op when a condition on params holds. `param` = skip when FALSY (truthy-gate,
	 *  for an optional insert); `present` = skip when the KEY is absent (presence-gate, for a delete-clear
	 *  that must only fire when the caller actually supplied the field). Exactly one is set. */
	when?: { param?: string; present?: string }
}
export type MutationSpec = { name?: string; params?: string[]; ops: MutationOp[] }

// ── AJV meta-schemas (the spec LANGUAGE) ────────────────────────────────────────
const PLACE_ENUM = { type: 'string', enum: PLACES } as const
const OP_ENUM = { type: 'string', enum: [...Object.keys(OPS), 'isnull', 'notnull'] } as const
const PLACE_OR_ID = { type: 'string', enum: [...PLACES, 'id'] } as const
const FILTER_SCHEMA = {
	type: 'object',
	properties: {
		place: PLACE_OR_ID,
		op: OP_ENUM,
		value: {},
		param: { type: 'string' },
		join: { type: 'integer', minimum: 0 }
	},
	required: ['place', 'op'],
	additionalProperties: false
} as const
// board 0104 — a projection entry: a bare place/id string, a place read (base or a join), or an exists boolean.
const PROJECT_ENTRY_SCHEMA = {
	oneOf: [
		PLACE_OR_ID,
		{
			type: 'object',
			properties: {
				place: PLACE_OR_ID,
				as: { type: 'string' },
				join: { type: 'integer', minimum: 0 }
			},
			required: ['place'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				join: { type: 'integer', minimum: 0 },
				exists: { const: true },
				as: { type: 'string', minLength: 1 }
			},
			required: ['join', 'exists', 'as'],
			additionalProperties: false
		}
	]
} as const

export const QUERY_META_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		from: { type: 'string', minLength: 1 },
		where: { type: 'array', items: FILTER_SCHEMA },
		join: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					predicate: { type: 'string', minLength: 1 },
					kind: { type: 'string', enum: ['inner', 'left'] },
					on: {
						type: 'object',
						properties: {
							place: PLACE_ENUM,
							// board 0112 — base is a place/id of the BASE row, or a CHAIN ref to an earlier join.
							base: {
								oneOf: [
									PLACE_OR_ID,
									{
										type: 'object',
										properties: { join: { type: 'integer', minimum: 0 }, place: PLACE_OR_ID },
										required: ['join', 'place'],
										additionalProperties: false
									}
								]
							}
						},
						required: ['place', 'base'],
						additionalProperties: false
					}
				},
				required: ['predicate', 'on'],
				additionalProperties: false
			}
		},
		group_by: PLACE_ENUM,
		count: {
			type: 'object',
			properties: {
				having: {
					type: 'object',
					properties: { op: OP_ENUM, value: { type: 'number' } },
					required: ['op', 'value'],
					additionalProperties: false
				}
			},
			additionalProperties: false
		},
		project: { type: 'array', items: PROJECT_ENTRY_SCHEMA }
	},
	required: ['from'],
	additionalProperties: false
} as const

export const MUTATION_META_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		params: { type: 'array', items: { type: 'string' } },
		ops: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				properties: {
					op: { type: 'string', enum: ['insert', 'delete', 'update'] },
					predicate: { type: 'string', minLength: 1 },
					where: { type: 'array', items: FILTER_SCHEMA },
					cells: { type: 'object', additionalProperties: true },
					when: {
						type: 'object',
						properties: {
							param: { type: 'string', minLength: 1 },
							present: { type: 'string', minLength: 1 }
						},
						minProperties: 1,
						additionalProperties: false
					}
				},
				required: ['op', 'predicate'],
				additionalProperties: false
			}
		}
	},
	required: ['ops'],
	additionalProperties: false
} as const

const ajv = new Ajv({ allErrors: true })
export const validateQuerySpec = ajv.compile<QuerySpec>(QUERY_META_SCHEMA)
export const validateMutationSpec = ajv.compile<MutationSpec>(MUTATION_META_SCHEMA)

// ── safe fragment builders ──────────────────────────────────────────────────────
function assertPlace(p: string): Place {
	if (!(PLACES as string[]).includes(p)) throw new Error(`[queries] illegal place "${p}"`)
	return p as Place
}
/** A bare (un-aliased) column for a DELETE/UPDATE statement — allow-listed to `id` or x1…x5. board 0104. */
function bareCol(place: string): RawBuilder<unknown> {
	if (place === 'id') return sql.ref('id')
	return sql.ref(assertPlace(place))
}
/** a column reference — the place is validated against the allow-list, never raw user input. */
function col(alias: string, place: string): RawBuilder<unknown> {
	return sql.ref(`${alias}.${assertPlace(place)}`)
}
/** like col, but also allows the row-id column (`id`) — for joins/projections that correlate on the entity
 *  id rather than an x-place (e.g. done.x1 = task.id). Still allow-listed: only `id` or x1…x5. board 0104. */
function refCol(alias: string, place: string): RawBuilder<unknown> {
	if (place === 'id') return sql.ref(`${alias}.id`)
	return col(alias, place)
}
/** Resolve a reserved bind object (`{bind:'$user'}` → uid, `{bind:'$now'}` → an ISO timestamp). board 0104. */
function resolveBind(v: unknown, uid: string): unknown {
	if (v && typeof v === 'object' && 'bind' in (v as object)) {
		const b = (v as { bind: string }).bind
		if (b === '$user') return uid
		if (b === '$now') return new Date().toISOString()
		throw new Error(`[queries] unknown bind ${JSON.stringify(b)}`)
	}
	return v
}
function resolveVal(f: Filter, params: Record<string, unknown>, uid: string): unknown {
	return resolveBind(f.param !== undefined ? params[f.param] : f.value, uid)
}
/**
 * Resolve one INSERT cell value (board 0103 — reified nesting). A cell is a literal, a `{param}` (a caller
 * input), or a `{ref:n}` — the row id GENERATED by an EARLIER insert op in this same transaction. `ref`
 * lets a spec create a referent then a predication pointing at it in one atomic mutation, e.g. "2 bananas"
 * = insert `banana`, insert `quantity(x1=<ref0>)`, insert `eat(x2=<ref0>)`. Fail-closed: `n` must index a
 * strictly-earlier op that was an insert (never a forward ref, a delete, or a non-integer).
 */
function resolveCell(
	raw: unknown,
	params: Record<string, unknown>,
	generated: (string | null)[],
	opIndex: number,
	uid: string
): unknown {
	if (raw && typeof raw === 'object') {
		if ('bind' in (raw as object)) return resolveBind(raw, uid)
		if ('param' in (raw as object)) return params[(raw as { param: string }).param]
		if ('ref' in (raw as object)) {
			const n = (raw as { ref: unknown }).ref
			if (
				typeof n !== 'number' ||
				!Number.isInteger(n) ||
				n < 0 ||
				n >= opIndex ||
				typeof generated[n] !== 'string'
			) {
				throw new Error(
					`[queries] insert cell {"ref":${JSON.stringify(n)}} must reference an earlier insert op`
				)
			}
			return generated[n]
		}
	}
	return raw
}
/** one WHERE fragment — VALUES are bound params, the operator comes from the allow-list. */
function filterFrag(
	alias: string,
	f: Filter,
	params: Record<string, unknown>,
	uid: string
): RawBuilder<unknown> {
	const c = refCol(alias, f.place)
	// NULL ops take no value — pure existence checks (a `notnull` on a LEFT-join id = the satellite is present).
	if (f.op === 'isnull') return sql`${c} is null`
	if (f.op === 'notnull') return sql`${c} is not null`
	const v = resolveVal(f, params, uid)
	if (f.op === 'in') {
		const arr = Array.isArray(v) ? v : [v]
		return sql`${c} in (${sql.join(arr.map((x) => sql`${x}`))})`
	}
	return compare(c, f.op, v)
}

// ── query executor ──────────────────────────────────────────────────────────────
/** Compile a VALIDATED query spec + params → ONE parameterized SQL over data_value. board 0101. */
export function compileQuery(
	uid: string,
	spec: QuerySpec,
	params: Record<string, unknown> = {}
): RawBuilder<Record<string, unknown>> {
	const b = 'b'
	const jspec = spec.join ?? []
	const wheres: RawBuilder<unknown>[] = [
		sql`${sql.ref(`${b}.user_id`)} = ${uid}`,
		sql`${sql.ref(`${b}.predicate`)} = ${spec.from}`,
		...(spec.where ?? []).map((f) => {
			// board 0107 — a filter may target a JOIN alias (`f.join`) instead of the base predicate.
			if (f.join !== undefined && !jspec[f.join])
				throw new Error(`[queries] where references missing join ${f.join}`)
			return filterFrag(f.join !== undefined ? `j${f.join}` : b, f, params, uid)
		})
	]
	const joins = jspec.map((j, i) => {
		const a = `j${i}`
		const kw = sql.raw(j.kind === 'left' ? 'LEFT JOIN' : 'JOIN')
		// board 0112 — the base side of the ON: the base row, or (chained) a STRICTLY EARLIER join's alias.
		// Fail-closed like the mutation {ref:N} rule: a forward/self chain ref never reaches SQL.
		let baseSide: RawBuilder<unknown>
		if (typeof j.on.base === 'object') {
			const n = j.on.base.join
			if (!Number.isInteger(n) || n < 0 || n >= i) {
				throw new Error(`[queries] join ${i} chain base {"join":${JSON.stringify(n)}} must reference an earlier join`)
			}
			baseSide = refCol(`j${n}`, j.on.base.place)
		} else {
			baseSide = refCol(b, j.on.base)
		}
		return sql`${kw} data_value ${sql.ref(a)} ON ${sql.ref(`${a}.user_id`)} = ${sql.ref(`${b}.user_id`)} AND ${sql.ref(`${a}.predicate`)} = ${j.predicate} AND ${refCol(a, j.on.place)} = ${baseSide}`
	})
	// board 0104 — a projection entry is a bare place/id, a place read from base or a join, or an exists
	// boolean over a LEFT join (true iff the joined satellite row is present, e.g. `done`).
	const projectEntry = (e: ProjectEntry): RawBuilder<unknown> => {
		if (typeof e === 'string') return sql`${refCol(b, e)} as ${sql.ref(e)}`
		if ('exists' in e) {
			const j = jspec[e.join]
			if (!j) throw new Error(`[queries] project exists references missing join ${e.join}`)
			return sql`(${refCol(`j${e.join}`, j.on.place)} is not null) as ${sql.ref(e.as)}`
		}
		const alias = e.join !== undefined ? `j${e.join}` : b
		if (e.join !== undefined && !jspec[e.join])
			throw new Error(`[queries] project references missing join ${e.join}`)
		return sql`${refCol(alias, e.place)} as ${sql.ref(e.as ?? e.place)}`
	}
	const selects: RawBuilder<unknown>[] = spec.count
		? [
				...(spec.group_by ? [sql`${col(b, spec.group_by)} as ${sql.ref('key')}`] : []),
				sql`count(*)::int as ${sql.ref('n')}`
			]
		: (spec.project?.length ? spec.project : (PLACES as ProjectEntry[])).map(projectEntry)

	let q = sql`SELECT ${sql.join(selects, sql`, `)} FROM data_value ${sql.ref(b)}`
	if (joins.length) q = sql`${q} ${sql.join(joins, sql` `)}`
	q = sql`${q} WHERE ${sql.join(wheres, sql` AND `)}`
	if (spec.group_by) q = sql`${q} GROUP BY ${col(b, spec.group_by)}`
	if (spec.count?.having) {
		const h = spec.count.having
		// HAVING compares a numeric count — only the binary ops make sense; a null op here is a spec error.
		const hop = OPS[h.op as BinOp]
		if (!hop) throw new Error(`[queries] HAVING needs a binary op, got "${h.op}"`)
		q = sql`${q} HAVING count(*) ${sql.raw(hop)} ${h.value}`
	}
	return q as RawBuilder<Record<string, unknown>>
}

/** Validate + run a query spec, returning the rows. Throws on an invalid spec (never reaches SQL). */
export async function runQuery(
	uid: string,
	spec: QuerySpec,
	params: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
	if (!validateQuerySpec(spec)) {
		throw new Error(`[queries] invalid query spec: ${ajv.errorsText(validateQuerySpec.errors)}`)
	}
	const res = await compileQuery(uid, spec, params).execute(db())
	return res.rows
}

// ── mutation executor (transactional) ────────────────────────────────────────────
async function schemaIdFor(trx: Kysely<Database>, uid: string, predicate: string): Promise<string> {
	const row = await sql<{ id: string }>`
		SELECT id FROM data_schema WHERE user_id = ${uid} AND name = ${predicate} LIMIT 1
	`.execute(trx)
	const id = row.rows[0]?.id
	if (!id) throw new Error(`[queries] no data_schema for predicate "${predicate}" — mint it first`)
	return id
}

/** Validate + run a mutation spec as ONE transaction (all-or-nothing). Returns per-op affected counts.
 *  A destructive `delete` op is HITL-gated at the ACTOR layer; the executor itself just applies the spec. */
export async function runMutation(
	uid: string,
	spec: MutationSpec,
	params: Record<string, unknown> = {}
): Promise<{ ops: { op: string; predicate: string; affected: number }[]; ids: (string | null)[] }> {
	if (!validateMutationSpec(spec)) {
		throw new Error(
			`[queries] invalid mutation spec: ${ajv.errorsText(validateMutationSpec.errors)}`
		)
	}
	const result = await db()
		.transaction()
		.execute(async (trx) => {
			const ops: { op: string; predicate: string; affected: number }[] = []
			// board 0103 — each op's generated row id (inserts only; delete/update → null), so a later insert
			// cell `{ref:n}` can point at op n's new referent. Indexed by op position.
			const generated: (string | null)[] = []
			// board 0104 — the scoped WHERE for a delete/update op (user + predicate + the op's filters).
			const whereFrags = (o: MutationOp): RawBuilder<unknown>[] => [
				sql`user_id = ${uid}`,
				sql`predicate = ${o.predicate}`,
				...(o.where ?? []).map((f) => {
					// mutations act on ONE predicate (no joins); null ops still apply on its own places.
					if (f.op === 'isnull') return sql`${bareCol(f.place)} is null`
					if (f.op === 'notnull') return sql`${bareCol(f.place)} is not null`
					const v = resolveVal(f, params, uid)
					if (f.op === 'in') {
						const arr = Array.isArray(v) ? v : [v]
						return sql`${bareCol(f.place)} in (${sql.join(arr.map((x) => sql`${x}`))})`
					}
					return compare(bareCol(f.place), f.op, v)
				})
			]
			// board 0104 — a when-guard skips an op: `param` = skip when FALSY (optional insert), `present` =
			// skip when the KEY is absent (a delete-clear that must only fire when the field was supplied).
			const skipOp = (o: MutationOp): boolean =>
				!!o.when &&
				(o.when.present !== undefined
					? !(o.when.present in params)
					: !params[o.when.param as string])
			for (let i = 0; i < spec.ops.length; i++) {
				const o = spec.ops[i]
				if (skipOp(o)) {
					generated[i] = null
					ops.push({ op: o.op, predicate: o.predicate, affected: 0 })
					continue
				}
				if (o.op === 'insert') {
					const schemaId = await schemaIdFor(trx, uid, o.predicate)
					const cells = o.cells ?? {}
					const colNames = Object.keys(cells).map(assertPlace)
					const rowId = randomUUID()
					if (colNames.length === 0) {
						// board 0112 — an IDENTITY-ONLY entity (e.g. a reified goal `girzu` / location `stuzi`):
						// no x-places, its existence IS the predication; its name/owner live on satellites.
						await sql`
							INSERT INTO data_value (id, user_id, schema_id, predicate, created_at, updated_at)
							VALUES (${rowId}, ${uid}, ${schemaId}, ${o.predicate}, now(), now())
						`.execute(trx)
					} else {
						const vals = colNames.map((p) => {
							const v = resolveCell(cells[p], params, generated, i, uid)
							return sql`${v ?? null}`
						})
						const cols = colNames.map((p) => sql.ref(p))
						await sql`
							INSERT INTO data_value (id, user_id, schema_id, predicate, ${sql.join(cols)}, created_at, updated_at)
							VALUES (${rowId}, ${uid}, ${schemaId}, ${o.predicate}, ${sql.join(vals)}, now(), now())
						`.execute(trx)
					}
					generated[i] = rowId
					ops.push({ op: 'insert', predicate: o.predicate, affected: 1 })
				} else if (o.op === 'update') {
					// board 0104 — patch places IN PLACE (keeps the row id → any referents pointing at it survive;
					// a delete+insert would mint a NEW id). Scoped by user + predicate + the op's where.
					const cells = o.cells ?? {}
					const colNames = Object.keys(cells).map(assertPlace)
					if (colNames.length === 0) throw new Error('[queries] update op needs cells')
					const sets = colNames.map((p) => {
						const v = resolveCell(cells[p], params, generated, i, uid)
						return sql`${sql.ref(p)} = ${v ?? null}`
					})
					const r = await sql<{ n: string }>`
						WITH upd AS (UPDATE data_value SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE ${sql.join(whereFrags(o), sql` AND `)} RETURNING 1)
						SELECT count(*)::text as n FROM upd
					`.execute(trx)
					generated[i] = null
					ops.push({ op: 'update', predicate: o.predicate, affected: Number(r.rows[0]?.n ?? 0) })
				} else {
					const r = await sql<{ n: string }>`
						WITH del AS (DELETE FROM data_value WHERE ${sql.join(whereFrags(o), sql` AND `)} RETURNING 1)
						SELECT count(*)::text as n FROM del
					`.execute(trx)
					generated[i] = null // a delete produces no referent
					ops.push({ op: 'delete', predicate: o.predicate, affected: Number(r.rows[0]?.n ?? 0) })
				}
			}
			return { ops, ids: generated }
		})
	publish(uid, { entity: 'data' })
	return result
}

/** Does a mutation spec contain a destructive (delete) op? Drives HITL at the actor layer. */
export function mutationIsDestructive(spec: MutationSpec): boolean {
	return (spec.ops ?? []).some((o) => o.op === 'delete')
}

// board 0104 — run ANY operation (a query or a mutation spec, e.g. a bundle-derived op) through the engine.
export type OperationRow = { kind: 'query' | 'mutation'; spec: QuerySpec | MutationSpec }
export async function runOperation(
	uid: string,
	op: OperationRow,
	params: Record<string, unknown> = {}
): Promise<{
	rows?: Record<string, unknown>[]
	ops?: { op: string; predicate: string; affected: number }[]
	ids?: (string | null)[]
}> {
	if (op.kind === 'query') return { rows: await runQuery(uid, op.spec as QuerySpec, params) }
	return await runMutation(uid, op.spec as MutationSpec, params)
}
