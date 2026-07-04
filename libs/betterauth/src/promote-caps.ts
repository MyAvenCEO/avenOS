import type { PredicateDefJSON } from '@avenos/skills/tools'
import type { TypeSpec } from '@avenos/aven-ontology'
import { sql } from 'kysely'
import { runNamedOp } from './actor-run'
import { runActorCode } from './actor-sandbox'
import { db } from './db'
import { listMockups, loadRawParts, MOCK_PREFIX } from './mockup-caps'
import { ontologyCaps } from './ontology'
import { saveType } from './type-caps'
import { loadVibe } from './vibe-registry'

// board 0113 — PROMOTION: a mockup becomes a FULL interactive skill, stepwise (one actor per step, each
// with its own card): plan_app → mint_data → wire_actors → seed_data → promote. Design contract (the
// discovered decisions): the SKELETON is derived DETERMINISTICALLY from the mockup's example-source
// shape (arrays → entities, scalars → computed aggregates); GLM authors ONLY the field→Lojban-predicate
// vocabulary (persisted through the Ontology skill's validated save cap — the sub-skill delegation) and
// the sandbox overview code (actor.code — the 0111 seat's FIRST real user, caps ['ops'], gated by a
// SMOKE RUN against the example-source contract). The identity mapper SURVIVES promotion: the code
// actor shapes real data to exactly the example-source shape, so view/style/mapper copy over unchanged.

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const GLM_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

// ── S1: the deterministic skeleton ──────────────────────────────────────────────────────────────────
export type AppSkeleton = {
	/** kebab app id (the mock name without the prefix, e.g. banking-overview). */
	app: string
	/** top-level arrays of objects → entities: bundle type (singularized) + item fields. */
	entities: { key: string; type: string; fields: string[] }[]
	/** top-level scalars → aggregates COMPUTED by the sandbox actor (the query grammar has no SUM). */
	aggregates: string[]
}

const singular = (k: string): string => (k.endsWith('s') && k.length > 3 ? k.slice(0, -1) : k)

export function deriveAppSkeleton(app: string, source: Record<string, unknown>): AppSkeleton {
	const entities: AppSkeleton['entities'] = []
	const aggregates: string[] = []
	for (const [key, val] of Object.entries(source)) {
		if (Array.isArray(val) && val.length && typeof val[0] === 'object' && val[0] !== null) {
			const fields = [...new Set(val.flatMap((it) => Object.keys(it as object)))]
			entities.push({ key, type: singular(key), fields })
		} else if (typeof val === 'string' || typeof val === 'number') {
			aggregates.push(key)
		}
	}
	return { app, entities, aggregates }
}

// ── S2: the vocabulary (GLM seam) + the deterministic bundle ────────────────────────────────────────
/** field → predicate: reuse an existing one by name, or a full def to mint via ontology.save. */
export type VocabPlan = {
	entity: { reuse?: string; def?: PredicateDefJSON }
	fields: Record<string, { reuse?: string; def?: PredicateDefJSON }>
}

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

/** GLM maps one entity's fields to Lojban predicates (keyed output — reuse or full defs). The defs are
 *  persisted through ontologyCaps.save (compile → AJV self-validate → data_schema): the delegation. */
async function glmVocabPlan(
	uid: string,
	entity: AppSkeleton['entities'][0],
	sampleRow: Record<string, unknown>
): Promise<VocabPlan | { error: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const existing = await ontologyCaps(uid).list()
	const system = [
		'You map the fields of a new entity kind to Lojban x1–x5 PREDICATES. For each field either REUSE an',
		'existing predicate (when its meaning fits) or DEFINE a new one grounded in a real gismu. Output ONLY:',
		'  { "entity": {"reuse":"<name>"} | {"def":<PredicateDef>}, "fields": { "<field>": {"reuse":..}|{"def":..} } }',
		'A PredicateDef: { "predicate":"<english_snake>", "gismu":"<5-letter>", "gloss":"<gismu: x1 … x2 …>",',
		'  "places":[{"pos":"x1","role":"<role>","gloss":"<what>","kind":"ref"|"value","required":true|false}…] }',
		'The ENTITY predicate is the thing itself (its rows ARE the instances; give it a ref x1 + a value place',
		'for its display label). Every FIELD predicate needs at least one ref place (links to the entity row)',
		'and one value place (carries the field value). Prefer REUSE (owned_by, named, due, prioritized…).',
		'',
		'EXISTING PREDICATES:',
		existing.map((p) => `- ${p.name}${p.gloss ? ` — ${p.gloss}` : ''}`).join('\n') || '(none)'
	].join('\n')
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{
					role: 'user',
					content: `Entity "${entity.type}" with fields ${entity.fields.join(', ')}. Sample: ${JSON.stringify(sampleRow)}`
				}
			],
			stream: false
		})
	}).catch(() => null)
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[]
	} | null
	const rawText = data?.choices?.[0]?.message?.content ?? ''
	const obj = parseJsonObject(rawText)
	if (!obj || !obj.fields) {
		console.error('[promote] vocab plan unparseable — raw GLM output:', rawText.slice(0, 800))
		return { error: 'GLM did not return a parseable vocabulary plan' }
	}
	return obj as unknown as VocabPlan
}

