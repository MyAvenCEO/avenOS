import type { PartSpec, TypeSpec } from '@avenos/aven-ontology'
import type { MutationSpec, QuerySpec } from './queries'

// board 0104 — a BUNDLE compiles to OPERATIONS. A bundle (TypeSpec) is the definition of a kind (its traits +
// the flat view); deriveOps turns it into the four standard operations the generic engine actually runs:
//   <type>.list    (query)    — the primary predicate LEFT-joined to each satellite, projected as the view.
//   <type>.create  (mutation) — insert the primary (op 0 = the entity id) + singleton + when-guarded replace inserts.
//   <type>.update  (mutation) — patch the primary + clear/re-insert each replace attribute (partial-safe).
//   <type>.delete  (mutation) — cascade-delete the primary + every linked satellite.
// SQL analogy: the bundle is CREATE TABLE, these ops are the SELECT/INSERT/UPDATE/DELETE. Scope guard: a
// `children` trait or a `match` (discriminated) trait is NOT derivable yet — deriveOps throws LOUDLY so the
// caller keeps the runType interpretation as an explicit fallback (never a silent partial derivation).

export type DerivedOp = { name: string; kind: 'query' | 'mutation'; spec: QuerySpec | MutationSpec }

/** $primary is context-dependent: a fresh create references the primary INSERT op (op 0) via {ref:0}; an
 *  update/delete references the caller-supplied entity id via {param:'id'}. */
type PrimaryRef = { ref: number } | { param: string }

/** Translate one TypeSpec bind (a place→bind entry of create/set) into an ops cell value. */
function bindToCell(bind: unknown, field: string | undefined, primaryRef: PrimaryRef): unknown {
	if (bind === '$user') return { bind: '$user' }
	if (bind === '$now') return { bind: '$now' }
	if (bind === '$value') {
		if (!field) throw new Error('[derive] $value with no field on the part')
		return { param: field }
	}
	if (bind === '$primary') return primaryRef
	if (typeof bind === 'string' && bind.startsWith('$'))
		throw new Error(`[derive] unsupported bind "${bind}" (conditional binds not yet derivable)`)
	return bind // a literal
}

function cellsFrom(
	obj: Partial<Record<string, string>> | undefined,
	field: string | undefined,
	primaryRef: PrimaryRef
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [place, bind] of Object.entries(obj ?? {}))
		out[place] = bindToCell(bind, field, primaryRef)
	return out
}

/** Compile a bundle into its four standard operations. Throws on a non-derivable trait (children/match). */
export function deriveOps(bundle: TypeSpec): DerivedOp[] {
	const primary = bundle.parts.find((p) => p.kind === 'primary')
	if (!primary) throw new Error(`[derive] ${bundle.type}: no primary part`)
	for (const p of bundle.parts) {
		if (p.kind === 'children')
			throw new Error(`[derive] ${bundle.type}.${p.pred}: children traits not yet derivable`)
		if (p.match)
			throw new Error(
				`[derive] ${bundle.type}.${p.pred}: discriminated (match) traits not yet derivable`
			)
	}
	const satellites = bundle.parts.filter((p) => p !== primary)
	const linkOf = (p: PartSpec): string => {
		if (!p.link) throw new Error(`[derive] ${bundle.type}.${p.pred}: satellite needs a link place`)
		return p.link
	}

	// ── LIST (query): primary LEFT-joined to each satellite (correlate on the entity row id), projected as the view.
	const joins: NonNullable<QuerySpec['join']> = []
	const joinIndex = new Map<string, number>()
	for (const p of satellites) {
		joinIndex.set(p.pred, joins.length)
		joins.push({ predicate: p.pred, kind: 'left', on: { place: linkOf(p) as never, base: 'id' } })
	}
	const project: NonNullable<QuerySpec['project']> = ['id']
	for (const [field, proj] of Object.entries(bundle.project)) {
		if (proj.children)
			throw new Error(`[derive] ${bundle.type}.${field}: children projection not derivable`)
		if (proj.pred === primary.pred) {
			project.push({ place: proj.place as never, as: field })
		} else {
			const ji = joinIndex.get(proj.pred)
			if (ji === undefined)
				throw new Error(`[derive] ${bundle.type}.${field}: projects unknown predicate ${proj.pred}`)
			if (proj.notNull) project.push({ join: ji, exists: true, as: field })
			else project.push({ join: ji, place: proj.place as never, as: field })
		}
	}
	const list: QuerySpec = { name: `${bundle.type}.list`, from: primary.pred, join: joins, project }

	// ── CREATE (mutation): primary is op 0 (its row id = the entity), so $primary = {ref:0}.
	const createRef: PrimaryRef = { ref: 0 }
	const createOps: MutationSpec['ops'] = [
		{
			op: 'insert',
			predicate: primary.pred,
			cells: cellsFrom(primary.create, primary.field, createRef)
		}
	]
	for (const p of satellites) {
		if (p.kind === 'singleton') {
			// created WITH the entity; the link place holds the primary id.
			createOps.push({
				op: 'insert',
				predicate: p.pred,
				cells: { ...cellsFrom(p.create, p.field, createRef), [linkOf(p)]: createRef }
			})
		} else if (p.kind === 'replace') {
			// optional attribute: insert iff the field is truthy (the `set` already binds the link via $primary).
			createOps.push({
				op: 'insert',
				predicate: p.pred,
				cells: cellsFrom(p.set, p.field, createRef),
				when: { param: p.field }
			})
		}
	}
	const create: MutationSpec = { name: `${bundle.type}.create`, ops: createOps }

	// ── UPDATE (mutation): partial-safe. $primary = the caller's entity id ({param:'id'}).
	const updateRef: PrimaryRef = { param: 'id' }
	const updateOps: MutationSpec['ops'] = []
	if (primary.set && Object.keys(primary.set).length) {
		updateOps.push({
			op: 'update',
			predicate: primary.pred,
			where: [{ place: 'id', op: 'eq', param: 'id' }],
			cells: cellsFrom(primary.set, primary.field, updateRef),
			...(primary.field ? { when: { present: primary.field } } : {})
		})
	}
	for (const p of satellites) {
		if (p.kind !== 'replace') continue // a singleton (e.g. ownership) is not changed on update
		// clear the old attribute (only when the field was supplied) then re-insert (only when truthy).
		updateOps.push({
			op: 'delete',
			predicate: p.pred,
			where: [{ place: linkOf(p) as never, op: 'eq', param: 'id' }],
			when: { present: p.field }
		})
		updateOps.push({
			op: 'insert',
			predicate: p.pred,
			cells: cellsFrom(p.set, p.field, updateRef),
			when: { param: p.field }
		})
	}
	const update: MutationSpec = { name: `${bundle.type}.update`, ops: updateOps }

	// ── DELETE (mutation): cascade the primary + every linked satellite.
	const deleteOps: MutationSpec['ops'] = [
		{ op: 'delete', predicate: primary.pred, where: [{ place: 'id', op: 'eq', param: 'id' }] }
	]
	for (const p of satellites)
		deleteOps.push({
			op: 'delete',
			predicate: p.pred,
			where: [{ place: linkOf(p) as never, op: 'eq', param: 'id' }]
		})
	const del: MutationSpec = { name: `${bundle.type}.delete`, ops: deleteOps }

	return [
		{ name: list.name as string, kind: 'query', spec: list },
		{ name: create.name as string, kind: 'mutation', spec: create },
		{ name: update.name as string, kind: 'mutation', spec: update },
		{ name: del.name as string, kind: 'mutation', spec: del }
	]
}
