// Predicate compiler — board 0087. Turns a positional predicate DEFINITION (a "gismu"
// with English name + x1…x5 place structure) into a self-documenting Ajv JSON Schema, so
// predications validate through the existing generic /api/data (data_schema/data_value)
// path with ZERO new validation machinery. Place structures are reused from the canonical
// Lojban gismu lexicon (.claude/skills/ontology/gismu.json) — names are pragmatic English.
//
// NOTE: the shared Ajv instance has no `ajv-formats`, so we emit `pattern` regexes, never
// `format` (which would silently not validate). See board 0084/0085.

export type PlaceKind = 'value' | 'ref'
export type PlaceType = 'string' | 'number' | 'quantity' | 'boolean' | 'date-time'

/** One positional place (x1…x5) of a predicate. */
export type PlaceDef = {
	pos: string // 'x1'..'x5'
	role: string // short human label, e.g. 'agent', 'amount'
	gloss: string // what fills this place
	kind: PlaceKind
	type?: PlaceType // when kind = 'value'
	references?: string // when kind = 'ref' ('*' = polymorphic)
	required?: boolean // default true
	nullable?: boolean // value may be explicitly null (e.g. an open interval's end)
	minLength?: number // for string values
	example?: string
}

/** A predicate: an English name, optional gismu provenance, and its place structure. */
export type PredicateDef = {
	predicate: string // English name, e.g. 'task'
	gismu?: string | null // Lojban root the place structure is reused from
	gloss: string // the whole-predicate gloss
	places: PlaceDef[]
}

// A ref is the id of another row (a data_value UUID) or a principal (a Better-Auth user id,
// ~32 alphanumerics) — so accept any word/hyphen id of reasonable length, not strictly a UUID.
const ID_PATTERN = '^[\\w-]{6,}$'
// Accepts a date (2026-06-29) or an ISO-8601 date-time (no ajv-formats available).
const DATETIME_PATTERN =
	'^\\d{4}-\\d{2}-\\d{2}([T ]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?)?$'

/** The data_schema row name for a data type. x1–x5 predications ARE the universal data-type model,
 * so the schema name is just the bare data-type name — no namespace prefix leaks to the DB/UI. */
export function predSchemaName(def: PredicateDef): string {
	return def.predicate
}

// Place factories — keep the gismu-faithful vocab terse + consistent. board 0097 demands every
// predicate carry ALL of its gismu's places (x1–x5); the ones our domain doesn't fill are declared
// `required: false` so they're documented + present without breaking stored rows that omit them.
export function ref(pos: string, role: string, gloss: string, opts: Partial<PlaceDef> = {}): PlaceDef {
	return { pos, role, gloss, kind: 'ref', references: '*', ...opts }
}
export function val(
	pos: string,
	role: string,
	gloss: string,
	type: PlaceType,
	opts: Partial<PlaceDef> = {}
): PlaceDef {
	return { pos, role, gloss, kind: 'value', type, ...opts }
}

function placeSchema(p: PlaceDef): Record<string, unknown> {
	const base: Record<string, unknown> = {
		title: p.role,
		description: p.gloss
	}
	if (p.example !== undefined) base.examples = [p.example]

	if (p.kind === 'ref') {
		base.type = p.nullable ? ['string', 'null'] : 'string'
		base.pattern = ID_PATTERN
		base['x-ref'] = p.references ?? '*'
		return base
	}

	// value place
	let jsonType: string
	switch (p.type) {
		case 'number':
		case 'quantity':
			jsonType = 'number'
			break
		case 'boolean':
			jsonType = 'boolean'
			break
		default:
			jsonType = 'string' // string + date-time
	}
	base.type = p.nullable ? [jsonType, 'null'] : jsonType
	if (p.type === 'date-time') base.pattern = DATETIME_PATTERN
	if (p.type === 'string' && p.minLength !== undefined) base.minLength = p.minLength
	return base
}

/** Compile a predicate definition into a self-documenting Ajv JSON Schema (a data_schema row). */
export function compilePredicate(def: PredicateDef): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		predicate: { const: def.predicate, description: 'Predicate name — fixes the place structure.' }
	}
	const required = ['predicate']
	for (const p of def.places) {
		properties[p.pos] = placeSchema(p)
		if (p.required !== false) required.push(p.pos)
	}
	return {
		type: 'object',
		title: def.predicate,
		description: def.gloss,
		// canonical Lojban gismu provenance — seeded into the data_schema row so the DB/UI shows it
		...(def.gismu ? { 'x-gismu': def.gismu } : {}),
		required,
		additionalProperties: false,
		properties
	}
}