/** The x-places of a stored predicate schema: the first VALUE place + the first REF place. */
async function placesOf(
	uid: string,
	predicate: string
): Promise<{ valuePlace: string | null; refPlace: string | null }> {
	const r = await sql<{ json_schema: unknown }>`
		SELECT json_schema FROM data_schema WHERE user_id = ${uid} AND name = ${predicate} LIMIT 1
	`.execute(db())
	const s = r.rows[0]?.json_schema
	const parsed = (typeof s === 'string' ? JSON.parse(s) : s) as {
		properties?: Record<string, { 'x-ref'?: unknown }>
	} | null
	let valuePlace: string | null = null
	let refPlace: string | null = null
	for (const p of ['x1', 'x2', 'x3', 'x4', 'x5']) {
		const prop = parsed?.properties?.[p]
		if (!prop) continue
		if ('x-ref' in prop) {
			if (!refPlace) refPlace = p
		} else if (!valuePlace) valuePlace = p
	}
	return { valuePlace, refPlace }
}

/** Persist the vocabulary (reuse as-is; mint defs via the Ontology save cap), then build the bundle
 *  DETERMINISTICALLY: entity predicate = primary (label field drives it), every other field a replace
 *  trait, owned_by singleton — the exact INVENTORY_SPEC pattern. saveType derives the CRUD ops. */
export async function mintDataLayer(
	uid: string,
	skeleton: AppSkeleton,
	source: Record<string, unknown>,
	vocabSeam?: (entity: AppSkeleton['entities'][0]) => Promise<VocabPlan>
): Promise<{
	types?: { type: string; predicates: string[] }[]
	/** the x1–x5 vocabulary detail for the mint card: full defs for MINTED predicates + reused names. */
	minted?: PredicateDefJSON[]
	reused?: string[]
	error?: string
}> {
	const onto = ontologyCaps(uid)
	const out: { type: string; predicates: string[] }[] = []
	const mintedDefs: PredicateDefJSON[] = []
	const reusedNames: string[] = []
	for (const entity of skeleton.entities) {
		const sample = (source[entity.key] as Record<string, unknown>[])[0] ?? {}
		const plan = vocabSeam ? await vocabSeam(entity) : await glmVocabPlan(uid, entity, sample)
		if ('error' in plan && plan.error) {
			console.error('[promote] mintDataLayer failed:', plan.error)
			return { error: plan.error }
		}
		const vp = plan as VocabPlan
		// persist: mint every def through the ontology cap (compile + self-validate + data_schema).
		const resolve = async (m: { reuse?: string; def?: PredicateDefJSON }): Promise<string> => {
			if (m.reuse) {
				if (!reusedNames.includes(m.reuse)) reusedNames.push(m.reuse)
				return m.reuse
			}
			if (!m.def) throw new Error('[promote] vocabulary entry needs reuse or def')
			const saved = await onto.save(m.def)
			mintedDefs.push(m.def)
			return saved.name
		}
		const entityPred = await resolve(vp.entity)
		const fieldPreds: Record<string, string> = {}
		for (const [field, m] of Object.entries(vp.fields)) fieldPreds[field] = await resolve(m)

		// deterministic bundle: label field = the primary's driving field.
		const label =
			entity.fields.find((f) => ['name', 'title', 'label'].includes(f)) ?? entity.fields[0]
		const ep = await placesOf(uid, entityPred)
		if (!ep.valuePlace) return { error: `[promote] entity predicate ${entityPred} has no value place` }
		const parts: TypeSpec['parts'] = [
			{
				pred: entityPred,
				kind: 'primary',
				field: label,
				create: { [ep.valuePlace]: '$value' } as never,
				set: { [ep.valuePlace]: '$value' } as never
			},
			{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } }
		]
		const project: TypeSpec['project'] = {
			[label]: { pred: entityPred, place: ep.valuePlace as never },
			owner: { pred: 'owned_by', place: 'x1' }
		}
		for (const field of entity.fields) {
			if (field === label) continue
			const pred = fieldPreds[field]
			if (!pred) return { error: `[promote] no predicate mapped for field "${field}"` }
			const fp = await placesOf(uid, pred)
			if (!fp.valuePlace || !fp.refPlace)
				return { error: `[promote] predicate ${pred} lacks a value+ref place for field "${field}"` }
			parts.push({
				pred,
				kind: 'replace',
				link: fp.refPlace as never,
				field,
				set: { [fp.refPlace]: '$primary', [fp.valuePlace]: '$value' } as never
			})
			project[field] = { pred, place: fp.valuePlace as never }
		}
		const spec: TypeSpec = { type: entity.type, parts, project }
		const saved = await saveType(spec)
		out.push({ type: saved.type, predicates: saved.predicates })
	}
	return { types: out, minted: mintedDefs, reused: reusedNames }
}

