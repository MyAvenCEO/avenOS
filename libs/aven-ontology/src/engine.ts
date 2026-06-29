// The pure engine (board 0088): resolve bindings, mutate (create/update/delete), and query (a
// Datalog-style x1–x5 projection matcher) — all driven by a TypeSpec, all against an injectable
// PredicationStore. No DB, no domain knowledge. The betterauth layer supplies a real store + the spec.

import type {
	Bind,
	Cell,
	MutateCtx,
	Place,
	PredicationStore,
	ProjectSpec,
	Row,
	TypeSpec
} from './types.js'

type Env = { user: string; primary: string | null; now: string; value: unknown }

/** Resolve one binding (see [[Bind]]). Conditional truthiness tests the RAW value, not its string. */
export function resolveBind(bind: Bind, env: Env): Cell {
	const cond = /^(.+?)\?(.+):(.+)$/.exec(bind)
	if (cond) {
		const ok = cond[1] === '$value' ? !!env.value : !!resolveBind(cond[1], env)
		return resolveBind(ok ? cond[2] : cond[3], env)
	}
	switch (bind) {
		case '$user':
			return env.user
		case '$primary':
			return env.primary
		case '$now':
			return env.now
		case '$value':
			return env.value == null ? null : String(env.value)
		case 'null':
			return null
		default:
			return bind
	}
}

function cellsFrom(spec: Partial<Record<Place, Bind>> | undefined, env: Env): Partial<Record<Place, Cell>> {
	const out: Partial<Record<Place, Cell>> = {}
	for (const [place, bind] of Object.entries(spec ?? {})) {
		if (bind == null) continue
		out[place as Place] = resolveBind(bind, env)
	}
	return out
}

function primaryPart(spec: TypeSpec) {
	const p = spec.parts.find((part) => part.kind === 'primary')
	if (!p || !p.field) throw new Error(`aven-ontology: type "${spec.type}" has no primary part with a field`)
	return p
}

/** Create one entity: the primary predication + its singleton lifecycle parts + any present attributes.
 *  Returns the new primary id, or null when the driving field is empty (nothing created). */
export async function create(
	spec: TypeSpec,
	store: PredicationStore,
	item: Record<string, unknown>,
	ctx: MutateCtx
): Promise<string | null> {
	const now = ctx.now()
	const primary = primaryPart(spec)
	const titleVal = item[primary.field as string]
	if (titleVal == null || titleVal === '') return null

	const base: Env = { user: ctx.user, primary: null, now, value: titleVal }
	const primaryId = await store.insert(primary.pred, cellsFrom(primary.create, base))
	const env = { ...base, primary: primaryId }

	for (const part of spec.parts) {
		if (part.kind === 'singleton' && part.link) {
			const value = part.field ? item[part.field] : undefined
			const cells = cellsFrom(part.create, { ...env, value })
			cells[part.link] = primaryId
			await store.insert(part.pred, cells)
		}
	}
	for (const part of spec.parts) {
		if (part.kind === 'replace' && part.field) {
			const value = item[part.field]
			if (value == null || value === '') continue
			await store.insert(part.pred, cellsFrom(part.set, { ...env, value }))
		}
	}
	return primaryId
}

/** Update one entity by id: each present input field patches/replaces its part. Returns the id. */
export async function update(
	spec: TypeSpec,
	store: PredicationStore,
	item: Record<string, unknown>,
	ctx: MutateCtx
): Promise<string | null> {
	const id = typeof item.id === 'string' ? item.id : null
	if (!id) return null
	const now = ctx.now()
	for (const [field, raw] of Object.entries(item)) {
		if (field === 'id') continue
		const part = spec.parts.find((p) => p.field === field)
		if (!part) continue
		const env: Env = { user: ctx.user, primary: id, now, value: raw }
		if (part.kind === 'primary') {
			await store.patch(id, cellsFrom(part.set, env))
		} else if (part.kind === 'singleton' && part.link) {
			await store.patchWhere(part.pred, part.link, id, cellsFrom(part.set, env))
		} else if (part.kind === 'replace' && part.link) {
			await store.deleteWhere(part.pred, part.link, id)
			if (raw != null && raw !== '') await store.insert(part.pred, cellsFrom(part.set, env))
		}
	}
	return id
}

/** Delete one entity: the primary row + every predication that refs it via a part's link place. */
export async function remove(spec: TypeSpec, store: PredicationStore, id: string): Promise<void> {
	await store.remove(id)
	for (const part of spec.parts) {
		if (part.link) await store.deleteWhere(part.pred, part.link, id)
	}
}

function project(
	spec: TypeSpec,
	prow: Row,
	proj: ProjectSpec,
	linked: Record<string, Row[]>,
	primaryPred: string
): Cell | boolean {
	if (proj.pred === primaryPred) {
		return proj.notNull ? prow[proj.notNull] != null : (prow[proj.place as Place] ?? null)
	}
	const part = spec.parts.find((p) => p.pred === proj.pred)
	const row = part?.link ? (linked[proj.pred] ?? []).find((r) => r[part.link as Place] === prow.id) : undefined
	if (proj.notNull) return !!(row && row[proj.notNull] != null)
	return row ? (row[proj.place as Place] ?? null) : null
}

/** Project every entity of `spec` into a flat record (the v_task equivalent), by pattern-matching
 *  each primary row against its linked predications at the declared gismu positions. */
export async function query(
	spec: TypeSpec,
	store: PredicationStore
): Promise<Record<string, unknown>[]> {
	const primary = primaryPart(spec)
	const primaries = await store.rows(primary.pred)
	const linked: Record<string, Row[]> = {}
	for (const part of spec.parts) {
		if (part.link && !linked[part.pred]) linked[part.pred] = await store.rows(part.pred)
	}
	return primaries.map((prow) => {
		const out: Record<string, unknown> = { id: prow.id }
		for (const [field, proj] of Object.entries(spec.project)) {
			out[field] = project(spec, prow, proj, linked, primary.pred)
		}
		return out
	})
}
