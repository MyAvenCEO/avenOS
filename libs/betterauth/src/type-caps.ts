import type { TypeSpec } from '@avenos/aven-ontology'
import Ajv from 'ajv'
import { sql } from 'kysely'
import { registerContextProvider } from './context'
import { db } from './db'
import { publish } from './events'

// board 0102 — DYNAMIC COMPOSITE TYPES. GLM already mints new x1–x5 PREDICATES on the fly (board 0100);
// this lets it mint new composite TYPES too — a `TypeSpec` (the declarative bundle that projects several
// predications into one flat record, e.g. a todo = task+done+due+prioritized+owned_by). A validated
// TypeSpec persisted to `data_bundles` is IMMEDIATELY CRUD-able through the existing generic engine
// (executeDataTool → loadTypeSpec → runType), zero new code. So "a book with an author and a rating"
// becomes AI-authored config, not seeded code — the last seeded layer of the data brain goes dynamic.

// ── the TypeSpec meta-language, as an AJV meta-schema (GLM emits JSON matching this) ───────────────
const PLACES = ['x1', 'x2', 'x3', 'x4', 'x5']
const PLACE_ENUM = { type: 'string', enum: PLACES } as const
/** an object keyed by x1…x5 whose values match `items` (create/set/fields/match maps). */
function placeRecord(items: object) {
	return {
		type: 'object',
		properties: Object.fromEntries(PLACES.map((p) => [p, items])),
		additionalProperties: false
	}
}
const BIND = { type: 'string' } as const
const CELL = { type: ['string', 'null'] } as const

const PART_SCHEMA = {
	$id: 'part',
	type: 'object',
	properties: {
		pred: { type: 'string', minLength: 1 },
		link: PLACE_ENUM,
		kind: { type: 'string', enum: ['primary', 'singleton', 'replace', 'children'] },
		field: { type: 'string' },
		create: placeRecord(BIND),
		set: placeRecord(BIND),
		fields: placeRecord({ type: 'string' }),
		match: placeRecord(CELL),
		childSpec: { $ref: 'typespec' } // recursive: a `children` part nests a whole sub-type
	},
	required: ['pred', 'kind'],
	additionalProperties: false
} as const

const PROJECT_SCHEMA = {
	type: 'object',
	properties: {
		pred: { type: 'string', minLength: 1 },
		place: PLACE_ENUM,
		notNull: PLACE_ENUM,
		children: { type: 'boolean' },
		match: placeRecord(CELL)
	},
	required: ['pred'],
	additionalProperties: false
} as const

export const TYPE_META_SCHEMA = {
	$id: 'typespec',
	type: 'object',
	properties: {
		type: { type: 'string', minLength: 1, pattern: '^[a-z][a-z0-9_]*$' },
		parts: { type: 'array', minItems: 1, items: { $ref: 'part' } },
		project: { type: 'object', minProperties: 1, additionalProperties: PROJECT_SCHEMA }
	},
	required: ['type', 'parts', 'project'],
	additionalProperties: false
} as const

const ajv = new Ajv({ allErrors: true })
ajv.addSchema(PART_SCHEMA, 'part')
export const validateTypeSpec = ajv.compile<TypeSpec>(TYPE_META_SCHEMA)

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}
function jsonb(value: unknown) {
	return sql`${JSON.stringify(value)}::jsonb`
}

/** Every predicate a type references (its parts + any nested childSpec). Used to check they all exist. */
export function typePredicates(spec: TypeSpec): string[] {
	const out = new Set<string>()
	const walk = (s: TypeSpec): void => {
		for (const p of s.parts) {
			out.add(p.pred)
			if (p.childSpec) walk(p.childSpec)
		}
	}
	walk(spec)
	return [...out]
}

/** Persist a validated TypeSpec to the `data_bundles` registry (idempotent by type name). Throws on an
 *  invalid spec — it never reaches the engine. board 0102. */
export async function saveType(spec: TypeSpec): Promise<{ type: string; predicates: string[] }> {
	if (!validateTypeSpec(spec)) {
		throw new Error(`[type-caps] invalid TypeSpec: ${ajv.errorsText(validateTypeSpec.errors)}`)
	}
	await sql`
		INSERT INTO data_bundles (type, spec, created_at, updated_at)
		VALUES (${spec.type}, ${jsonb(spec)}, now(), now())
		ON CONFLICT (type) DO UPDATE SET spec = ${jsonb(spec)}, updated_at = now()
	`.execute(db())
	return { type: spec.type, predicates: typePredicates(spec) }
}

/** The registered composite types (name + the predicates each projects). Global registry (Layer A). */
async function listTypeSpecs(): Promise<{ name: string; gloss: string }[]> {
	const rows = await sql<{
		type: string
		spec: unknown
	}>`SELECT type, spec FROM data_bundles ORDER BY type`.execute(db())
	return rows.rows.map((r) => {
		const spec = asJson(r.spec) as TypeSpec
		return {
			name: r.type,
			gloss: `${typePredicates(spec).join(' + ')} → { ${Object.keys(spec.project ?? {}).join(', ')} }`
		}
	})
}

// board 0102 — a transparency provider: the config UI shows the live composite-type registry (each type's
// predicates + projected fields), alongside the predicate + query/mutation registries.
registerContextProvider('types', async () => ({
	kind: 'list',
	label: 'Composite types',
	items: await listTypeSpecs()
}))

/** `ctx.types` — the composite-type registry caps (list + persist). The GLM authoring is wired in ai.ts. */
export function typeCaps() {
	return {
		list: listTypeSpecs,
		save: (spec: TypeSpec) => saveType(spec),
		predicatesOf: typePredicates,
		validate: (spec: unknown): spec is TypeSpec => validateTypeSpec(spec),
		publishChanged: (uid: string) => publish(uid, { entity: 'data' })
	}
}
