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

type Env = { user: string; primary: string | null; parent: string | null; now: string; value: unknown }

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
		case '$parent':
			return env.parent
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
	ctx: MutateCtx,
	parentId: string | null = null
): Promise<string | null> {
	const now = ctx.now()
	const primary = primaryPart(spec)
	const titleVal = item[primary.field as string]
	if (titleVal == null || titleVal === '') return null

	const base: Env = { user: ctx.user, primary: null, parent: parentId, now, value: titleVal }
	const primaryCells = cellsFrom(primary.create, base)
	// extra primary fields → their own places (e.g. pleji payer/payee/goods on a transaction). board 0092.
	for (const [place, field] of Object.entries(primary.fields ?? {})) {
		const v = item[field]
		if (v != null && v !== '') primaryCells[place as Place] = String(v)
	}
	const primaryId = await store.insert(primary.pred, primaryCells)
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
			// presence semantics: a falsy value (false / '' / null / 0) means the predication is ABSENT —
			// so a boolean-state part like done≡mulno stores a row iff true, nothing if false. board 0092.
			if (!value) continue
			await store.insert(part.pred, cellsFrom(part.set, { ...env, value }))
		}
	}
	// children: each element of the array field is its OWN sub-entity, created recursively with this
	// row as $parent (the child's primary links back via the part's `link` place). board 0092.
	for (const part of spec.parts) {
		if (part.kind === 'children' && part.childSpec && part.field) {
			const arr = item[part.field]
			if (Array.isArray(arr)) {
				for (const el of arr) await create(part.childSpec, store, el as Record<string, unknown>, ctx, primaryId)
			}
		}
	}
	return primaryId
}

/** The child sub-entities of `parent` linked through a children part's `link` place. */
async function childrenOf(
	store: PredicationStore,
	part: { childSpec?: TypeSpec; link?: Place },
	parentId: string
): Promise<Row[]> {
	if (!part.childSpec || !part.link) return []
	const childPrimary = primaryPart(part.childSpec)
	return (await store.rows(childPrimary.pred)).filter((r) => r[part.link as Place] === parentId)
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
	// extra primary places (a primary part's `fields`) patch directly by field name.
	const primaryFieldPlace: Record<string, Place> = {}
	for (const [place, f] of Object.entries(primaryPart(spec).fields ?? {})) primaryFieldPlace[f as string] = place as Place
	for (const [field, raw] of Object.entries(item)) {
		if (field === 'id') continue
		if (primaryFieldPlace[field]) {
			await store.patch(id, { [primaryFieldPlace[field]]: raw == null || raw === '' ? null : String(raw) })
			continue
		}
		const env: Env = { user: ctx.user, primary: id, parent: null, now, value: raw }
		// a single input field may drive MULTIPLE parts (e.g. invoice `number` gates the primary AND is
		// stored as its own cmene predication) — apply them all, not just the first match. board 0092.
		for (const part of spec.parts.filter((p) => p.field === field)) {
			if (part.kind === 'primary') {
				await store.patch(id, cellsFrom(part.set, env))
			} else if (part.kind === 'singleton' && part.link) {
				await store.patchWhere(part.pred, part.link, id, cellsFrom(part.set, env))
			} else if (part.kind === 'replace' && part.link) {
				await store.deleteWhere(part.pred, part.link, id)
				// presence semantics (board 0092): re-insert only when truthy — done:false leaves it deleted.
				if (raw) await store.insert(part.pred, cellsFrom(part.set, env))
			} else if (part.kind === 'children' && part.childSpec && part.link) {
				// replace wholesale: cascade-remove the existing children, then re-create from the array.
				for (const kid of await childrenOf(store, part, id)) await remove(part.childSpec, store, kid.id)
				if (Array.isArray(raw)) {
					for (const el of raw) await create(part.childSpec, store, el as Record<string, unknown>, ctx, id)
				}
			}
		}
	}
	return id
}

/** Delete one entity: cascade its child sub-entities, the primary row, + every linked predication. */
export async function remove(spec: TypeSpec, store: PredicationStore, id: string): Promise<void> {
	for (const part of spec.parts) {
		if (part.kind === 'children' && part.childSpec) {
			for (const kid of await childrenOf(store, part, id)) await remove(part.childSpec, store, kid.id)
		}
	}
	await store.remove(id)
	for (const part of spec.parts) {
		if (part.kind !== 'children' && part.link) await store.deleteWhere(part.pred, part.link, id)
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
 *  each primary row against its linked predications at the declared gismu positions. When `parent` is
 *  given (a recursive children query), only primaries linking back to that parent are projected. */
export async function query(
	spec: TypeSpec,
	store: PredicationStore,
	parent?: { link: Place; id: string }
): Promise<Record<string, unknown>[]> {
	const primary = primaryPart(spec)
	let primaries = await store.rows(primary.pred)
	if (parent) primaries = primaries.filter((r) => r[parent.link] === parent.id)
	const linked: Record<string, Row[]> = {}
	for (const part of spec.parts) {
		if (part.kind !== 'children' && part.link && !linked[part.pred]) linked[part.pred] = await store.rows(part.pred)
	}
	const out: Record<string, unknown>[] = []
	for (const prow of primaries) {
		const rec: Record<string, unknown> = { id: prow.id }
		for (const [field, proj] of Object.entries(spec.project)) {
			if (proj.children) {
				const part = spec.parts.find((p) => p.kind === 'children' && p.pred === proj.pred)
				rec[field] =
					part?.childSpec && part.link
						? await query(part.childSpec, store, { link: part.link, id: prow.id })
						: []
			} else {
				rec[field] = project(spec, prow, proj, linked, primary.pred)
			}
		}
		out.push(rec)
	}
	return out
}
