/**
 * On-device LLM tool layer for the Talk chat. Three concerns, one file:
 *
 *   1. SCHEMAS  — standard function-calling JSON Schema for each tool, advertised to the model.
 *   2. ROUTER   — `executeToolCall` dispatches a call by name to its executor (the side effect).
 *                 `navigate_pages` → the UI-routing executor (`navigateAppTo`).
 *   3. FALLBACK — `inferToolCallFromText` deterministically recovers a navigation intent from
 *                 the *user's* prompt when the small LFM2.5-1.2B answers in prose instead of
 *                 emitting a real `<|tool_call_start|>` call (it reliably names the route, but
 *                 not always in call syntax). Matching the user prompt — not the model's reply —
 *                 avoids false navigations from the model's rambling.
 *
 * The route set mirrors the app's ACTUAL navigation: the top nav (Intents / Sandbox /
 * Identities / Avens — `app/src/routes/+layout.svelte`) plus the self-settings sub-pages
 * (`app/src/lib/shell/settings-nav.ts`). Keep hrefs in sync with those.
 */

import { t } from '$lib/i18n'
import { navigateAppTo } from '$lib/shell'

/** Payload of the `llm:tool-call` event (see `app/src-tauri/src/llm.rs`). */
export type LlmToolCall = {
	replyId: string
	name: string
	arguments: Record<string, unknown>
}

/** A JSON Schema object (the standard function-calling `parameters` shape). */
export type JsonSchema = {
	type: 'object'
	properties: Record<string, unknown>
	required?: string[]
}

/** A standard function-calling tool definition. */
export type ToolDef = {
	name: string
	description: string
	parameters: JsonSchema
}

/** Outcome of executing a tool call — a short, localized line for the chat bubble. */
export type ToolDispatchResult = { ok: boolean; message: string }

/** A tool executor: receives the (parsed) arguments, performs the side effect, returns a result. */
type ToolExecutor = (args: Record<string, unknown>) => ToolDispatchResult

/** A registry entry = the model-facing schema + its app-side executor. */
type ToolEntry = { def: ToolDef; execute: ToolExecutor }

// ───────────────────────────── navigate_pages ─────────────────────────────

/** A navigable destination. */
type RouteDef = {
	/** The enum value advertised to the model (short, lowercase, stable across locales). */
	route: string
	/** Where `navigateAppTo` sends the app — must match the real nav href. */
	href: string
	/** i18n key for the human label (confirmation bubble), localized at call time. */
	labelKey: string
	/** Short English gloss baked into the model-facing tool description. */
	desc: string
	/** Extra words (user phrasing) that map to this route — matched as whole words, lowercased. */
	aliases?: string[]
}

/** The real nav. Top-level sections first, then self-settings pages. Extend here only. */
const ROUTES: RouteDef[] = [
	{ route: 'intents', href: '/', labelKey: 'nav.intents', desc: 'Intents — home / intent composer', aliases: ['intent', 'home', 'start'] },
	{ route: 'sandbox', href: '/sandbox', labelKey: 'nav.sandbox', desc: 'Sandbox — vibe-app sandbox' },
	{ route: 'identities', href: '/identities', labelKey: 'nav.identities', desc: 'Identities — list of identities', aliases: ['identity', 'identität', 'identitäten', 'identitaet', 'identitaeten'] },
	{ route: 'avens', href: '/avens', labelKey: 'nav.avens', desc: 'Avens — aven orchestrator apps', aliases: ['aven'] },
	{ route: 'settings', href: '/settings/identity', labelKey: 'nav.selfSettings', desc: 'Settings — device identity / self settings', aliases: ['einstellungen', 'einstellung', 'self'] },
	{ route: 'models', href: '/settings/models', labelKey: 'selfNav.localModels', desc: 'Local models — on-device model management', aliases: ['model', 'modell', 'modelle'] },
	{ route: 'network', href: '/settings/advanced/network', labelKey: 'selfNav.network', desc: 'Network settings', aliases: ['netzwerk'] },
	{ route: 'language', href: '/settings/preferences', labelKey: 'selfNav.language', desc: 'Language / preferences', aliases: ['sprache', 'preferences', 'präferenzen'] },
	{ route: 'passwords', href: '/settings/vault/passwords', labelKey: 'vaultNav.passwords', desc: 'Vault — passwords', aliases: ['passwörter', 'passwoerter', 'passwort', 'vault', 'tresor'] },
	{ route: 'apikeys', href: '/settings/vault/api-keys', labelKey: 'vaultNav.apiKeys', desc: 'Vault — API keys', aliases: ['apikey', 'apikeys', 'api-keys', 'api-schlüssel', 'apischlüssel', 'schlüssel'] },
	{ route: 'db', href: '/settings/db', labelKey: 'selfNav.db', desc: 'Database settings', aliases: ['datenbank', 'database'] },
]