// ── S3: the sandbox overview actor (GLM seam + the SMOKE-RUN gate) ─────────────────────────────────
/** GLM authors the sandbox code: list via ctx.ops, shape state to the example-source contract. */
async function glmOverviewCode(skeleton: AppSkeleton, source: Record<string, unknown>): Promise<string | { error: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const system = [
		'You write the BEHAVIOR of a small app actor as a SINGLE JavaScript module for a locked-down sandbox.',
		'It must define:  async function handle(msg, caps) { ... return state }',
		'Available capability: caps.ops(name, params) — run a named data operation. The list ops are:',
		skeleton.entities.map((e) => `  caps.ops("${e.type}.list", {}) → { rows: [{id, ${e.fields.join(', ')}, owner}] }`).join('\n'),
		'RETURN a state object with EXACTLY these keys (the render contract — the card binds to them):',
		JSON.stringify(Object.fromEntries([...skeleton.aggregates.map((a) => [a, '<computed>']), ...skeleton.entities.map((e) => [e.key, ['<rows shaped like the sample>']])])),
		`Sample state (match value FORMATTING, e.g. currency strings): ${JSON.stringify(source).slice(0, 800)}`,
		'Aggregates are COMPUTED from the rows (e.g. a total = sum of parsed amounts, formatted like the sample).',
		'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
	].join('\n')
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: `Write the ${skeleton.app} overview actor.` }
			],
			stream: false
		})
	}).catch(() => null)
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
	const code = (data?.choices?.[0]?.message?.content ?? '').replace(/```(?:js|javascript)?/gi, '').trim()
	return code || { error: 'GLM returned no code' }
}

/** The SMOKE-RUN gate: the code must run in the sandbox against stub ops and return the contract keys. */
export async function smokeRunOverview(
	code: string,
	skeleton: AppSkeleton,
	source: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; state?: Record<string, unknown> }> {
	const stubOps = async (name: unknown) => {
		const entity = skeleton.entities.find((e) => `${e.type}.list` === String(name))
		if (!entity) return { rows: [] }
		return { rows: (source[entity.key] as Record<string, unknown>[]).map((r, i) => ({ id: `s${i}`, ...r })) }
	}
	try {
		const state = (await runActorCode(code, {}, { ops: stubOps }, {})) as Record<string, unknown>
		if (!state || typeof state !== 'object') return { ok: false, error: 'code did not return a state object' }
		const missing = [
			...skeleton.aggregates.filter((a) => state[a] == null || state[a] === ''),
			...skeleton.entities.filter((e) => !Array.isArray(state[e.key])).map((e) => e.key)
		]
		if (missing.length) return { ok: false, error: `state misses contract keys: ${missing.join(', ')}` }
		return { ok: true, state }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

/** Mint the promoted skill row + its actors: generic data_crud + the smoke-gated sandbox overview. */
export async function wireSkill(
	uid: string,
	skeleton: AppSkeleton,
	source: Record<string, unknown>,
	codeSeam?: string
): Promise<{ skillId?: string; error?: string; code?: string }> {
	const skillId = skeleton.app
	const label = skillId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
	const authored = codeSeam ?? (await glmOverviewCode(skeleton, source))
	if (typeof authored !== 'string') return { error: authored.error }
	const smoke = await smokeRunOverview(authored, skeleton, source)
	if (!smoke.ok) return { error: `smoke run failed: ${smoke.error}` }

	const D = db()
	const entity = skeleton.entities[0]
	await sql`
		INSERT INTO skill (id, label, description, position, created_at, updated_at)
		VALUES (${skillId}, ${label},
			${`the user's ${label} app — ${entity ? `${entity.key} (${entity.fields.join(', ')})` : 'data'}: show the overview, list/add/edit/delete entries`},
			9, now(), now())
		ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now()
	`.execute(D)
	const crudMailbox = {
		description: `Read or modify the user's ${label} data (schema "${entity?.type}"): items with ${entity?.fields.join(', ')}. BATCH create/update via items; delete via ids; list with the universal {field,value,op} filter.`,
		parameters: {
			type: 'object',
			properties: {
				schema: { type: 'string', description: `Always "${entity?.type}" on this skill.` },
				action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
				items: { type: 'array', items: { type: 'object', additionalProperties: true } },
				filter: { type: 'object', properties: { field: { type: 'string' }, value: {}, op: { type: 'string' } } },
				id: { type: 'string' },
				ids: { type: 'array', items: { type: 'string' } },
				response: { type: 'string' }
			},
			required: ['schema', 'action']
		}
	}
	const overviewMailbox = {
		description: `Show the user's ${label} OVERVIEW card (computed aggregates + the latest entries). Use whenever they ask to SEE the ${skillId.replace(/-/g, ' ')}.`,
		parameters: {
			type: 'object',
			properties: { response: { type: 'string', description: 'A short human-facing reply.' } }
		}
	}
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
		VALUES (gen_random_uuid(), ${skillId}, 'data_crud', 'data_crud', ${JSON.stringify(crudMailbox)}::jsonb, false, 1, now(), now())
		ON CONFLICT DO NOTHING
	`.execute(D)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, code, caps, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (gen_random_uuid(), ${skillId}, ${`${skillId}_overview`}, NULL, ${authored}, ${JSON.stringify(['ops'])}::jsonb, ${JSON.stringify(overviewMailbox)}::jsonb, ${skillId}, false, 2, now(), now())
		ON CONFLICT DO NOTHING
	`.execute(D)
	return { skillId, code: authored }
}

