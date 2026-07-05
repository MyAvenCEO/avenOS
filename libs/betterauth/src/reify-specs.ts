import type { TypeSpec } from '@avenos/aven-ontology'

// board 0112 — REIFIED ENTITY BUNDLES. A goal and a location are ENTITIES of their own (not name strings):
// each is an identity-only primary predication (girzu / stuzi) + its human name on the UNIVERSAL `named`
// label (a `replace` trait, so a rename is one row edit) + universal ownership. saveType(SPEC) derives
// <type>.list/create/update/delete for free; the name projects straight off the `named` join. The edges
// that point AT these entities (member_of.x2 → goalId, located.x2 → locationId) are repointed in the
// slice-2 migration. This module is the ONE definition shared by the migration and its proof test.

/** The name label is identical for every reified entity — a `replace` trait on `named`≡cmene so setting
 *  it clears the old label and re-inserts (renamable), and the flat view reads the name from named.x1. */
const NAMED_LABEL = {
	pred: 'named',
	kind: 'replace' as const,
	link: 'x2' as const,
	field: 'name',
	set: { x1: '$value', x2: '$primary' }
}
const OWNED = {
	pred: 'owned_by',
	kind: 'singleton' as const,
	link: 'x2' as const,
	create: { x1: '$user' }
}
const NAME_OWNER_PROJECT = {
	name: { pred: 'named', place: 'x1' as const },
	owner: { pred: 'owned_by', place: 'x1' as const }
}

/** goal ≡ girzu — a group/cluster entity. Its members are the member_of edges that point at it. */
export const GOAL_SPEC: TypeSpec = {
	type: 'goal',
	parts: [{ pred: 'girzu', kind: 'primary' }, NAMED_LABEL, OWNED],
	project: NAME_OWNER_PROJECT
}

/** location ≡ stuzi — a storage place entity. Stock sits at it via the located edges. */
export const LOCATION_SPEC: TypeSpec = {
	type: 'location',
	parts: [{ pred: 'stuzi', kind: 'primary' }, NAMED_LABEL, OWNED],
	project: NAME_OWNER_PROJECT
}
