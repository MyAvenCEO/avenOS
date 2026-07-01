import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { CREATE_INSTRUCTIONS, type PredicateDefJSON } from '@avenos/skills/tools'
import Ajv from 'ajv'
import { sql } from 'kysely'
import { db } from './db'
import { publish } from './events'

// board 0100 — the ONTOLOGY actor's server capabilities: read the data_schema predicate registry, MINT a
// new x1–x5 predicate via GLM-5.2 (grounded in the full gismu dictionary), and persist it (compile → AJV
// self-validate → data_schema). The deterministic core (dedup, full-place rule) lives in @avenos/skills/tools;
// this is the server adapter that injects `ctx.ontology`.

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const GLM_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}
function jsonb(value: unknown) {
	return sql`${JSON.stringify(value)}::jsonb`
}

// The full gismu dictionary (~1 MB, 1300+ roots) — read once, cached. Repo path from this file:
// libs/betterauth/src/ontology.ts → ../../../.claude/skills/ontology/gismu.json.
let gismuCache: string | null = null
async function gismuText(): Promise<string> {
	if (gismuCache !== null) return gismuCache
	const here = path.dirname(fileURLToPath(import.meta.url))
	const p = path.resolve(here, '../../../.claude/skills/ontology/gismu.json')
	gismuCache = await fs.readFile(p, 'utf8').catch(() => '')
	return gismuCache
}

/** A predicate schema is any data_schema row whose JSON-Schema carries a `predicate` discriminator. */
async function listPredicates(uid: string): Promise<{ name: string; gloss?: string }[]> {
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	const out: { name: string; gloss?: string }[] = []
	for (const r of rows) {
		const s = asJson(r.json_schema) as { properties?: Record<string, unknown>; description?: string } | null
		if (s?.properties?.predicate) out.push({ name: r.name, gloss: s.description })
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Strip markdown fences + grab the first [...] JSON array from an LLM reply (tolerating a lone object). */
function parseJsonArray(text: string): unknown[] | null {
	const cleaned = text.replace(/```(?:json)?/gi, '').trim()
	const s = cleaned.indexOf('[')
	const e = cleaned.lastIndexOf(']')
	if (s >= 0 && e > s) {
		try {
			return JSON.parse(cleaned.slice(s, e + 1)) as unknown[]
		} catch {
			/* fall through to single-object */
		}
	}
	const os = cleaned.indexOf('{')
	const oe = cleaned.lastIndexOf('}')
	if (os >= 0 && oe > os) {
		try {
			return [JSON.parse(cleaned.slice(os, oe + 1))]
		} catch {
			return null
		}
	}
	return null
}

/** GLM-5.2 defines the relationship(s) — a BATCH, one entry per relation, each reuse-or-mint. */
async function mint(
	request: string,
	existing: { name: string; gloss?: string }[]
): Promise<{ results?: { reuse?: string; def?: PredicateDefJSON }[]; error?: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const gismu = await gismuText()
	const system = [
		CREATE_INSTRUCTIONS,
		'',
		'EXISTING PREDICATES (reuse one of these names if it already fits):',
		existing.map((e) => `- ${e.name}${e.gloss ? ` — ${e.gloss}` : ''}`).join('\n') || '(none yet)',
		'',
		'OUTPUT — return ONLY a JSON ARRAY, no prose. ONE entry PER relationship the user described',
		'(e.g. "eating and drinking" → TWO entries). Each entry is either a reuse or a new predicate:',
		'  {"reuse":"<existing predicate name>"}',
		'  {"predicate":"<english_snake_case>","gismu":"<lojban root>","gloss":"x1 … x2 …",',
		'   "places":[{"pos":"x1","role":"…","gloss":"…","kind":"ref"|"value","type":"string|number|integer|boolean|date-time","references":"*","required":true|false}, …]}',
		'Include EVERY place the chosen gismu defines. `kind:"ref"` for entity/id places (omit `type`), `kind:"value"` for literals (set `type`).',
		'',
		'THE GISMU DICTIONARY (place structures to reuse):',
		gismu.slice(0, 900_000)
	].join('\n')

	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: `Define the relationship(s): ${request}` }
			],
			stream: false
		})
	}).catch((e) => {
		console.error('[ontology] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[]
	} | null
	const arr = parseJsonArray(data?.choices?.[0]?.message?.content ?? '')
	if (!arr) return { error: 'GLM did not return a parseable predicate list' }
	const results: { reuse?: string; def?: PredicateDefJSON }[] = []
	for (const raw of arr) {
		const o = raw as Record<string, unknown>
		if (typeof o?.reuse === 'string' && o.reuse) results.push({ reuse: o.reuse })
		else if (typeof o?.predicate === 'string' && Array.isArray(o.places))
			results.push({ def: o as unknown as PredicateDefJSON })
	}
	return results.length ? { results } : { error: 'GLM output had no usable predicates' }
}

/** compilePredicate → AJV self-validate the produced schema → persist to data_schema (idempotent by name). */
async function save(uid: string, def: PredicateDefJSON): Promise<{ name: string; places: number }> {
	const schema = compilePredicate(def as unknown as PredicateDef)
	// self-validate: the produced schema must be a compilable AJV schema (x1–x5 self-validating). board 0100.
	new Ajv({ allErrors: true, strict: false }).compile(schema)
	const name = def.predicate
	const existing = await db()
		.selectFrom('data_schema')
		.select('id')
		.where('user_id', '=', uid)
		.where('name', '=', name)
		.executeTakeFirst()
	if (existing) {
		await db()
			.updateTable('data_schema')
			.set({ json_schema: jsonb(schema), updated_at: new Date() })
			.where('id', '=', existing.id)
			.execute()
	} else {
		await db()
			.insertInto('data_schema')
			.values({
				id: randomUUID(),
				user_id: uid,
				name,
				json_schema: jsonb(schema),
				created_at: new Date(),
				updated_at: new Date()
			})
			.execute()
	}
	publish(uid, { entity: 'data' })
	return { name, places: def.places.length }
}

/** The `ctx.ontology` capability bundle the chat loop injects when dispatching the `ontology` tool. */
export function ontologyCaps(uid: string) {
	return {
		list: () => listPredicates(uid),
		mint,
		save: (def: PredicateDefJSON) => save(uid, def)
	}
}