// ── S4: seed + promote ──────────────────────────────────────────────────────────────────────────────
export async function seedData(
	uid: string,
	skeleton: AppSkeleton,
	source: Record<string, unknown>
): Promise<{ seeded: Record<string, number> }> {
	const seeded: Record<string, number> = {}
	for (const entity of skeleton.entities) {
		let n = 0
		for (const row of source[entity.key] as Record<string, unknown>[]) {
			await runNamedOp(uid, `${entity.type}.create`, row)
			n++
		}
		seeded[entity.key] = n
	}
	return { seeded }
}

/** Copy the four vibe rows mock-<app> → <app> (the mock stays); the identity mapper survives. */
export async function promoteVibe(app: string): Promise<{ name: string }> {
	const D = db()
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source']) {
		await sql`
			INSERT INTO ${sql.raw(t)} (name, body)
			SELECT ${app}, body FROM ${sql.raw(t)} WHERE name = ${`${MOCK_PREFIX}${app}`}
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
		`.execute(D)
	}
	return { name: app }
}

/** `ctx.promote` — the stepwise promotion caps (each step stateless, keyed by the mockup name). */
export function promoteCaps(uid: string) {
	// board 0113 — resolution is LLM-SMART, not string-fuzzy (Samuel): the skillify route injects the
	// EXACT mockup names as Tier-3 context, and a miss returns the available names so the model
	// self-corrects. The server matches the exact walled name or the exact label — nothing heuristic.
	const resolveMock = async (rawName: string): Promise<string | null> => {
		const raw = String(rawName ?? '').trim().toLowerCase()
		if (!raw) return null
		const all = await listMockups()
		const hit = all.find((m) => m.name === raw) ?? all.find((m) => m.label === raw)
		return hit?.name ?? null
	}
	const skeletonOf = async (rawName: string) => {
		const name = await resolveMock(rawName)
		if (!name) return null
		const parts = await loadRawParts(name)
		if (!parts) return null
		const app = name.slice(MOCK_PREFIX.length)
		return {
			skeleton: deriveAppSkeleton(app, parts.source as Record<string, unknown>),
			source: parts.source as Record<string, unknown>
		}
	}
	return {
		skeletonOf,
		available: async () => (await listMockups()).map((m) => m.name),
		mintData: (sk: AppSkeleton, src: Record<string, unknown>) => mintDataLayer(uid, sk, src),
		wire: (sk: AppSkeleton, src: Record<string, unknown>) => wireSkill(uid, sk, src),
		seed: (sk: AppSkeleton, src: Record<string, unknown>) => seedData(uid, sk, src),
		promoteVibe,
		loadVibe
	}
}
