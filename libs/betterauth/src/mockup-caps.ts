import { mergeDeep, validateStyleDef, validateViewDef } from '@avenos/aven-vibes'
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

// board 0115 — the COVERAGE gate: the card renders `source` directly (identity mapper), so EVERY $key
// the view reads must exist in the source, and every $$field used inside an $each template must exist
// on that array's items. A miss renders blank (the live "empty GESAMTSALDO" finding) — so it FAILS
// here instead, naming the missing keys, and GLM retries with a complete example state.
type ViewNodeish = {
	text?: unknown
	children?: ViewNodeish[]
	$each?: { items?: unknown; template?: ViewNodeish }
	[k: string]: unknown
}
export function assertSourceCoverage(view: unknown, source: Record<string, unknown>): void {
	const missing = new Set<string>()
	const topKey = (v: unknown): string | null => {
		if (typeof v !== 'string') return null
		const m = /^\$([A-Za-z_]\w*)$/.exec(v)
		return m ? m[1] : null
	}
	const itemField = (v: unknown): string | null => {
		if (typeof v !== 'string') return null
		const m = /^\$\$([A-Za-z_]\w*)$/.exec(v)
		return m ? m[1] : null
	}
	const isEmpty = (v: unknown): boolean =>
		v == null || v === '' || (Array.isArray(v) && v.length === 0)
	const walk = (node: ViewNodeish | undefined, items: Record<string, unknown>[] | null): void => {
		if (!node || typeof node !== 'object') return
		const tk = topKey(node.text)
		if (tk && isEmpty(source[tk])) missing.add(`$${tk}`)
		const fk = itemField(node.text)
		if (fk && items && items.length > 0 && items.every((it) => isEmpty(it?.[fk])))
			missing.add(`$$${fk}`)
		if (node.$each) {
			const ik = topKey(node.$each.items)
			const arr = ik && Array.isArray(source[ik]) ? (source[ik] as Record<string, unknown>[]) : null
			if (ik && (!arr || arr.length === 0)) missing.add(`$${ik} (non-empty array)`)
			walk(node.$each.template, arr)
		}
		for (const c of node.children ?? []) walk(c, items)
	}
	const root = (view as { content?: ViewNodeish })?.content ?? (view as ViewNodeish)
	walk(root, null)
	if (missing.size)
		throw new Error(
			`[mockup] the example source misses keys the view renders: ${[...missing].join(', ')} — add realistic values for each`
		)
}

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
	// gate 4: COVERAGE — every $key/$$field the view renders must carry example data (no blank cards).
	assertSourceCoverage(parts.view, source as Record<string, unknown>)

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

/** The three RAW rows of a mockup (style UNcomposed — extends ref intact): the refine base. */
export async function loadRawParts(name: string): Promise<MockupParts | null> {
	const one = async (table: string): Promise<unknown> => {
		const r = await sql<{ body: unknown }>`SELECT body FROM ${sql.raw(table)} WHERE name = ${name}`.execute(db())
		return r.rows[0]?.body
	}
	const [view, style, source] = await Promise.all([
		one('vibe_view'),
		one('vibe_style'),
		one('vibe_source')
	])
	if (view == null) return null
	return { view: asJson(view), style: asJson(style) ?? {}, source: asJson(source) ?? {} }
}

/** board 0115 — PATCH editing (instead of full rewrites): GLM emits only the changed sections; the
 *  server merges them onto the RAW base — view replaces when present (a tree), style tokens/selectors
 *  and source DEEP-MERGE — so untouched parts are preserved BY CONSTRUCTION, never re-generated. */
export function mergeMockupPatch(
	base: MockupParts,
	patch: { view?: unknown; style?: unknown; source?: unknown }
): MockupParts {
	const baseStyle = (base.style ?? {}) as { tokens?: unknown; selectors?: unknown }
	const patchStyle = (patch.style ?? {}) as { tokens?: unknown; selectors?: unknown }
	return {
		view: patch.view ?? base.view,
		style: patch.style
			? {
					tokens: mergeDeep(
						(baseStyle.tokens ?? {}) as Record<string, unknown>,
						(patchStyle.tokens ?? {}) as Record<string, unknown>
					),
					selectors: mergeDeep(
						(baseStyle.selectors ?? {}) as Record<string, unknown>,
						(patchStyle.selectors ?? {}) as Record<string, unknown>
					)
				}
			: base.style,
		source: patch.source
			? mergeDeep(base.source as Record<string, unknown>, patch.source as Record<string, unknown>)
			: base.source
	}
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
	'SOURCE — the card renders it DIRECTLY: EVERY "$key" in the view MUST be a key of source with a real',
	'  value, and EVERY "$$field" in an $each template MUST exist on that array\'s items — a missing key',
	'  renders a BLANK card and is REJECTED. Realistic, GERMAN-flavoured: 3–5 list items, plausible names,',
	'  amounts with units, dates. Never empty strings.',
	'',
	'ICONS — an inline-SVG SUBSET is allowed (shape tags only: svg, g, path, circle, rect, line, polyline,',
	'  polygon, ellipse; geometry+paint attrs only — no href, no image, no script). Example:',
	'  {"tag":"svg","attrs":{"viewBox":"0 0 24 24","width":"18","height":"18","fill":"none",',
	'   "stroke":"currentColor","stroke-width":"2"},"children":[{"tag":"path","attrs":{"d":"M3 12h18M3 6h18M3 18h18"}}]}',
	'  Icons inherit text color via stroke/fill "currentColor".',
	'',
	'Keep views compact (one screen, one idea).'
].join('\n')

