import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { actorConfig } from './config'
import { registerContextProvider } from './context'
import { db } from './db'
import {
	type MutationSpec,
	mutationIsDestructive,
	type QuerySpec,
	runMutation,
	runQuery,
	validateMutationSpec,
	validateQuerySpec
} from './queries'

// board 0101 — the GLM authoring layer over the deterministic query/mutation engine (queries.ts). GLM-5.2
// writes a VALIDATED spec (never raw SQL), grounded in the user's live predicate place-structures + the spec
// meta-language. A query authors → validates → persists → RUNS (read-only, safe). A mutation authors →
// validates → persists → is HITL-gated when destructive, then applies. This is the non-deterministic
// human-acceptance slice; the engine underneath is proven by queries.test.ts.

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const GLM_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}
function jsonb(value: unknown) {
	return sql`${JSON.stringify(value)}::jsonb`
}

// ── grounding: the user's live predicates WITH their x1–x5 place structure ────────────────────────
type PredPlace = { pos: string; role?: string; gloss?: string; kind: 'ref' | 'value' }
type PredInfo = { name: string; gloss?: string; places: PredPlace[] }

/** Every predicate the user has, with each place's pos/role/kind — so GLM knows x1=owner, x2=company etc. */
async function listPredicatesDetailed(uid: string): Promise<PredInfo[]> {
	const rows = await db()
		.selectFrom('data_schema')
		.select(['name', 'json_schema'])
		.where('user_id', '=', uid)
		.execute()
	const out: PredInfo[] = []
	for (const r of rows) {
		const s = asJson(r.json_schema) as {
			properties?: Record<string, { title?: string; description?: string; 'x-ref'?: unknown }>
			description?: string
		} | null
		if (!s?.properties?.predicate) continue
		const places: PredPlace[] = []
		for (const pos of ['x1', 'x2', 'x3', 'x4', 'x5']) {
			const p = s.properties[pos]
			if (!p) continue
			places.push({
				pos,
				role: p.title,
				gloss: p.description,
				kind: 'x-ref' in p ? 'ref' : 'value'
			})
		}
		out.push({ name: r.name, gloss: s.description, places })
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

function predicatesBlock(preds: PredInfo[]): string {
	if (!preds.length)
		return '(the user has no predicates yet — they must mint one with the ontology tool first)'
	return preds
		.map((p) => {
			const places = p.places.map((pl) => `${pl.pos}=${pl.role ?? '?'}(${pl.kind})`).join(' ')
			return `- ${p.name}${p.gloss ? ` — ${p.gloss}` : ''}\n    places: ${places}`
		})
		.join('\n')
}

// ── the spec meta-languages, described for GLM (it emits JSON matching the AJV meta-schema) ────────
export const QUERY_INSTRUCTIONS = [
	'You author a QUERY SPEC — a small JSON object the engine compiles to ONE safe, parameterized SQL over the',
	'x1–x5 predication store. You NEVER write SQL. Output ONLY the JSON object, no prose, no code fence.',
	'',
	'A query spec:',
	'  { "from": "<predicate>",              // the base predicate to scan (required)',
	'    "where": [ {"place":"x1|..|x5|id","op":"eq|neq|gt|gte|lt|lte|in|isnull|notnull","value":<literal>,"join":N} ],',
	'    "join":  [ {"predicate":"<other>","kind":"inner|left","on":{"place":"x1..x5","base":"x1..x5|id"|{"join":N,"place":"x1..x5|id"}}} ],',
	'    "group_by": "x1..x5",               // with count, to aggregate per key',
	'    "count":  {"having":{"op":"gt|gte|..","value":<number>}},  // filter groups by their count',
	'    "project": ["x1", {"place":"x2","as":"title"}, {"join":N,"exists":true,"as":"done"}] }',
	'',
	'FILTERS. A `where` entry filters the base predicate, OR — with "join":N — the N-th join (0-based). The two',
	'EXISTENCE ops take NO value: "notnull" = the (LEFT-joined) satellite row is PRESENT, "isnull" = ABSENT. A',
	'boolean satellite predicate (a row exists ⇔ true, e.g. `done`) is filtered as notnull/isnull on its join.',
	'',
	'JOINS. Correlate a satellite on the base ROW ID with "base":"id" (e.g. done.x1 = the task row id). Use',
	'"kind":"left" so base rows survive when the satellite is absent — REQUIRED for isnull, and to keep',
	'not-yet-satisfied rows (open todos) visible. An inner join drops base rows lacking the satellite.',
	'',
	'CHAINS (graph depth). "base" may instead reference an EARLIER join: {"join":N,"place":"id|x1..x5"} —',
	'so a query walks referent chains to any depth (item → quantity(x1=item id) → unit(x1=QUANTITY row id):',
	'join 1 uses "base":{"join":0,"place":"id"}). N must be a STRICTLY EARLIER join index — never forward/self.',
	'',
	"Pick places from each predicate's declared place structure below. Examples over task(x2=title) with",
	'satellites done(x1=task id) and due(x1=date, x2=task id):',
	'  done todos  → {"from":"task","join":[{"predicate":"done","kind":"left","on":{"place":"x1","base":"id"}}],"where":[{"join":0,"place":"id","op":"notnull"}],"project":["id",{"place":"x2","as":"title"}]}',
	'  open todos  → identical but "op":"isnull"',
	'  due ≤ date  → {"from":"task","join":[{"predicate":"due","kind":"left","on":{"place":"x2","base":"id"}}],"where":[{"join":0,"place":"x1","op":"lte","value":"<YYYY-MM-DD>"}],"project":["id",{"place":"x2","as":"title"}]}',
	'  owners with >3 companies over owned_by(x1=owner,x2=company): {"from":"owned_by","group_by":"x1","count":{"having":{"op":"gt","value":3}},"project":["x1"]}'
].join('\n')

export const MUTATION_INSTRUCTIONS = [
	'You author a MUTATION SPEC — a small JSON object the engine runs as ONE all-or-nothing transaction of',
	'predication writes. You NEVER write SQL. Output ONLY the JSON object, no prose, no code fence.',
	'',
	'A mutation spec:',
	'  { "params": ["thing","from","to"],   // optional named inputs referenced as {"param":"name"}',
	'    "ops": [                            // applied in order, atomically (all or nothing)',
	'      {"op":"delete","predicate":"<p>","where":[{"place":"x2","op":"eq","value":<lit>|{"param":"thing"}}]},',
	'      {"op":"insert","predicate":"<p>","cells":{"x1":<lit>|{"param":"to"},"x2":{"param":"thing"}}} ] }',
	'',
	"Use places by the predicate's declared structure below. A transfer of ownership X→Y of thing T over",
	'owned_by(x1=owner, x2=thing) = delete the old (x1=X, x2=T) then insert the new (x1=Y, x2=T), one spec.',
	'Prefer literal values from the request; only use {"param":...} when the caller will supply inputs.',
	'',
	"REIFY, DON'T PACK. A place holds ONE atomic value or ONE reference — NEVER a structured phrase. If a value",
	'has internal structure (a quantity, a unit, a modifier, a nested thing), create a REFERENT and point at it:',
	'a cell may be {"ref":N} — the row id generated by an EARLIER insert op N (0-based) in this same spec. So',
	'"I ate 2 bananas" is NOT eat(x2="2 bananas"); it is three ops: 0 insert banana → 1 insert quantity',
	'{"x1":{"ref":0},"x2":"2"} → 2 insert eat {"x1":"<me>","x2":{"ref":0}}. {"ref":N} must point at an earlier',
	'INSERT (never forward, never a delete). Mint any missing predicate name (e.g. quantity≡klani) by just using it.'
].join('\n')

/**
 * board 0112 — the authoring instructions are DB CONFIG: the `query`/`mutate` ACTOR row's `prompt` column
 * is the SSOT (seeded by migration 0071 from the TS constants); the constant remains only as the fail-safe
 * fallback when the row is missing/empty (the config.ts seed-fallback pattern). Editing how GLM authors
 * specs = editing a DB row — the pattern a GLM-minted skill's own authoring prompts will follow.
 */
export async function authoringInstructions(kind: 'query' | 'mutation'): Promise<string> {
	const fallback = kind === 'query' ? QUERY_INSTRUCTIONS : MUTATION_INSTRUCTIONS
	try {
		const actor = await actorConfig(kind === 'query' ? 'query' : 'mutate')
		return actor?.prompt?.trim() ? actor.prompt : fallback
	} catch {
		return fallback
	}
}

/** Strip a fence + grab the first {...} JSON object from an LLM reply. */
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

/** One GLM-5.2 call: the spec meta-language + the live predicates + the request → a raw JSON spec object. */
async function authorSpec(
	kind: 'query' | 'mutation',
	request: string,
	preds: PredInfo[]
): Promise<{ spec?: unknown; error?: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	const system = [
		await authoringInstructions(kind),
		'',
		`Today is ${new Date().toISOString().slice(0, 10)} — resolve relative dates ("today", "this week", "tomorrow") to ISO YYYY-MM-DD literals.`,
		'',
		"THE USER'S PREDICATES (choose `from`/`predicate` + places from these):",
		predicatesBlock(preds)
	].join('\n')
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: `Author the ${kind} spec for: ${request}` }
			],
			stream: false
		})
	}).catch((e) => {
		console.error('[query-caps] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[]
	} | null
	const spec = parseJsonObject(data?.choices?.[0]?.message?.content ?? '')
	if (!spec) return { error: 'GLM did not return a parseable spec' }
	return { spec }
}

// board 0104 — one operation registry, `data_operations`, discriminated by `kind` (query | mutation).
type OpKind = 'query' | 'mutation'

/** Persist a named operation into data_operations (idempotent by name for the user). board 0104. */
async function saveSpec(uid: string, kind: OpKind, name: string, spec: unknown): Promise<void> {
	const existing = await sql<{
		id: string
	}>`SELECT id FROM data_operations WHERE user_id = ${uid} AND name = ${name} LIMIT 1`.execute(db())
	if (existing.rows[0]) {
		await sql`UPDATE data_operations SET spec = ${jsonb(spec)}, kind = ${kind}, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(
			db()
		)
	} else {
		await sql`INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
			VALUES (${randomUUID()}, ${uid}, ${name}, ${kind}, ${jsonb(spec)}, now(), now())`.execute(
			db()
		)
	}
}

/** Every operation visible to a user: their own authored ops + the global (user_id NULL) bundle-derived
 *  ones. Newest-authored-shape first would need a sort col; name order is stable + enough. board 0104. */
async function listOps(uid: string): Promise<{ name: string; kind: string; spec: unknown }[]> {
	const rows = await sql<{ name: string; kind: string; spec: unknown }>`
		SELECT name, kind, spec FROM data_operations WHERE user_id = ${uid} OR user_id IS NULL ORDER BY kind, name
	`.execute(db())
	return rows.rows.map((r) => ({ name: r.name, kind: r.kind, spec: asJson(r.spec) }))
}

/** A short deterministic name for a stored spec (predicate + kind); no Date/random in this file's hot path. */
function specName(base: string, request: string): string {
	const slug = request
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
	return slug ? `${base}-${slug}` : base
}

// ── the transparency context provider (the config UI shows the actual stored operations) ───────────
// board 0104 — ONE provider for the merged registry; the `kind` rides as a tag chip in the UI.
registerContextProvider('data_operations', async (uid) => ({
	kind: 'list',
	label: 'Operations',
	items: (await listOps(uid)).map((o) => ({
		name: o.name,
		tag: o.kind,
		gloss: JSON.stringify(o.spec)
	}))
}))

/** `ctx.query` — author a query spec via GLM, validate, persist, and RUN it (read-only, no HITL). board 0101. */
export function queryCaps(uid: string) {
	return {
		async author(request: string): Promise<{
			spec?: QuerySpec
			rows?: Record<string, unknown>[]
			name?: string
			error?: string
		}> {
			const preds = await listPredicatesDetailed(uid)
			const { spec, error } = await authorSpec('query', request, preds)
			if (error || !spec) return { error: error ?? 'no spec' }
			if (!validateQuerySpec(spec))
				return { spec: spec as QuerySpec, error: 'GLM produced an invalid query spec' }
			const rows = await runQuery(uid, spec)
			const name = specName('q', (spec as QuerySpec).name ?? request)
			await saveSpec(uid, 'query', name, spec).catch((e) =>
				console.error('[query-caps] save query failed:', e)
			)
			return { spec, rows, name }
		}
	}
}

/** `ctx.mutate` — plan a mutation spec (author+validate+persist, no run) and apply a validated one. board 0101. */
export function mutationCaps(uid: string) {
	return {
		async plan(
			request: string
		): Promise<{ spec?: MutationSpec; destructive?: boolean; name?: string; error?: string }> {
			const preds = await listPredicatesDetailed(uid)
			const { spec, error } = await authorSpec('mutation', request, preds)
			if (error || !spec) return { error: error ?? 'no spec' }
			if (!validateMutationSpec(spec))
				return { spec: spec as MutationSpec, error: 'GLM produced an invalid mutation spec' }
			const name = specName('m', (spec as MutationSpec).name ?? request)
			await saveSpec(uid, 'mutation', name, spec).catch((e) =>
				console.error('[query-caps] save mutation failed:', e)
			)
			return { spec, destructive: mutationIsDestructive(spec), name }
		},
		apply(spec: MutationSpec, params?: Record<string, unknown>) {
			return runMutation(uid, spec, params ?? {})
		}
	}
}
