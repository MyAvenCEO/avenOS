import { validateStyleDef, validateViewDef } from '@avenos/aven-vibes'
import { sql } from 'kysely'
import { actorConfig } from './config'
import { db } from './db'
import { loadVibe } from './vibe-registry'

// board 0115 — SKILLIFY part 1: GLM designs a new skill screen as PURE CONFIG — a vibe view + style +
// EXAMPLE source — behind two hard gates: (1) the mock- NAMESPACE WALL (whatever GLM names its output,
// it is forced into the prefix — system vibes like todos/goals/inventory are physically untouchable),
// and (2) the existing validators (validateViewDef SAFE_TAGS · validateStyleDef allow-list — the vibe
// security boundary, NEVER widened here). Mockups carry an IDENTITY mapper (state = source), so GLM
// authors only look + example data; the real mapper/data wiring is part 2 (board 0113).

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const GLM_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

export const MOCK_PREFIX = 'mock-'
/** Mockups have no behavior: the example source IS the rendered state. */
const IDENTITY_LOGIC = `function initState(source){return source||{}}
function handleEvent(t, p, s) { return s }`

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

/** Force any GLM/user-supplied name into the mock- namespace (the overwrite wall) + slug it. */
export function mockName(raw: string): string {
	const slug = String(raw ?? '')
		.toLowerCase()
		.replace(/^mock[-_\s]*/, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	if (!slug) throw new Error('[mockup] a mockup needs a name')
	return `${MOCK_PREFIX}${slug}`
}

export type MockupParts = { view: unknown; style: unknown; source: unknown }

/** Validate + persist one mockup (view/style/source + the identity mapper). Returns the walled name. */
export async function saveMockup(rawName: string, parts: MockupParts): Promise<string> {
	const name = mockName(rawName)
	// gate 1: the view — SAFE_TAGS / event / path rules.
	validateViewDef((parts.view ?? {}) as never)
	// gate 2: the style — stored RAW with `extends: 'brand'` (board 0115): the brand layer is a REFERENCED
	// vibe_style row composed at serve time, never baked in — so a brand change re-styles every mockup.
	// The validator gates the mockup's OWN layer (the brand row is system-owned + already validated).
	const raw = (parts.style ?? {}) as { tokens?: unknown; selectors?: unknown }
	const styled = {
		extends: 'brand',
		tokens: (raw.tokens ?? {}) as Record<string, unknown>,
		selectors: (raw.selectors ?? {}) as Record<string, Record<string, unknown>>
	}
	validateStyleDef(styled)
	// gate 3: the example source must be a non-empty object (the vibe-source completeness rule).
	const source = parts.source
	if (!source || typeof source !== 'object' || Object.keys(source as object).length === 0)
		throw new Error('[mockup] example source must be a non-empty object')

	const D = db()
	const upsertJson = (table: 'vibe_view' | 'vibe_style' | 'vibe_source', body: unknown) => sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${JSON.stringify(body)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(D)
	await upsertJson('vibe_view', parts.view)
	await upsertJson('vibe_style', styled)
	await upsertJson('vibe_source', source)
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES (${name}, ${IDENTITY_LOGIC})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(D)
	return name
}

/** Every minted mockup (the mock- namespace of the vibe registry). */
export async function listMockups(): Promise<{ name: string; label: string }[]> {
	const r = await sql<{ name: string }>`
		SELECT name FROM vibe_view WHERE name LIKE ${`${MOCK_PREFIX}%`} ORDER BY name
	`.execute(db())
	return r.rows.map((row) => ({
		name: row.name,
		label: row.name.slice(MOCK_PREFIX.length).replace(/-/g, ' ')
	}))
}

// ── GLM authoring (the non-deterministic layer over the deterministic gates) ──────────────────────
// The TS FALLBACK for the authoring prompt; the SSOT at runtime is the mockup actor row's prompt
// column (config-as-data, the 0112 pattern) — seeded from this constant by migration 0089.
export const MOCKUP_INSTRUCTIONS = [
	'You DESIGN a screen (a "vibe") for a new skill feature: its VIEW (a JSON node tree), its STYLE (brand-',
	'composed CSS-in-JSON), and EXAMPLE source data that the view renders directly (state = source; there is',
	'no logic layer). Output ONLY one JSON object, no prose, no code fence:',
	'  { "name":"<kebab-case screen name>", "view":{...}, "style":{...}, "source":{...} }',
	'',
	'VIEW grammar — a node: { "tag":"div|span|ul|li|h1|h2|h3|p|button", "class":"<css classes>",',
	'  "text":"<literal or $stateKey or $$itemField>", "children":[<node>…],',
	'  "$each":{ "items":"$<arrayKey>", "template":<node> }, "attrs":{"<attr>":"<value>"} }',
	'  · "$key" reads a top-level source key; inside an $each template "$$field" reads the item\'s field.',
	'  · put an $each as the ONLY child of a grid/list container; give every visual node a class.',
	'',
	'STYLE — { "tokens":{ "<name>":"<css value>" }, "selectors":{ ".<class>":{ camelCaseProp: value } } }.',
	'  The BRAND layer is composed underneath automatically — you may use its primitives and variables:',
	'  .grid-card / .grid-card-title / .card (tiles), var(--font-display) (titles), var(--fs-title|body|micro),',
	'  var(--text) var(--muted) var(--brand-accent) var(--surface) var(--border) var(--radius-card|pill).',
	'  Allowed props are a strict allow-list (layout/typography/color; NO position, NO url()); width queries:',
	'  "@container (max-width: 420px)": { ".sel": {...} } adapts to the card width.',
	'  House style: a small uppercase eyebrow with a colored marker, Clash display titles, bordered cream',
	'  surfaces (var(--surface) + var(--border)), pill chips, grids via repeat(auto-fill, minmax(11rem, 1fr)).',
	'',
	'SOURCE — realistic, GERMAN-flavoured example data matching every $key/$$field the view reads.',
	'  3–5 list items, plausible values (names, amounts with units, dates). Non-empty, always.',
	'',
	'When EXISTING ROWS are provided you are REFINING: keep the name, apply the requested change, return the',
	'full updated object. Keep views compact (one screen, one idea).'
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

/** GLM-5.2 designs (or refines) a mockup from plain language; the deterministic gates persist it. */
export async function mintMockup(
	request: string,
	rawName?: string
): Promise<{ name?: string; error?: string }> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	// the authoring prompt is CONFIG (the actor row's prompt column); this constant is the fallback.
	const cfg = await actorConfig('mockup').catch(() => null)
	const instructions = cfg?.prompt?.trim() || MOCKUP_INSTRUCTIONS
	// refining? feed the existing rows back as context.
	let existing = ''
	if (rawName) {
		const name = mockName(rawName)
		const bundle = await loadVibe(name).catch(() => null)
		if (bundle?.view) {
			existing = [
				'',
				`EXISTING ROWS for "${name}" (you are REFINING — apply the change, return the full object):`,
				JSON.stringify({ name, view: bundle.view, style: bundle.style, source: bundle.source })
			].join('\n')
		}
	}
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: instructions + existing },
				{ role: 'user', content: `Design the screen for: ${request}` }
			],
			stream: false
		})
	}).catch((e) => {
		console.error('[mockup] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok) return { error: `GLM error ${res?.status ?? '???'}` }
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[]
	} | null
	const obj = parseJsonObject(data?.choices?.[0]?.message?.content ?? '')
	if (!obj) return { error: 'GLM did not return a parseable mockup object' }
	try {
		const name = await saveMockup(String(obj.name ?? rawName ?? request.slice(0, 40)), {
			view: obj.view,
			style: obj.style,
			source: obj.source
		})
		return { name }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

/** `ctx.mockup` — the skillify part-1 caps: GLM design/refine · list · load. board 0115. */
export function mockupCaps() {
	return {
		mint: mintMockup,
		save: saveMockup,
		list: listMockups,
		load: (name: string) => loadVibe(mockName(name)),
		json: asJson
	}
}
