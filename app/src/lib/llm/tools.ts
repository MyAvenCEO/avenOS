/**
 * On-device LLM tool layer for the Talk chat. The agent is tool-call-only: every turn resolves
 * to a tool call (never bare prose). Concerns, one file:
 *
 *   1. SCHEMAS  — standard function-calling JSON Schema per tool. EVERY tool carries a standard
 *                 `response` field: a short, human-facing reply (in the user's language) that we
 *                 render as the bubble text and can speak via the TTS model.
 *   2. ROUTER   — `executeToolCall` dispatches a call by name to its executor (the side effect).
 *                 `navigate_pages` → the UI-routing executor (`navigateAppTo`).
 *   3. RESOLVE  — `resolveAgentTurn` turns a model turn (a real tool call, and/or the streamed
 *                 prose, plus the user prompt) into exactly one rendered record, executing the
 *                 side effect. Order: real call → (if it doesn't resolve) deterministic
 *                 user-prompt navigation → wrap any prose as a `respond` call. So the UI only
 *                 ever shows tool-call chips, and a malformed nav call still routes.
 *
 * Routes mirror the app's ACTUAL nav (top nav in `app/src/routes/+layout.svelte`; self-settings
 * in `app/src/lib/shell/settings-nav.ts`). Keep hrefs in sync.
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

/** Outcome of executing a tool call's side effect. */
export type ToolDispatchResult = { ok: boolean; message: string; response?: string }

/** A tool executor: receives the (parsed) arguments, performs the side effect, returns a result. */
type ToolExecutor = (args: Record<string, unknown>) => ToolDispatchResult

/** A registry entry = the model-facing schema + its app-side executor. */
type ToolEntry = { def: ToolDef; execute: ToolExecutor }

/**
 * The standard `response` property every tool schema carries. The model writes its short,
 * human-facing reply here (spoken back via TTS); the rest of the args drive the side effect.
 */
const RESPONSE_PROP = {
	response: {
		type: 'string',
		description:
			"A short, friendly reply to the user in the user's language (one sentence), e.g. " +
			"'Ich öffne die Einstellungen für dich.'. This is shown and spoken back to the user.",
	},
} as const

// ───────────────────────────── navigate_pages ─────────────────────────────

/** A navigable destination. */
type RouteDef = {
	/** The enum value advertised to the model (short, lowercase, stable across locales). */
	route: string
	/** Where `navigateAppTo` sends the app — must match the real nav href. */
	href: string
	/** i18n key for the human label (confirmation + spoken reply), localized at call time. */
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

/** The `navigate_pages` schema, with the route enum + per-route hints + the standard `response`. */
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
			...RESPONSE_PROP,
		},
		required: ['route', 'response'],
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

/** The UI-routing executor: perform the navigation and return result + a spoken-style response. */
function executeNavigate(args: Record<string, unknown>): ToolDispatchResult {
	const def = resolveRoute(args.route)
	if (!def) {
		const got = String(args.route ?? '').trim()
		return { ok: false, message: t('identities.talk.navUnknown', { target: got || '?' }) }
	}
	navigateAppTo(def.href)
	const label = t(def.labelKey)
	return {
		ok: true,
		message: t('identities.talk.navigating', { target: label }),
		response: t('identities.talk.navOpening', { target: label }),
	}
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

// ──────────────────────── chat-stream record + resolution ────────────────────────

/** A tool call rendered as a chip in the chat stream; encoded into the message body so it
 *  survives reload without a schema change. `response` is the speakable human-facing reply;
 *  `result` is the technical action outcome; `inferred` marks fallback-recovered calls. */
export type ToolCallRecord = {
	kind: 'tool_call'
	name: string
	arguments: Record<string, unknown>
	response: string
	result: string
	ok: boolean
	inferred?: boolean
}

function recordFrom(
	name: string,
	args: Record<string, unknown>,
	exec: ToolDispatchResult,
	inferred: boolean,
): ToolCallRecord {
	const modelResponse = String(args.response ?? '').trim()
	return {
		kind: 'tool_call',
		name,
		arguments: args,
		response: modelResponse || exec.response || exec.message,
		result: exec.message,
		ok: exec.ok,
		inferred,
	}
}

/**
 * Resolve a single agent turn into exactly one rendered tool-call record, executing the side
 * effect. The agent is tool-call-only, so prose is never shown bare — it is wrapped as a
 * `respond` call.
 *
 *   1. A real tool call from the model — if its side effect succeeds, use it.
 *   2. Else, if the USER prompt is an explicit navigation command, route deterministically
 *      (this is what saves a malformed real call like `route="{...}"`).
 *   3. Else, wrap the model's prose (or a fallback) as a `respond` call.
 */
export function resolveAgentTurn(opts: {
	replyId: string
	userPrompt: string
	toolCall?: LlmToolCall
	prose: string
}): ToolCallRecord {
	const { userPrompt, toolCall, prose } = opts

	if (toolCall && TOOLS[toolCall.name]) {
		const exec = executeToolCall(toolCall)
		if (exec.ok) return recordFrom(toolCall.name, toolCall.arguments, exec, false)
		// Malformed/unresolvable args (e.g. the 1.2B nesting JSON into `route`) → try the prompt.
	}

	const def = findRouteInText(userPrompt)
	if (def) {
		const exec = executeNavigate({ route: def.route })
		// Carry the model's prose as the response if it wrote one, else the synthesized reply.
		const args = { route: def.route, response: String(toolCall?.arguments.response ?? '').trim() }
		return recordFrom('navigate_pages', args, exec, true)
	}

	const text = prose.trim()
	return {
		kind: 'tool_call',
		name: 'respond',
		arguments: { response: text },
		response: text || t('identities.talk.agentNoReply'),
		result: '',
		ok: true,
		inferred: false,
	}
}

/** Encode a record into a message body string (persisted; parsed back on render/reload). */
export function encodeToolCallBody(rec: ToolCallRecord): string {
	return JSON.stringify(rec)
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