// The EDIT prompt (config on the edit_mockup actor row; this is the fallback): a MINIMAL PATCH, not a
// rewrite — smaller outputs, and untouched parts can never be mangled or dropped.
export const EDIT_INSTRUCTIONS = [
	'You REFINE an existing screen mockup. You receive its CURRENT CONFIG (view, style, source) and a',
	'requested change. Output ONLY one JSON PATCH object — include ONLY what changes:',
	'  { "name":"<unchanged>", "view":{...}?, "style":{...}?, "source":{...}? }',
	'  · style — PARTIAL: only the tokens/selectors you change/add (deep-merged onto the current style).',
	'  · source — PARTIAL: only the keys you change/add (deep-merged). New view refs need new source keys.',
	'  · view — include ONLY when the STRUCTURE changes (it replaces the whole tree); pure styling changes',
	'    must NOT include view.',
	'The same grammar and limits as creation apply (node tree · camelCase style props from the allow-list ·',
	'brand variables · the inline-SVG icon subset). Never re-emit unchanged sections.'
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

/** GLM-5.2 designs (or refines) a mockup from plain language; the deterministic gates persist it.
 *  Streams raw tokens through `onToken` (board 0115: the chat shows the live authoring stream instead
 *  of a dead "Thinking…" — same panel the website skill uses). */
export async function mintMockup(
	request: string,
	opts: { name?: string; onToken?: (text: string) => void; promptActor?: string } = {}
): Promise<{ name?: string; error?: string }> {
	const rawName = opts.name
	const key = process.env.TINFOIL_API_KEY
	if (!key) return { error: 'TINFOIL_API_KEY not configured' }
	// the authoring prompt is CONFIG (the actor row's prompt column); this constant is the fallback.
	const promptActor = opts.promptActor ?? (rawName ? 'edit_mockup' : 'create_mockup')
	const cfg = await actorConfig(promptActor).catch(() => null)
	const fallback = rawName ? EDIT_INSTRUCTIONS : MOCKUP_INSTRUCTIONS
	const instructions = cfg?.prompt?.trim() || fallback
	// refining? feed the RAW rows (uncomposed style — no brand bloat) as the CURRENT CONFIG.
	let existing = ''
	let base: MockupParts | null = null
	if (rawName) {
		const name = mockName(rawName)
		base = await loadRawParts(name).catch(() => null)
		if (base) {
			existing = [
				'',
				`CURRENT CONFIG for "${name}" (you are REFINING — output a MINIMAL PATCH):`,
				JSON.stringify({ name, view: base.view, style: base.style, source: base.source })
			].join('\n')
		}
	}
	// a stalled GLM stream must NEVER wedge the tool call open (the live 187s+ hang): abort when no
	// bytes arrive for IDLE_MS, and hard-cap the whole authoring round at TOTAL_MS.
	const IDLE_MS = 45_000
	const TOTAL_MS = 240_000
	const ctrl = new AbortController()
	let idleTimer = setTimeout(() => ctrl.abort(), IDLE_MS)
	const totalTimer = setTimeout(() => ctrl.abort(), TOTAL_MS)
	const bump = () => {
		clearTimeout(idleTimer)
		idleTimer = setTimeout(() => ctrl.abort(), IDLE_MS)
	}
	const clearTimers = () => {
		clearTimeout(idleTimer)
		clearTimeout(totalTimer)
	}
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		signal: ctrl.signal,
		body: JSON.stringify({
			model: GLM_MODEL,
			messages: [
				{ role: 'system', content: instructions + existing },
				{ role: 'user', content: `Design the screen for: ${request}` }
			],
			stream: true
		})
	}).catch((e) => {
		console.error('[mockup] GLM fetch failed:', e)
		return null
	})
	if (!res?.ok || !res.body) {
		clearTimers()
		return { error: `GLM error ${res?.status ?? '???'}` }
	}
	// stream: accumulate the full text while forwarding each delta to the live panel.
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
			return { error: `GLM stream stalled (no data for ${IDLE_MS / 1000}s) — try again` }
		}
		bump()
		const { done, value } = step
		if (done) break
		buf += dec.decode(value, { stream: true })
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
					opts.onToken?.(piece)
				}
			} catch {
				/* partial frame */
			}
		}
	}
	clearTimers()
	const obj = parseJsonObject(full)
	if (!obj) return { error: 'GLM did not return a parseable mockup object' }
	try {
		const parts: MockupParts = base
			? mergeMockupPatch(base, { view: obj.view, style: obj.style, source: obj.source })
			: { view: obj.view, style: obj.style, source: obj.source }
		const name = await saveMockup(String(obj.name ?? rawName ?? request.slice(0, 40)), parts)
		return { name }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

/** The ONE mockup resolver (deterministic, not fuzzy): canonicalize the input through the SAME
 *  mockName() rule applied at save time, then exact-match. Cards show the app name WITHOUT the
 *  mock- wall and labels use spaces, so "banking-overview" / "Banking Overview" / the walled name
 *  all canonicalize to the same stored row. A miss stays a miss — semantics belong to the model. */
export async function resolveMockup(rawName: string): Promise<string | null> {
	let canonical: string
	try {
		canonical = mockName(String(rawName ?? ''))
	} catch {
		return null
	}
	const all = await listMockups()
	return all.find((m) => m.name === canonical)?.name ?? null
}

/** `ctx.mockup` — the skillify part-1 caps: GLM design/refine · list · resolve · load. board 0115. */
export function mockupCaps(onToken?: (text: string) => void) {
	return {
		mint: (request: string, o: { name?: string; promptActor?: string } = {}) =>
			mintMockup(request, { ...o, onToken }),
		save: saveMockup,
		list: listMockups,
		resolve: resolveMockup,
		load: (name: string) => loadVibe(mockName(name)),
		json: asJson
	}
}
