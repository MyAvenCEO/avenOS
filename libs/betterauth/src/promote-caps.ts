import type { PredicateDefJSON } from '@avenos/skills/tools'
import type { TypeSpec } from '@avenos/aven-ontology'
import { sql } from 'kysely'
import { runNamedOp } from './actor-run'
import { actorConfig } from './config'
import { runActorCode } from './actor-sandbox'
import { db } from './db'
import { listMockups, loadRawParts, MOCK_PREFIX, mockName, resolveMockup } from './mockup-caps'
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
		signal: AbortSignal.timeout(120_000),
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
		'PLAIN SYNCHRONOUS style: `function handle(msg, caps) { var r = caps.ops("<type>.list", {}); ... }` —',
		'caps.ops() blocks and returns directly; do NOT use async/await/Promise.',
		'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
	].join('\n')
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(120_000),
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
		description: `Read or modify the user's ${label} data (schema "${entity?.type}"): items with ${entity?.fields.join(', ')}. BATCH create/update via items; delete via ids; list with the universal {field,value,op} filter. ${CRUD_STEERING}`,
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
		VALUES (gen_random_uuid(), ${skillId}, ${`${skillId}_overview`}, NULL, ${authored}, ${JSON.stringify(skeleton.entities.length ? skeleton.entities.map((e) => `ops:${e.type}`) : ['ops'])}::jsonb, ${JSON.stringify(overviewMailbox)}::jsonb, ${skillId}, false, 2, now(), now())
		ON CONFLICT DO NOTHING
	`.execute(D)
	// every promoted skill is SELF-IMPROVABLE: it advertises its own improve_skill, so "improve the
	// banking skill: …" works even when the router (correctly) lands on the skill itself.
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
		VALUES (gen_random_uuid(), ${skillId}, 'improve_skill', 'improve_skill', ${JSON.stringify(improveMailboxFor(skillId, label))}::jsonb, false, 3, now(), now())
		ON CONFLICT DO NOTHING
	`.execute(D)
	// the Planner-grade PRESENCE (Samuel 2026-07-04): granular per-step flow nodes + per-verb cards,
	// so the Skills explorer shows Read/Create/Edit/Delete with their own vibes from birth.
	await mintVerbVibes(skeleton)
	await writeSkillFlow(skeleton)
	return { skillId, code: authored }
}

/** Universal update/delete steering for the generic crud mailbox (no domain vocabulary): the server
 *  resolves titles/names to row ids, so the model must never duplicate-on-correct or filter-hunt. */
export const CRUD_STEERING =
	'When the user refers to an EXISTING entry (correcting its amount/date/sign, renaming, marking), use ' +
	'action "update" — the item\u2019s id may be its title/name, the server resolves it. NEVER create a ' +
	'duplicate for a correction. To delete, pass ids directly (titles work) \u2014 do not search with list ' +
	'filters first.'

// ── skill PRESENCE: granular per-step flow nodes + per-verb cards (the Planner pattern) ────────────
// Samuel (2026-07-04): a promoted skill must have the SAME workflow granularity as todos — one flow
// node per step (read/create/edit/delete/overview), each with its OWN vibe card. Like todos, the
// granularity lives in the FLOW row (nodes referencing the one data_crud actor + per-step vibes),
// not in duplicate actor rows. All of it deterministic config — no GLM.

const labelFieldOf = (e: AppSkeleton['entities'][0]): string =>
	e.fields.find((f) => ['name', 'title', 'label'].includes(f)) ?? e.fields[0]

