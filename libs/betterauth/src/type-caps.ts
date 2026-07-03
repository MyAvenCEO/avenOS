import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import Ajv from 'ajv'
import { sql } from 'kysely'
import { registerContextProvider } from './context'
import { db } from './db'
import { deriveOps } from './derive-ops'
import { publish } from './events'

// board 0102 — DYNAMIC COMPOSITE TYPES. GLM already mints new x1–x5 PREDICATES on the fly (board 0100);
// this lets it mint new composite TYPES too — a `TypeSpec` (the declarative bundle that projects several
// predications into one flat record, e.g. a todo = task+done+due+prioritized+owned_by). A validated
// TypeSpec persisted to `data_bundles` is IMMEDIATELY CRUD-able through the existing generic engine
// (crud() → the type's SEEDED data_operations, board 0112), zero new code. So "a book with an author and a rating"
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
		kind: { type: 'string', enum: ['primary', 'singleton', 'replace', 'children', 'many'] },
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

/** Regenerate a bundle's DERIVED operations in data_operations (global rows). Minting/updating a bundle =
 *  minting its ops; a non-derivable bundle (children/match) simply produces none (the interpreter runs it).
 *  board 0104. */
export async function regenerateDerivedOps(spec: TypeSpec): Promise<void> {
	let ops: ReturnType<typeof deriveOps>
	try {
		ops = deriveOps(spec)
	} catch {
		return // non-derivable → no derived ops seeded; such a bundle is not CRUD-able until derivable (0112 — no interpreter)
	}
	await sql`DELETE FROM data_operations WHERE derived_from = ${spec.type}`.execute(db())
	for (const o of ops) {
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, derived_from, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, ${o.name}, ${o.kind}, ${jsonb(o.spec)}, ${spec.type}, now(), now())
		`.execute(db())
	}
}

/** Persist a validated TypeSpec to the `data_bundles` registry (idempotent by type name) AND regenerate its
 *  derived operations. Throws on an invalid spec — it never reaches the engine. board 0102/0104. */
export async function saveType(spec: TypeSpec): Promise<{ type: string; predicates: string[] }> {
	if (!validateTypeSpec(spec)) {
		throw new Error(`[type-caps] invalid TypeSpec: ${ajv.errorsText(validateTypeSpec.errors)}`)
	}
	await sql`
		INSERT INTO data_bundles (type, spec, created_at, updated_at)
		VALUES (${spec.type}, ${jsonb(spec)}, now(), now())
		ON CONFLICT (type) DO UPDATE SET spec = ${jsonb(spec)}, updated_at = now()
	`.execute(db())
	await regenerateDerivedOps(spec).catch((e) => console.error('[type-caps] derive ops failed:', e))
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

// ── GLM bundle authoring (the non-deterministic layer over the proven engine) ─────────────────────
const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const GLM_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

/** The live predicates with each place's role/kind — so GLM builds traits over REAL predicates + places. */
async function predicatesWithPlaces(uid: string): Promise<string> {
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	const lines: string[] = []
	for (const r of rows) {
		const s = asJson(r.json_schema) as {
			properties?: Record<string, { title?: string; 'x-ref'?: unknown }>
			description?: string
		} | null
		if (!s?.properties?.predicate) continue
		const places = ['x1', 'x2', 'x3', 'x4', 'x5']
			.filter((p) => s.properties?.[p])
			.map(
				(p) =>
					`${p}=${s.properties?.[p]?.title ?? '?'}(${'x-ref' in (s.properties?.[p] ?? {}) ? 'ref' : 'value'})`
			)
			.join(' ')
		lines.push(`- ${r.name}${s.description ? ` — ${s.description}` : ''}\n    ${places}`)
	}
	return lines.length ? lines.sort().join('\n') : '(none yet — mint predicates first)'
}

const BUNDLE_INSTRUCTIONS = [
	'You author a BUNDLE spec — the recipe for a kind of ENTITY as a set of TRAITS over x1–x5 predicates, plus',
	'a VIEW that reads it back flat. You NEVER write SQL. Output ONLY the JSON object, no prose, no code fence.',
	'',
	'A bundle: { "type":"<snake_case name>", "parts":[<trait>…], "project":{ "<field>": <read> … } }',
	'A trait (part): { "pred":"<predicate>", "kind":"primary|singleton|replace|children|many", "field":"<input field>",',
	'  "link":"x1..x5", "create":{"x1..x5":"<bind>"}, "set":{"x1..x5":"<bind>"}, "match":{"x1..x5":"<literal>"} }',
	'  · primary   — its rows ARE the entities (exactly one primary). `field` drives create; `set` patches it.',
	'  · singleton — one linked row created WITH the entity (e.g. owned_by; `link` = the place holding the id).',
	'  · replace   — an optional linked attribute; set→delete+reinsert, cleared when empty. Use for done/due/etc.',
	'  · children  — a 0..N array field; each element is its own sub-entity via `childSpec` (a nested bundle).',
	'Binds: "$user" (the owner id), "$value" (the field value), "$primary" (this entity id), "$parent" (parent id),',
	'  "$now" (timestamp), or a literal. `match` shares ONE predicate across traits by a fixed discriminator cell.',
	'A read (project): { "pred":"<predicate>", "place":"x1..x5" } or { "pred":"<p>", "notNull":"x1..x5" } (boolean:',
	'  present=true) or { "pred":"<p>", "children":true } (nested array) — optionally with the same "match".',
	'',
	'Choose predicates + places from the list below by their declared place structure. Prefer EXISTING predicates;',
	'if a needed relation is missing, still reference it by a clear english_snake_case name (it will be minted).',
	'Example — a todo over task(x1=agent,x2=action)+owned_by(x1=owner,x2=entity)+done(x1=task):',
	'  {"type":"todo","parts":[{"pred":"task","kind":"primary","field":"title","create":{"x1":"$user","x2":"$value"},"set":{"x2":"$value"}},',
	'   {"pred":"owned_by","kind":"singleton","link":"x2","create":{"x1":"$user"}},',
	'   {"pred":"done","kind":"replace","link":"x1","field":"done","set":{"x1":"$primary"}}],',
	'   "project":{"title":{"pred":"task","place":"x2"},"done":{"pred":"done","notNull":"x1"},"owner":{"pred":"owned_by","place":"x1"}}}'
].join('\n')

function parseJsonObject(text: string): Record<string, unknown> | null {
	const cleaned = text.replace(/```(?:json)?/gi, '').trim()
	const s = cleaned.indexOf('{')
	const e = cleaned.lastIndexOf('}')
	if (s < 0 || e <= s) return null
	try {
		return JSON.parse(cleaned.slice(s, e + 1)) as Record<string, unknown>
	} catch {
		return null
	}
}