/** The `navigate_pages` schema, with the route enum + per-route hints baked into the description. */
const NAVIGATE_TOOL: ToolDef = {
	name: 'navigate_pages',
	description:
		'Navigate the app to one of its main pages. Call this whenever the user asks to open, ' +
		'go to, show, or switch to a section of the app. Pages: ' +
		ROUTES.map((r) => `${r.route} = ${r.desc}`).join('; ') +
		'.',
	parameters: {
		type: 'object',
		properties: {
			route: {
				type: 'string',
				enum: ROUTES.map((r) => r.route),
				description: 'Which page to open.',
			},
		},
		required: ['route'],
	},
}

/** Resolve a model-emitted route value (or alias) to its [`RouteDef`], case-insensitively. */
function resolveRoute(value: unknown): RouteDef | undefined {
	const raw = String(value ?? '')
		.trim()
		.toLowerCase()
	if (!raw) return undefined
	return ROUTES.find((r) => r.route === raw || r.aliases?.includes(raw))
}

/** The UI-routing executor: perform the navigation and return a localized confirmation. */
function executeNavigate(args: Record<string, unknown>): ToolDispatchResult {
	const def = resolveRoute(args.route)
	if (!def) {
		const got = String(args.route ?? '').trim()
		return { ok: false, message: t('identities.talk.navUnknown', { target: got || '?' }) }
	}
	navigateAppTo(def.href)
	return { ok: true, message: t('identities.talk.navigating', { target: t(def.labelKey) }) }
}

// ───────────────────────────── tool registry ─────────────────────────────

const TOOLS: Record<string, ToolEntry> = {
	[NAVIGATE_TOOL.name]: { def: NAVIGATE_TOOL, execute: executeNavigate },
}

/** The tools advertised to the model on every Talk generation. */
export const LLM_TOOLS: ToolDef[] = Object.values(TOOLS).map((e) => e.def)

/** Dispatch a tool call to its executor (the router). Unknown tools are surfaced, not thrown. */
export function executeToolCall(call: LlmToolCall): ToolDispatchResult {
	const entry = TOOLS[call.name]
	if (!entry) return { ok: false, message: `⚠️ ${call.name}?` }
	return entry.execute(call.arguments ?? {})
}

// ───────────────────────────── text fallback ─────────────────────────────

/** Navigation cue words (German + English), matched as case-insensitive substrings. */
const NAV_CUES = [
	'öffne', 'offne', 'zeig', 'geh', 'navig', 'wechsel', 'bring mich', 'wechsle', 'zur seite',
	'open', 'show', 'go to', 'goto', 'switch to', 'display', 'take me',
]

/**
 * Recover a navigation intent from free text — requires BOTH a navigation cue and a whole-word
 * route token. Run against the USER prompt (not the model reply) so the model's prose can't
 * trigger a false navigation. Returns the first matching route.
 */
function findRouteInText(text: string): RouteDef | undefined {
	const lower = text.toLowerCase()
	if (!NAV_CUES.some((c) => lower.includes(c))) return undefined
	const words = new Set(lower.split(/[^\p{L}\p{N}-]+/u).filter(Boolean))
	for (const r of ROUTES) {
		const tokens = [r.route, ...(r.aliases ?? [])]
		for (const tok of tokens) {
			const hit = tok.includes(' ') || tok.includes('-') ? lower.includes(tok) : words.has(tok)
			if (hit) return r
		}
	}
	return undefined
}

/**
 * Deterministic fallback: if `userPrompt` is an explicit navigation request, synthesize the
 * equivalent `navigate_pages` call so it flows through the same router. Returns undefined when
 * the prompt isn't a navigation command.
 */
export function inferToolCallFromText(userPrompt: string, replyId: string): LlmToolCall | undefined {
	const def = findRouteInText(userPrompt)
	if (!def) return undefined
	return { replyId, name: 'navigate_pages', arguments: { route: def.route } }
}

// ──────────────────────── structured chat-stream record ────────────────────────

/** A tool call rendered as a chip in the chat stream; encoded into the message body so it
 *  survives reload without a schema change. `inferred` marks fallback-recovered calls. */
export type ToolCallRecord = {
	kind: 'tool_call'
	name: string
	arguments: Record<string, unknown>
	result: string
	inferred?: boolean
}

/** Encode a tool call + its result into a message body string. */
export function encodeToolCallBody(rec: Omit<ToolCallRecord, 'kind'>): string {
	return JSON.stringify({ kind: 'tool_call', ...rec } satisfies ToolCallRecord)
}

/** Parse a message body back into a [`ToolCallRecord`], or null if it isn't one. */
export function parseToolCallBody(body: string | null | undefined): ToolCallRecord | null {
	if (!body || body[0] !== '{') return null
	try {
		const o = JSON.parse(body) as ToolCallRecord
		return o && o.kind === 'tool_call' && typeof o.name === 'string' ? o : null
	} catch {
		return null
	}
}