/** Deterministic per-verb card (view/style/logic/source) for an entity: `<type>-created|edited`. */
function verbCardParts(
	entity: AppSkeleton['entities'][0],
	verb: 'created' | 'edited'
): { view: unknown; style: unknown; logic: string; source: unknown } {
	const label = labelFieldOf(entity)
	const meta = entity.fields.filter((f) => f !== label)
	const view = {
		content: {
			class: 'uc-root',
			children: [
				{
					class: 'uc-header',
					children: [
						{ text: verb === 'created' ? 'Neu angelegt' : 'Aktualisiert', class: `uc-eyebrow uc-eyebrow--${verb}` },
						{ text: '$count', class: 'uc-meta' }
					]
				},
				{
					tag: 'ul',
					class: 'uc-list',
					children: [
						{
							$each: {
								items: '$items',
								template: {
									tag: 'li',
									class: 'uc-row',
									children: [
										{ text: '$$title', class: 'uc-title' },
										{ text: '$$meta', class: 'uc-badge' }
									]
								}
							}
						}
					]
				}
			]
		}
	}
	const logic = `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var r=it[i]||{};out.push({title:String(r[${JSON.stringify(label)}]||'—'),meta:[${meta.map((f) => `r[${JSON.stringify(f)}]`).join(',')}].filter(Boolean).join('  ·  ')});}return{count:out.length+' Eintrag/Einträge',items:out};}
function handleEvent(t,p,s){return s}`
	const style = {
		extends: 'brand',
		tokens: { green: '#5f8a63', amber: '#b0803a' },
		selectors: {
			'.uc-root': { display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', fontFamily: 'var(--font-sans)', color: 'var(--text)' },
			'.uc-header': { display: 'flex', alignItems: 'center', gap: '0.5rem' },
			'.uc-eyebrow': { fontSize: 'var(--fs-micro)', fontWeight: '600', letterSpacing: '0.09em', textTransform: 'uppercase' },
			'.uc-eyebrow--created': { color: 'var(--green)' },
			'.uc-eyebrow--edited': { color: 'var(--amber)' },
			'.uc-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
			'.uc-list': { listStyle: 'none', margin: '0', padding: '0' },
			'.uc-row': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.7rem', padding: '0.6rem 0.1rem', borderBottom: '1px solid var(--border-soft)', fontSize: 'var(--fs-body)' },
			'.uc-title': { fontWeight: '600' },
			'.uc-badge': { color: 'var(--muted)', fontSize: 'var(--fs-micro)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-pill)', padding: '0.12rem 0.5rem', whiteSpace: 'nowrap' }
		}
	}
	const source = {
		items: [
			Object.fromEntries(entity.fields.map((f, i) => [f, f === label ? 'Beispiel-Eintrag' : `Wert ${i}`])),
			Object.fromEntries(entity.fields.map((f, i) => [f, f === label ? 'Zweiter Eintrag' : `Wert ${i}`]))
		]
	}
	return { view, style, logic, source }
}

/** Add-only mint of the per-verb cards for every entity; returns the vibe names actually added. */
export async function mintVerbVibes(skeleton: AppSkeleton): Promise<string[]> {
	const D = db()
	const added: string[] = []
	for (const entity of skeleton.entities) {
		for (const verb of ['created', 'edited'] as const) {
			const name = `${entity.type}-${verb}`
			const exists = (await sql`SELECT 1 FROM vibe_view WHERE name = ${name} LIMIT 1`.execute(D)).rows.length > 0
			if (exists) continue
			const parts = verbCardParts(entity, verb)
			await sql`INSERT INTO vibe_view (name, body) VALUES (${name}, ${JSON.stringify(parts.view)}::jsonb) ON CONFLICT (name) DO NOTHING`.execute(D)
			await sql`INSERT INTO vibe_style (name, body) VALUES (${name}, ${JSON.stringify(parts.style)}::jsonb) ON CONFLICT (name) DO NOTHING`.execute(D)
			await sql`INSERT INTO vibe_logic (name, body) VALUES (${name}, ${parts.logic}) ON CONFLICT (name) DO NOTHING`.execute(D)
			await sql`INSERT INTO vibe_source (name, body) VALUES (${name}, ${JSON.stringify(parts.source)}::jsonb) ON CONFLICT (name) DO NOTHING`.execute(D)
			added.push(name)
		}
	}
	return added
}

type FlowNode = Record<string, unknown> & { id: string }
type FlowEdge = { from: string; to: string; kind: string }

/** The granular flow presence of a promoted skill — the todos/Planner node set, deterministic. */
export function skillPresence(skeleton: AppSkeleton): { nodes: FlowNode[]; edges: FlowEdge[] } {
	const app = skeleton.app
	const entity = skeleton.entities[0]
	const type = entity?.type ?? 'entry'
	const nodes: FlowNode[] = [
		{ id: 'dispatch', name: 'Dispatch', actor: 'dispatch', inputs: ['intent'], outputs: ['intent'] },
		{ id: 'overview', name: 'Overview', actor: `${app}_overview`, vibe: app, inputs: ['intent'], outputs: [app], note: 'Sandbox code actor: computed aggregates + latest entries.' },
		{ id: 'read', name: `Read ${type}`, actor: 'data_crud', vibe: app, inputs: ['intent'], outputs: [type], note: 'list — the overview card renders the rows.' },
		{ id: 'create', name: `Create ${type}`, actor: 'data_crud', vibe: `${type}-created`, inputs: ['intent'], outputs: [type], note: 'create — show only the new entries.' },
		{ id: 'edit', name: `Edit ${type}`, actor: 'data_crud', vibe: `${type}-edited`, inputs: ['intent', type], outputs: [type], note: 'update — show the changed entries.' },
		{ id: 'delete', name: `Delete ${type}`, actor: 'data_crud', vibe: app, hitl: true, inputs: ['intent', type], outputs: [type], note: 'delete — confirm before removing.' },
		{ id: 'improve', name: 'Improve', actor: 'improve_skill', inputs: ['intent'], outputs: [app], note: 'Bake user rules into how entries are interpreted.' }
	]
	const edges: FlowEdge[] = nodes
		.filter((n) => n.id !== 'dispatch')
		.map((n) => ({ from: 'dispatch', to: n.id, kind: 'control' }))
	return { nodes, edges }
}

/** ADD-ONLY flow merge (the one write path for flow presence): missing nodes (by id) and missing
 *  edges (by from→to) are appended; existing ones are never rewritten. Returns added node ids. */
export async function mergeFlowPieces(
	flowId: string,
	meta: { name: string; description: string },
	wantNodes: FlowNode[],
	wantEdges: FlowEdge[]
): Promise<string[]> {
	const D = db()
	const existing = await sql<{ nodes: unknown; edges: unknown }>`
		SELECT nodes, edges FROM flow WHERE id = ${flowId}
	`.execute(D)
	const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? [])) as Record<string, unknown>[]
	const nodes = existing.rows.length ? parse(existing.rows[0].nodes) : []
	const edges = (existing.rows.length ? parse(existing.rows[0].edges) : []) as unknown as FlowEdge[]
	const addedIds: string[] = []
	for (const n of wantNodes) {
		if (nodes.some((x) => x.id === n.id)) continue
		nodes.push(n)
		addedIds.push(n.id)
	}
	for (const e of wantEdges) {
		if (edges.some((x) => x.from === e.from && x.to === e.to)) continue
		edges.push(e)
	}
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, created_at, updated_at)
		VALUES (${flowId}, ${meta.name}, ${meta.description},
			${JSON.stringify(nodes)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
		ON CONFLICT (id) DO UPDATE SET nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, updated_at = now()
	`.execute(D)
	return addedIds
}

export async function writeSkillFlow(skeleton: AppSkeleton): Promise<string[]> {
	const want = skillPresence(skeleton)
	const label = skeleton.app.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
	return mergeFlowPieces(
		skeleton.app,
		{
			name: label,
			description: `the ${label} app — one node per workflow step (overview/read/create/edit/delete), each with its own card. Promoted from mock-${skeleton.app}.`
		},
		want.nodes,
		want.edges
	)
}

/** The add-only UPGRADE seam (board 0116 S1 slice): bring an already-promoted skill up to the
 *  current granularity — missing flow nodes + missing per-verb cards are added; nothing rewritten. */
export async function syncActors(
	rawName: string
): Promise<{ app?: string; addedNodes?: string[]; addedVibes?: string[]; error?: string }> {
	let app: string
	try {
		app = mockName(rawName).slice(MOCK_PREFIX.length)
	} catch {
		return { error: 'a skill name is required' }
	}
	const D = db()
	const wired = (await sql`SELECT 1 FROM skill WHERE id = ${app} LIMIT 1`.execute(D)).rows.length > 0
	if (!wired) return { error: `skill "${app}" is not promoted yet` }
	const parts = await loadRawParts(`${MOCK_PREFIX}${app}`)
	if (!parts) return { error: `the mockup mock-${app} (the skill's design source) no longer exists` }
	const skeleton = deriveAppSkeleton(app, parts.source as Record<string, unknown>)
	const addedVibes = await mintVerbVibes(skeleton)
	const addedNodes = await writeSkillFlow(skeleton)
	return { app, addedNodes, addedVibes }
}

// ── board 0117: CROSS-SKILL CONNECTORS — the composite/leaf sub-skill pattern ─────────────────────
// A skill stacks into another skill: the SOURCE skill owns a GLM-authored connector actor (sandbox
// code, caps SCOPED to exactly the two schemas) and its flow gains a COMPOSITE node (flowRef → the
// target skill's flow — the board-0083 recursion seat, unbounded stacking by construction). The
// target is only ever touched through its PUBLIC surface: its named ops — the same delegation shape
// as mint_data → Ontology.

/** The schemas a skill operates on — DETERMINISTIC: quoted names in its own data_crud mailbox
 *  config, validated against the ops registry (a name only counts if `<type>.list` exists). */
export async function typesOfSkill(skillId: string): Promise<string[]> {
	const D = db()
	const r = await sql<{ mailbox: unknown }>`
		SELECT mailbox FROM actor WHERE skill_id = ${skillId} AND name = 'data_crud' LIMIT 1
	`.execute(D)
	if (!r.rows.length) return []
	const mb = (typeof r.rows[0].mailbox === 'string' ? JSON.parse(r.rows[0].mailbox as string) : r.rows[0].mailbox) as {
		parameters?: { properties?: { schema?: { enum?: string[]; description?: string } } }
	}
	const prop = mb?.parameters?.properties?.schema
	const candidates = new Set<string>(prop?.enum ?? [])
	for (const m of String(prop?.description ?? '').matchAll(/"([a-z0-9_-]+)"/g)) candidates.add(m[1])
	const confirmed: string[] = []
	for (const c of candidates) {
		const op = await sql`SELECT 1 FROM data_operations WHERE name = ${`${c}.list`} LIMIT 1`.execute(D)
		if (op.rows.length) confirmed.push(c)
	}
	return confirmed
}

type OpsContract = { type: string; ops: string[]; sample: unknown[]; notes?: string }

/** The skill's own data notes — its crud mailbox description (which carries improve_skill-earned
 *  rules like number formats/sign conventions): exactly what the connector author must respect. */
async function skillNotes(skillId: string): Promise<string> {
	const r = await sql<{ mailbox: unknown }>`
		SELECT mailbox FROM actor WHERE skill_id = ${skillId} AND name = 'data_crud' LIMIT 1
	`.execute(db())
	if (!r.rows.length) return ''
	const mb = (typeof r.rows[0].mailbox === 'string' ? JSON.parse(r.rows[0].mailbox as string) : r.rows[0].mailbox) as {
		description?: string
	}
	return String(mb?.description ?? '')
}

async function opsContract(uid: string, type: string): Promise<OpsContract> {
	const D = db()
	const r = await sql<{ name: string }>`
		SELECT name FROM data_operations WHERE name LIKE ${`${type}.%`} ORDER BY name
	`.execute(D)
	let sample: unknown[] = []
	try {
		const res = (await runNamedOp(uid, `${type}.list`, {})) as { rows?: unknown[] }
		sample = (res?.rows ?? []).slice(0, 2)
	} catch {
		sample = []
	}
	return { type, ops: r.rows.map((x) => x.name), sample }
}

/** Connector-author instructions — runtime SSOT = the connect_skills actor row's prompt (0115
 *  pattern); this is the fallback. */
export const CONNECT_INSTRUCTIONS = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  async function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws.',
	'',
	'OP SIGNATURES (exact — get these wrong and the smoke gate rejects the code):',
	'- caps.ops("<type>.list", {})                 → { rows: [ { id, ...fields } ] }  — ALWAYS .rows, never .items',
	'- caps.ops("<type>.create", { field: value }) → ONE row per call (loop for batches); returns { ids }',
	'- caps.ops("<type>.update", { id, field: value }) → one row per call',
	'- caps.ops("<type>.delete", { id })',
	'',
	'HOW YOU ARE CALLED (the trigger contract — handle ALL three):',
	'- msg = { trigger: { schema: "<sourceSchema>" } } — a row of that schema was just written: reconcile',
	'  the OTHER side per the USER RULE (e.g. a new purchase transaction ⇒ raise the matching stock).',
	'- msg = { trigger: { schema: "<targetSchema>" } } — the other direction changed: reconcile BACK if',
	'  the rule is meaningful in reverse (e.g. manually raised stock ⇒ record a purchase transaction);',
	'  if the reverse direction makes no sense, do nothing and say so in the summary.',
	'- msg = {} (no trigger) — a MANUAL full sync: reconcile everything, both directions where sensible.',
	'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
	'Idempotence matters: running the connector twice must not double-apply (match by name/label before',
	'creating; prefer update over create when a matching target row exists).',
	'PLAIN SYNCHRONOUS style ONLY: `function handle(msg, caps) { var r = caps.ops("x.list", {}); ... }` —',
	'caps.ops() BLOCKS and returns the result directly. NEVER use async, await, Promise, .then, or',
	'callbacks — any of those and the sandbox rejects the code.',
	'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
].join('\n')

async function glmConnectorCode(
	sourceContracts: OpsContract[],
	targetContracts: OpsContract[],
	rule: string,
	repair?: { code: string; error: string },
	onToken?: (text: string) => void
): Promise<string | { error: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const cfg = await actorConfig('connect_skills').catch(() => null)
	const instructions = cfg?.prompt?.trim() || CONNECT_INSTRUCTIONS
	const contractText = (label: string, cs: OpsContract[]) =>
		`${label}:\n${cs.map((c) => `  schema "${c.type}" — ops: ${c.ops.join(', ')}\n  sample rows: ${JSON.stringify(c.sample).slice(0, 600)}${c.notes ? `\n  data rules: ${c.notes.slice(0, 400)}` : ''}`).join('\n')}`
	// STREAMING transport (the 0115 lesson twice over): a whole-connector authoring round exceeds any
	// sane flat timeout (the flat 120s cap KILLED the first live connect) — so stream with an idle
	// abort (45s without bytes) + a generous total cap instead.
	const text = await glmStreamText(
		key,
		[
			{
				role: 'system',
				content: `${instructions}\n\n${contractText('SOURCE', sourceContracts)}\n${contractText('TARGET', targetContracts)}`
			},
			{ role: 'user', content: `USER RULE: ${rule}` },
			...(repair
				? [
						{ role: 'assistant', content: repair.code },
						{
							role: 'user',
							content: `The sandbox smoke run REJECTED that code: ${repair.error}. Fix it MINIMALLY (remember: PLAIN SYNCHRONOUS style — caps.ops() returns directly, no async/await/Promise; return { summary }). Output ONLY the corrected code.`
						}
					]
				: [])
		],
		{ idleMs: 45_000, totalMs: 300_000, onToken }
	)
	if (typeof text !== 'string') return text
	const code = text.replace(/```(?:js|javascript)?/gi, '').trim()
	return code || { error: 'GLM returned no connector code' }
}

/** Streamed GLM completion with idle + total aborts — accumulate the full text; a stall is an honest
 *  error, never a wedged call. */
async function glmStreamText(
	key: string,
	messages: { role: string; content: string }[],
	o: { idleMs: number; totalMs: number; onToken?: (text: string) => void }
): Promise<string | { error: string }> {
	const ctrl = new AbortController()
	let idleTimer = setTimeout(() => ctrl.abort(), o.idleMs)
	const totalTimer = setTimeout(() => ctrl.abort(), o.totalMs)
	const bump = () => {
		clearTimeout(idleTimer)
		idleTimer = setTimeout(() => ctrl.abort(), o.idleMs)
	}
	const clearTimers = () => {
		clearTimeout(idleTimer)
		clearTimeout(totalTimer)
	}
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		signal: ctrl.signal,
		body: JSON.stringify({ model: GLM_MODEL, messages, stream: true })
	}).catch((e) => {
		console.error('[connect] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok || !res.body) {
		clearTimers()
		return { error: `GLM error ${res?.status ?? '(no response)'}` }
	}
	let full = ''
	const reader = res.body.getReader()
	const dec = new TextDecoder()
	let buf = ''
	for (;;) {
		let step: { done: boolean; value?: Uint8Array }
		try {
			step = await reader.read()
		} catch {
			clearTimers()
			return { error: `GLM stream stalled (no data for ${o.idleMs / 1000}s) — try again` }
		}
		bump()
		if (step.done) break
		buf += dec.decode(step.value, { stream: true })
		const lines = buf.split('\n')
		buf = lines.pop() ?? ''
		for (const line of lines) {
			const t = line.trim()
			if (!t.startsWith('data:')) continue
			const payload = t.slice(5).trim()
			if (payload === '[DONE]') continue
			try {
				const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
				const piece = j.choices?.[0]?.delta?.content ?? ''
				if (piece) {
					full += piece
					o.onToken?.(piece)
				}
			} catch {
				/* partial frame */
			}
		}
	}
	clearTimers()
	return full
}

/** Connector SMOKE gate: run against stub ops for BOTH schemas; must return { summary: string }. */
export async function smokeRunConnector(
	code: string,
	contracts: OpsContract[]
): Promise<{ ok: boolean; error?: string }> {
	// STATIC gate first (deterministic): the sandbox supports host calls ONLY during the main eval,
	// so connector code must be plain synchronous — async/await/Promise are rejected by name.
	if (/\basync\b|\bawait\b|\bPromise\b|\.then\s*\(/.test(code))
		return {
			ok: false,
			error:
				'use PLAIN SYNCHRONOUS style — caps.ops() returns the result directly; async/await/Promise/.then are not supported in the sandbox'
		}
	const byType = new Map(contracts.map((c) => [c.type, c]))
	let listCalls = 0
	const stubOps = async (name: unknown, params: unknown) => {
		const n = String(name)
		const type = n.split('.')[0]
		if (!byType.has(type)) throw new Error(`op "${n}" not granted — this actor's scopes: ${[...byType.keys()].map((t) => `ops:${t}`).join(', ')}`)
		if (n.endsWith('.list')) {
			listCalls++
			const c = byType.get(type)
			return { rows: (c?.sample ?? []).map((r, i) => ({ id: `s${i}`, ...(r as object) })) }
		}
		// STRICT mutation signatures (the live "0 erstellt" bug: batch {items} silently no-ops in the
		// engine): create/update take ONE row of named fields per call — validate against the sample.
		const c = byType.get(type)
		const fieldKeys = new Set(Object.keys((c?.sample?.[0] as object | undefined) ?? {}))
		const arg = (params ?? {}) as Record<string, unknown>
		if ('items' in arg || 'rows' in arg)
			throw new Error(`${n} takes ONE row object per call ({ field: value, … }) — loop for batches, never { items: [...] }`)
		if (fieldKeys.size && !Object.keys(arg).some((k) => fieldKeys.has(k) || k === 'id'))
			throw new Error(`${n} got no known fields — pass a single row object like ${JSON.stringify(c?.sample?.[0] ?? {})}`)
		return { ok: true, ids: ['stub'] }
	}
	// all THREE call paths must settle and return a summary: manual sync + a trigger from EITHER side
	// (the trigger seam is bi-directional by construction — caps subscribe both schemas).
	const msgs: unknown[] = [{}, ...contracts.map((c) => ({ trigger: { schema: c.type } }))]
	listCalls = 0
	for (const msg of msgs) {
		try {
			const state = (await runActorCode(code, msg, { ops: stubOps }, {})) as Record<string, unknown>
			if (!state || typeof state !== 'object')
				return { ok: false, error: `did not return a state object for msg ${JSON.stringify(msg)}` }
			if (typeof state.summary !== 'string' || !state.summary.trim())
				return { ok: false, error: `state misses the "summary" string for msg ${JSON.stringify(msg)}` }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}
	// a connector that never LISTED anything cannot have reconciled data — the live "0 erstellt" bug
	// shape (res.items on a { rows } result → empty loops → plausible summary). Fail it here.
	if (listCalls === 0)
		return { ok: false, error: 'the connector never read any data — use caps.ops("<type>.list", {}) and read result.rows' }
	return { ok: true }
}

/** Wire a connector: source skill OWNS the actor (scoped caps) + its flow gains the sub-skill
 *  COMPOSITE node (flowRef → target). Re-connecting refreshes the code (smoke-gated upsert). */
export async function connectSkills(
	uid: string,
	sourceRaw: string,
	targetRaw: string,
	rule: string,
	codeSeam?: string,
	onToken?: (text: string) => void
): Promise<{ tool?: string; source?: string; target?: string; error?: string }> {
	const slug = (raw: string): string | null => {
		try {
			return mockName(raw).slice(MOCK_PREFIX.length)
		} catch {
			return null
		}
	}
	const source = slug(sourceRaw)
	const target = slug(targetRaw)
	if (!source || !target) return { error: 'source and target skill names are required' }
	if (source === target) return { error: 'source and target must be different skills' }
	const D = db()
	const skills = await sql<{ id: string; label: string | null }>`SELECT id, label FROM skill`.execute(D)
	const byId = new Map(skills.rows.map((r) => [r.id, r.label ?? r.id]))
	for (const id of [source, target])
		if (!byId.has(id))
			return { error: `no skill "${id}". Existing skills: ${[...byId.keys()].join(', ')}` }
	const srcTypes = await typesOfSkill(source)
	const tgtTypes = await typesOfSkill(target)
	if (!srcTypes.length) return { error: `skill "${source}" exposes no data schemas (no data_crud config)` }
	if (!tgtTypes.length) return { error: `skill "${target}" exposes no data schemas (no data_crud config)` }
	const srcNotes = await skillNotes(source)
	const tgtNotes = await skillNotes(target)
	const srcContracts = await Promise.all(
		srcTypes.map(async (t) => ({ ...(await opsContract(uid, t)), notes: srcNotes }))
	)
	const tgtContracts = await Promise.all(
		tgtTypes.map(async (t) => ({ ...(await opsContract(uid, t)), notes: tgtNotes }))
	)
	let authored = codeSeam ?? (await glmConnectorCode(srcContracts, tgtContracts, rule, undefined, onToken))
	if (typeof authored !== 'string') return { error: authored.error }
	let smoke = await smokeRunConnector(authored, [...srcContracts, ...tgtContracts])
	if (!smoke.ok && !codeSeam) {
		// ONE automatic repair round: an authoring round is expensive (~2–3 min) and smoke failures are
		// usually mechanical (parallel awaits, missing summary) — feed the error back before giving up.
		console.error('[connect] smoke failed, repairing:', smoke.error)
		onToken?.('\n\n— Korrekturrunde (Smoke-Test abgelehnt) —\n')
		const repaired = await glmConnectorCode(
			srcContracts,
			tgtContracts,
			rule,
			{ code: authored, error: smoke.error ?? 'unknown' },
			onToken
		)
		if (typeof repaired === 'string') {
			authored = repaired
			smoke = await smokeRunConnector(authored, [...srcContracts, ...tgtContracts])
		}
	}
	if (!smoke.ok) return { error: `smoke run failed: ${smoke.error}` }

	const toolName = `sync_${target.replace(/-/g, '_')}`
	const caps = [...srcTypes, ...tgtTypes].map((t) => `ops:${t}`)
	const mailbox = {
		description:
			`SYNC/reconcile the ${byId.get(target)} from this skill's data (rule: ${rule.slice(0, 160)}). ` +
			'Run when the user asks to sync, or offer it after recording relevant entries.',
		parameters: {
			type: 'object',
			properties: { response: { type: 'string', description: 'A short human-facing reply to show the user.' } }
		}
	}
	// the connector is advertised on BOTH endpoints (Samuel's live "sync inventory" routed to the
	// TARGET skill — humans name the target): same tool, same code, same scoped caps on each side,
	// only the description flips perspective. Whichever way the router lands, the tool is there.
	const mirrorMailbox = {
		...mailbox,
		description:
			`SYNC/reconcile this skill's data FROM the ${byId.get(source)} entries (rule: ${rule.slice(0, 160)}). ` +
			'Run when the user asks to sync/abgleichen.'
	}
	for (const [skillId, mb] of [
		[source, mailbox],
		[target, mirrorMailbox]
	] as const) {
		const existing = await sql<{ id: string }>`
			SELECT id FROM actor WHERE skill_id = ${skillId} AND name = ${toolName} LIMIT 1
		`.execute(D)
		if (existing.rows.length) {
			await sql`
				UPDATE actor SET code = ${authored}, caps = ${JSON.stringify(caps)}::jsonb,
					mailbox = ${JSON.stringify(mb)}::jsonb, updated_at = now()
				WHERE id = ${existing.rows[0].id}
			`.execute(D)
		} else {
			await sql`
				INSERT INTO actor (id, skill_id, name, engine, code, caps, mailbox, hitl, position, created_at, updated_at)
				VALUES (gen_random_uuid(), ${skillId}, ${toolName}, NULL, ${authored}, ${JSON.stringify(caps)}::jsonb, ${JSON.stringify(mb)}::jsonb, false, 5, now(), now())
			`.execute(D)
		}
	}
	// the COMPOSITE sub-skill node: source flow → connector leaf → flowRef(target). Add-only.
	await mergeFlowPieces(
		source,
		{
			name: String(byId.get(source)),
			description: `the ${byId.get(source)} app — granular steps + cross-skill connectors.`
		},
		[
			{ id: toolName, name: `Sync ${byId.get(target)}`, actor: toolName, inputs: srcTypes, outputs: tgtTypes, note: `Connector (scoped caps: ${caps.join(', ')}): ${rule.slice(0, 120)}` },
			{ id: `sub-${target}`, name: String(byId.get(target)), flowRef: target, inputs: tgtTypes, outputs: tgtTypes, note: 'Sub-skill (composite): delegated through its public ops.' }
		],
		[
			{ from: 'dispatch', to: toolName, kind: 'control' },
			{ from: 'create', to: toolName, kind: 'data' },
			{ from: toolName, to: `sub-${target}`, kind: 'data' }
		]
	)
	return { tool: toolName, source, target }
}

/** The per-promoted-skill improve_skill mailbox (name pinned to THIS skill, like crud pins schema). */
export function improveMailboxFor(skillId: string, label: string): Record<string, unknown> {
	return {
		description:
			`IMPROVE the ${label} skill itself: bake a user rule into how entries are interpreted — number ` +
			'formats ("German 25,33 €"), sign conventions ("bought/purchase = negative"), defaults, wording. ' +
			'Use when the user asks to improve/change/teach THIS skill (not for adding data).',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: `Always "${skillId}" on this skill.` },
				instruction: { type: 'string', description: "The rule to bake in, in the user's words." },
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['name', 'instruction']
		}
	}
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

// ── IMPROVE a promoted skill — the post-live loop ──────────────────────────────────────────────────
/** GLM rewrites the data_crud mailbox WORDING to bake a user rule into the skill's behavior (e.g.
 *  "German number format, purchases are negative"). Fail-closed graft: only the description texts
 *  move — the parameter schema shape (keys, enums, required) is NEVER GLM-writable. */
type MailboxDef = {
	description?: string
	parameters?: { properties?: Record<string, { description?: string }> }
}
type ImproveOut = { description: string; properties?: Record<string, string> }

/** The improver's instructions — runtime SSOT is the improve_skill actor row's `prompt` column
 *  (0115 pattern); this constant is the fallback. The ENGINE FACTS section is the key: GLM can only
 *  weave real capabilities into a skill's wording if it KNOWS them (the live "fix editing" rewrite
 *  couldn't teach title-as-id because GLM had no way to know the server resolves titles). */
export const IMPROVE_INSTRUCTIONS = [
	'You maintain the TOOL INSTRUCTIONS of a data-entry assistant. Given the current tool config and a',
	'USER RULE, rewrite the wording so the assistant follows the rule from now on. Keep everything that',
	'still applies; fold the rule in explicitly (formats, sign conventions, defaults). Output ONLY JSON:',
	'  { "description": "<the improved tool description>",',
	'    "properties": { "<param>": "<improved param description>" } }   // only params that changed',
	'You may ONLY change wording — never invent parameters, types, or enums.',
	'',
	'ENGINE FACTS (real server capabilities — weave the relevant ones into the wording so the assistant',
	'actually uses them; never contradict them):',
	'- actions: list · create · update · delete (batch writes via items[]; delete via ids[]).',
	'- update/delete resolve the entry TITLE/NAME as the id server-side — a correction to an existing',
	'  entry must be an UPDATE (id = the title works); creating a duplicate is always wrong.',
	'- delete is HITL-confirmed by the app; pass ids directly, never filter-hunt with list first.',
	'- list supports ONE {field, value, op} filter over the projected fields.'
].join('\n')

async function glmImproveMailbox(
	mailbox: MailboxDef,
	instruction: string
): Promise<ImproveOut | { error: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	// instructions are CONFIG (the improve_skill actor row's prompt column); the constant is the fallback.
	const cfg = await actorConfig('improve_skill').catch(() => null)
	const system = cfg?.prompt?.trim() || IMPROVE_INSTRUCTIONS
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(120_000),
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{
					role: 'user',
					content: `CURRENT CONFIG: ${JSON.stringify(mailbox)}\n\nUSER RULE: ${instruction}`
				}
			],
			stream: false
		})
	}).catch(() => null)
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
	const raw = (data?.choices?.[0]?.message?.content ?? '').replace(/```(?:json)?/gi, '').trim()
	try {
		const out = JSON.parse(raw) as ImproveOut
		if (typeof out.description !== 'string') return { error: 'GLM output misses description' }
		return out
	} catch {
		console.error('[improve] unparseable GLM output:', raw.slice(0, 400))
		return { error: 'GLM returned no parseable config' }
	}
}

/** Bake a user rule into a PROMOTED skill's data_crud instructions (config-as-data: the actor row's
 *  mailbox). The seam param lets tests fix the GLM output. */
export async function improveSkill(
	rawName: string,
	instruction: string,
	seam?: (mailbox: MailboxDef, instruction: string) => Promise<ImproveOut | { error: string }>
): Promise<{ app?: string; description?: string; error?: string }> {
	let app: string
	try {
		app = mockName(rawName).slice(MOCK_PREFIX.length) // same canonicalizer as everywhere
	} catch {
		return { error: 'a skill name is required' }
	}
	const D = db()
	const row = await sql<{ id: string; mailbox: unknown }>`
		SELECT id, mailbox FROM actor WHERE skill_id = ${app} AND name = 'data_crud' LIMIT 1
	`.execute(D)
	if (!row.rows.length) return { error: `skill "${app}" is not promoted yet (no data_crud actor)` }
	const mailbox = (
		typeof row.rows[0].mailbox === 'string' ? JSON.parse(row.rows[0].mailbox as string) : row.rows[0].mailbox
	) as MailboxDef & { parameters?: { properties?: Record<string, Record<string, unknown>> } }
	const out = await (seam ?? glmImproveMailbox)(mailbox, instruction)
	if ('error' in out) return { error: out.error }
	// fail-closed graft: wording only, bounded; schema shape untouched.
	const desc = String(out.description ?? '').trim()
	if (desc.length < 20 || desc.length > 2000) return { error: 'improved description out of bounds' }
	mailbox.description = desc
	const props = mailbox.parameters?.properties ?? {}
	for (const [k, v] of Object.entries(out.properties ?? {})) {
		if (props[k] && typeof v === 'string' && v.trim() && v.length <= 500) props[k].description = v.trim()
	}
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(mailbox)}::jsonb, updated_at = now()
		WHERE id = ${row.rows[0].id}
	`.execute(D)
	return { app, description: desc }
}