/** GLM-5.2 authors a bundle spec from plain language, grounded in the live predicates + existing bundles +
 *  the bundle meta-language; AJV-validates it. Returns the spec + the predicates it references (so the actor
 *  can mint any that don't exist yet through the 0100 ontology path). board 0102. */
async function mintBundle(
	uid: string,
	request: string
): Promise<{ spec?: TypeSpec; predicates?: string[]; error?: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const [preds, bundles] = await Promise.all([predicatesWithPlaces(uid), listTypeSpecs()])
	const system = [
		BUNDLE_INSTRUCTIONS,
		'',
		'EXISTING PREDICATES (choose traits + places from these; a missing one will be minted):',
		preds,
		'',
		'EXISTING BUNDLES (reuse one of these names if it already fits, else pick a new one):',
		bundles.map((b) => `- ${b.name}: ${b.gloss}`).join('\n') || '(none yet)'
	].join('\n')
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: `Author the bundle for: ${request}` }
			],
			stream: false
		})
	}).catch((e) => {
		console.error('[type-caps] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[]
	} | null
	const spec = parseJsonObject(data?.choices?.[0]?.message?.content ?? '')
	if (!spec) return { error: 'GLM did not return a parseable bundle spec' }
	if (!validateTypeSpec(spec))
		return { error: `GLM produced an invalid bundle: ${ajv.errorsText(validateTypeSpec.errors)}` }
	return { spec, predicates: typePredicates(spec) }
}

/** The predicates the user already has (names only) — the actor diffs against a bundle's needs. board 0102. */
async function existingPredicateNames(uid: string): Promise<string[]> {
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	return rows
		.filter(
			(r) =>
				(asJson(r.json_schema) as { properties?: { predicate?: unknown } })?.properties?.predicate
		)
		.map((r) => r.name)
}

/** `ctx.bundle` — the composite-type (bundle) registry caps: list · GLM-author · persist. board 0102. */
export function typeCaps(uid: string) {
	return {
		list: listTypeSpecs,
		mint: (request: string) => mintBundle(uid, request),
		existingPredicates: () => existingPredicateNames(uid),
		save: (spec: TypeSpec) => saveType(spec),
		predicatesOf: typePredicates,
		validate: (spec: unknown): spec is TypeSpec => validateTypeSpec(spec),
		publishChanged: () => publish(uid, { entity: 'data' })
	}
}
