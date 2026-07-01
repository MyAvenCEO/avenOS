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
type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
const OPS: Record<Op, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', in: 'in' }

export type Filter = { place: Place; op: Op; value?: unknown; param?: string }
export type QuerySpec = {
	name?: string
	from: string
	where?: Filter[]
	join?: { predicate: string; on: { place: Place; base: Place } }[]
	group_by?: Place
	count?: { having?: { op: Op; value: number } }
	project?: Place[]
}
export type MutationOp = {
	op: 'insert' | 'delete'
	predicate: string
	where?: Filter[]
	cells?: Record<string, unknown>
}
export type MutationSpec = { name?: string; params?: string[]; ops: MutationOp[] }

// ── AJV meta-schemas (the spec LANGUAGE) ────────────────────────────────────────
const PLACE_ENUM = { type: 'string', enum: PLACES } as const
const OP_ENUM = { type: 'string', enum: Object.keys(OPS) } as const
const FILTER_SCHEMA = {
	type: 'object',
	properties: { place: PLACE_ENUM, op: OP_ENUM, value: {}, param: { type: 'string' } },
	required: ['place', 'op'],
	additionalProperties: false
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
					on: {
						type: 'object',
						properties: { place: PLACE_ENUM, base: PLACE_ENUM },
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
		project: { type: 'array', items: PLACE_ENUM }
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
					op: { type: 'string', enum: ['insert', 'delete'] },
					predicate: { type: 'string', minLength: 1 },
					where: { type: 'array', items: FILTER_SCHEMA },
					cells: { type: 'object', additionalProperties: true }
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
/** a column reference — the place is validated against the allow-list, never raw user input. */
function col(alias: string, place: string): RawBuilder<unknown> {
	return sql.ref(`${alias}.${assertPlace(place)}`)
}
function resolveVal(f: Filter, params: Record<string, unknown>): unknown {
	return f.param !== undefined ? params[f.param] : f.value
}
/** one WHERE fragment — VALUES are bound params, the operator comes from the allow-list. */
function filterFrag(alias: string, f: Filter, params: Record<string, unknown>): RawBuilder<unknown> {
	const c = col(alias, f.place)
	const v = resolveVal(f, params)
	if (f.op === 'in') {
		const arr = Array.isArray(v) ? v : [v]
		return sql`${c} in (${sql.join(arr.map((x) => sql`${x}`))})`
	}
	return sql`${c} ${sql.raw(OPS[f.op])} ${v}`
}

// ── query executor ──────────────────────────────────────────────────────────────
/** Compile a VALIDATED query spec + params → ONE parameterized SQL over data_value. board 0101. */
export function compileQuery(
	uid: string,
	spec: QuerySpec,
	params: Record<string, unknown> = {}
): RawBuilder<Record<string, unknown>> {
	const b = 'b'
	const wheres: RawBuilder<unknown>[] = [
		sql`${sql.ref(`${b}.user_id`)} = ${uid}`,
		sql`${sql.ref(`${b}.predicate`)} = ${spec.from}`,
		...(spec.where ?? []).map((f) => filterFrag(b, f, params))
	]
	const joins = (spec.join ?? []).map((j, i) => {
		const a = `j${i}`
		return sql`JOIN data_value ${sql.ref(a)} ON ${sql.ref(`${a}.user_id`)} = ${sql.ref(`${b}.user_id`)} AND ${sql.ref(`${a}.predicate`)} = ${j.predicate} AND ${col(a, j.on.place)} = ${col(b, j.on.base)}`
	})
	const selects: RawBuilder<unknown>[] = spec.count
		? [
				...(spec.group_by ? [sql`${col(b, spec.group_by)} as ${sql.ref('key')}`] : []),
				sql`count(*)::int as ${sql.ref('n')}`
			]
		: (spec.project?.length ? spec.project : PLACES).map((p) => sql`${col(b, p)} as ${sql.ref(p)}`)

	let q = sql`SELECT ${sql.join(selects, sql`, `)} FROM data_value ${sql.ref(b)}`
	if (joins.length) q = sql`${q} ${sql.join(joins, sql` `)}`
	q = sql`${q} WHERE ${sql.join(wheres, sql` AND `)}`
	if (spec.group_by) q = sql`${q} GROUP BY ${col(b, spec.group_by)}`
	if (spec.count?.having) {
		const h = spec.count.having
		q = sql`${q} HAVING count(*) ${sql.raw(OPS[h.op])} ${h.value}`
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
): Promise<{ ops: { op: string; predicate: string; affected: number }[] }> {
	if (!validateMutationSpec(spec)) {
		throw new Error(`[queries] invalid mutation spec: ${ajv.errorsText(validateMutationSpec.errors)}`)
	}
	const result = await db()
		.transaction()
		.execute(async (trx) => {
			const ops: { op: string; predicate: string; affected: number }[] = []
			for (const o of spec.ops) {
				if (o.op === 'insert') {
					const schemaId = await schemaIdFor(trx, uid, o.predicate)
					const cells = o.cells ?? {}
					const colNames = Object.keys(cells).map(assertPlace)
					if (colNames.length === 0) throw new Error('[queries] insert op needs cells')
					const vals = colNames.map((p) => {
						const raw = cells[p]
						const v =
							raw && typeof raw === 'object' && 'param' in (raw as object)
								? params[(raw as { param: string }).param]
								: raw
						return sql`${v ?? null}`
					})
					const cols = colNames.map((p) => sql.ref(p))
					await sql`
						INSERT INTO data_value (id, user_id, schema_id, predicate, ${sql.join(cols)}, created_at, updated_at)
						VALUES (${randomUUID()}, ${uid}, ${schemaId}, ${o.predicate}, ${sql.join(vals)}, now(), now())
					`.execute(trx)
					ops.push({ op: 'insert', predicate: o.predicate, affected: 1 })
				} else {
					const wheres: RawBuilder<unknown>[] = [
						sql`user_id = ${uid}`,
						sql`predicate = ${o.predicate}`,
						...(o.where ?? []).map((f) => {
							const v = resolveVal(f, params)
							if (f.op === 'in') {
								const arr = Array.isArray(v) ? v : [v]
								return sql`${sql.ref(assertPlace(f.place))} in (${sql.join(arr.map((x) => sql`${x}`))})`
							}
							return sql`${sql.ref(assertPlace(f.place))} ${sql.raw(OPS[f.op])} ${v}`
						})
					]
					const r = await sql<{ n: string }>`
						WITH del AS (DELETE FROM data_value WHERE ${sql.join(wheres, sql` AND `)} RETURNING 1)
						SELECT count(*)::text as n FROM del
					`.execute(trx)
					ops.push({ op: 'delete', predicate: o.predicate, affected: Number(r.rows[0]?.n ?? 0) })
				}
			}
			return { ops }
		})
	publish(uid, { entity: 'data' })
	return result
}

/** Does a mutation spec contain a destructive (delete) op? Drives HITL at the actor layer. */
export function mutationIsDestructive(spec: MutationSpec): boolean {
	return (spec.ops ?? []).some((o) => o.op === 'delete')
}