// ── promotion PROGRESS — derived from the DB, never stored ─────────────────────────────────────────
/** Where a promotion actually stands, read off the FACTS each stage leaves behind (no state table,
 *  nothing to drift): the derived list op ⇒ Daten · the skill row ⇒ Aktoren · real rows ⇒ Seed ·
 *  the un-walled vibe row ⇒ Live. This is the pipeline's memory across turns and derails. */
export type PromotionProgress = {
	step: 'plan' | 'data' | 'wired' | 'seeded' | 'live'
	data: boolean
	wired: boolean
	seeded: boolean
	live: boolean
	/** The step tool the model should call next (null when live). Seed stays skippable. */
	next: 'mint_data' | 'wire_actors' | 'seed_data' | 'promote' | null
}

export async function promotionProgress(uid: string, skeleton: AppSkeleton): Promise<PromotionProgress> {
	const D = db()
	const type = skeleton.entities[0]?.type
	const data = type
		? (await sql`SELECT 1 FROM data_operations WHERE name = ${`${type}.list`} LIMIT 1`.execute(D)).rows.length > 0
		: false
	const wired =
		(await sql`SELECT 1 FROM skill WHERE id = ${skeleton.app} LIMIT 1`.execute(D)).rows.length > 0
	let seeded = false
	if (data && type) {
		try {
			const res = (await runNamedOp(uid, `${type}.list`, {})) as { rows?: unknown[] } | unknown[]
			const rows = Array.isArray(res) ? res : (res?.rows ?? [])
			seeded = Array.isArray(rows) && rows.length > 0
		} catch {
			seeded = false
		}
	}
	const live =
		(await sql`SELECT 1 FROM vibe_view WHERE name = ${skeleton.app} LIMIT 1`.execute(D)).rows.length > 0
	const step = live ? 'live' : seeded && wired ? 'seeded' : wired ? 'wired' : data ? 'data' : 'plan'
	const next = live ? null : wired ? (seeded ? 'promote' : 'seed_data') : data ? 'wire_actors' : 'mint_data'
	return { step, data, wired, seeded, live, next }
}

const PROGRESS_LABEL: Record<string, string> = {
	plan: 'noch nichts gebaut — nächster Schritt: plan_app dann mint_data',
	data: 'Daten ✓ — nächster Schritt: wire_actors',
	wired: 'Daten ✓ · Aktoren ✓ — nächster Schritt: seed_data (überspringbar) oder promote',
	seeded: 'Daten ✓ · Aktoren ✓ · Seed ✓ — nächster Schritt: promote (go live)',
	live: 'LIVE ✓ — fertig promotet'
}

/** One line per mockup for the skillify Tier-3 hint: exact name + true promotion status, so the
 *  model always knows where each promotion stands ("go live" after a derail resumes correctly). */
export async function promotionStatusLines(uid: string): Promise<string[]> {
	const lines: string[] = []
	for (const m of await listMockups()) {
		const parts = await loadRawParts(m.name)
		if (!parts) continue
		const skeleton = deriveAppSkeleton(m.name.slice(MOCK_PREFIX.length), parts.source as Record<string, unknown>)
		const p = await promotionProgress(uid, skeleton)
		lines.push(`${m.name} ("${m.label}") — ${PROGRESS_LABEL[p.step]}`)
	}
	return lines
}

/** `ctx.promote` — the stepwise promotion caps (each step stateless, keyed by the mockup name). */
export function promoteCaps(uid: string, onToken?: (text: string) => void) {
	// board 0113 — resolution is LLM-SMART, not string-fuzzy (Samuel): the skillify route injects the
	// EXACT mockup names as Tier-3 context; the server canonicalizes through the shared resolveMockup
	// (the save-time mockName rule) and a miss returns the available names so the model self-corrects.
	const skeletonOf = async (rawName: string) => {
		const name = await resolveMockup(rawName)
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
		progress: (sk: AppSkeleton) => promotionProgress(uid, sk),
		mintData: (sk: AppSkeleton, src: Record<string, unknown>) => mintDataLayer(uid, sk, src),
		wire: (sk: AppSkeleton, src: Record<string, unknown>) => wireSkill(uid, sk, src),
		seed: (sk: AppSkeleton, src: Record<string, unknown>) => seedData(uid, sk, src),
		improve: (name: string, instruction: string) => improveSkill(name, instruction),
		syncActors,
		connect: (source: string, target: string, rule: string) =>
			connectSkills(uid, source, target, rule, undefined, onToken),
		promoteVibe,
		loadVibe
	}
}
