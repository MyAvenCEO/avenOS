/**
 * On-device LLM tool layer for the identity intent bar. The agent is tool-call-only: every turn
 * resolves to a tool call (never bare prose). Concerns, one file:
 *
 *   1. SCHEMAS  — standard function-calling JSON Schema per tool. EVERY tool carries a standard
 *                 `response` field: a short, human-facing reply (in the user's language) that we
 *                 render as the bubble text and can speak via the TTS model.
 *   2. ROUTER   — `executeToolCall` dispatches a call by name to its executor (the side effect),
 *                 passing a per-turn {@link ToolContext} (the active identity + its mutations).
 *                 `navigate_views` → in-identity routing; `create_todo` → add a task.
 *   3. RESOLVE  — `resolveAgentTurn` turns a model turn (a real tool call, and/or the streamed
 *                 prose, plus the user prompt) into exactly one rendered record, executing the
 *                 side effect. Order: real call → (if it doesn't resolve) deterministic
 *                 user-prompt navigation → wrap any prose as a `respond` call. So the UI only
 *                 ever shows tool-call chips, and a malformed nav call still routes.
 *
 * Tools act INSIDE one identity — navigation switches between the identity's sub-views (talk,
 * todos, files, members, db), not the global app nav. Views mirror the identity layout
 * (`app/src/routes/identities/[identityId]/+layout.svelte`); keep subpaths in sync.
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

/**
 * Per-turn execution context: which identity the tools act on, plus its data mutations.
 * Built fresh each turn by the caller (the runtime), so executors stay pure/stateless.
 */
export type ToolContext = {
	/** Base path of the active identity, e.g. `/identities/<encoded-id>`. Drives `navigate_views`. */
	identityBase: string
	/** Add a todo to the active identity's task list. Resolves on success, throws on failure. */
	createTodo: (title: string) => Promise<void>
}

/** Outcome of executing a tool call's side effect. */
export type ToolDispatchResult = { ok: boolean; message: string; response?: string }

/** A tool executor: receives the (parsed) arguments + the turn context, performs the side effect. */
type ToolExecutor = (
	args: Record<string, unknown>,
	ctx: ToolContext,
) => ToolDispatchResult | Promise<ToolDispatchResult>

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
			"'Ich öffne die Aufgaben für dich.'. This is shown and spoken back to the user.",
	},
} as const

// ───────────────────────────── navigate_views ─────────────────────────────

/** A navigable sub-view within the active identity. */
type ViewDef = {
	/** The enum value advertised to the model (short, lowercase, stable across locales). */
	view: string
	/** Appended to the identity base to form the route (must match the real sub-route). */
	subpath: string
	/** i18n key for the human label (confirmation + spoken reply), localized at call time. */
	labelKey: string
	/** Short English gloss baked into the model-facing tool description. */
	desc: string
	/** Extra words (user phrasing) that map to this view — matched as whole words, lowercased. */
	aliases?: string[]
}

/** The identity's sub-views. Mirrors the identity layout's aside nav. Extend here only. */
const VIEWS: ViewDef[] = [
	{ view: 'talk', subpath: '/talk', labelKey: 'nav.talk', desc: 'Talk — chat with the identity agent', aliases: ['chat', 'message', 'messages', 'nachricht', 'nachrichten', 'gespräch'] },
	{ view: 'todos', subpath: '/todos', labelKey: 'nav.todos', desc: 'Todos — the identity task list', aliases: ['todo', 'task', 'tasks', 'aufgabe', 'aufgaben'] },
	{ view: 'files', subpath: '/gallery', labelKey: 'nav.gallery', desc: 'Files — media & files gallery', aliases: ['file', 'gallery', 'galerie', 'media', 'medien', 'datei', 'dateien'] },
	{ view: 'members', subpath: '/members', labelKey: 'nav.members', desc: 'Members — people with access', aliases: ['member', 'people', 'mitglied', 'mitglieder', 'leute'] },
	{ view: 'db', subpath: '/db', labelKey: 'nav.db', desc: 'DB — raw table explorer', aliases: ['database', 'datenbank', 'table', 'tables', 'tabelle', 'tabellen'] },
]

/** The `navigate_views` schema, with the view enum + per-view hints + the standard `response`. */
const NAVIGATE_VIEWS_TOOL: ToolDef = {
	name: 'navigate_views',
	description:
		'Switch the current identity to one of its sub-views. Call this whenever the user asks to ' +
		'open, go to, show, or switch to a part of the identity. Views: ' +
		VIEWS.map((v) => `${v.view} = ${v.desc}`).join('; ') +
		'.',
	parameters: {
		type: 'object',
		properties: {
			view: {
				type: 'string',
				enum: VIEWS.map((v) => v.view),
				description: 'Which sub-view to open.',
			},
			...RESPONSE_PROP,
		},
		required: ['view', 'response'],
	},
}

/** Resolve a model-emitted view value (or alias) to its [`ViewDef`], case-insensitively. */
function resolveView(value: unknown): ViewDef | undefined {
	const raw = String(value ?? '')
		.trim()
		.toLowerCase()
	if (!raw) return undefined
	return VIEWS.find((v) => v.view === raw || v.aliases?.includes(raw))
}

/** The in-identity routing executor: navigate to the sub-view and return a spoken-style response. */
function executeNavigateViews(args: Record<string, unknown>, ctx: ToolContext): ToolDispatchResult {
	const def = resolveView(args.view)
	if (!def) {
		const got = String(args.view ?? '').trim()
		return { ok: false, message: t('identities.talk.navUnknown', { target: got || '?' }) }
	}
	if (!ctx.identityBase) return { ok: false, message: t('identities.talk.navNoIdentity') }
	navigateAppTo(`${ctx.identityBase}${def.subpath}`)
	const label = t(def.labelKey)
	return {
		ok: true,
		message: t('identities.talk.navigating', { target: label }),
		response: t('identities.talk.navOpening', { target: label }),
	}
}

// ───────────────────────────── create_todo ─────────────────────────────

/** The `create_todo` schema: the task text + the standard `response`. */
const CREATE_TODO_TOOL: ToolDef = {
	name: 'create_todo',
	description:
		"Add a new todo / task to the current identity's task list. Call this whenever the user asks " +
		'to add, create, note, remember, or jot down a task or todo.',
	parameters: {
		type: 'object',
		properties: {
			title: {
				type: 'string',
				description: "The task text — a short imperative phrase, in the user's language.",
			},
			...RESPONSE_PROP,
		},
		required: ['title', 'response'],
	},
}

/** The task-creation executor: add the todo to the active identity, return the outcome. */
async function executeCreateTodo(
	args: Record<string, unknown>,
	ctx: ToolContext,
): Promise<ToolDispatchResult> {
	const title = String(args.title ?? '').trim()
	if (!title) return { ok: false, message: t('identities.talk.todoEmpty') }
	if (!ctx.createTodo) return { ok: false, message: t('identities.talk.navNoIdentity') }
	try {
		await ctx.createTodo(title)
		return {
			ok: true,
			message: t('identities.talk.todoAdded', { title }),
			response: t('identities.talk.todoAddedReply', { title }),
		}
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) }
	}
}

// ───────────────────────────── tool registry ─────────────────────────────

const TOOLS: Record<string, ToolEntry> = {
	[NAVIGATE_VIEWS_TOOL.name]: { def: NAVIGATE_VIEWS_TOOL, execute: executeNavigateViews },
	[CREATE_TODO_TOOL.name]: { def: CREATE_TODO_TOOL, execute: executeCreateTodo },
}

/** The tools advertised to the model on every identity-agent generation. */
export const LLM_TOOLS: ToolDef[] = Object.values(TOOLS).map((e) => e.def)

/** Dispatch a tool call to its executor (the router). Unknown tools are surfaced, not thrown. */
export function executeToolCall(
	call: LlmToolCall,
	ctx: ToolContext,
): ToolDispatchResult | Promise<ToolDispatchResult> {
	const entry = TOOLS[call.name]
	if (!entry) return { ok: false, message: `⚠️ ${call.name}?` }
	return entry.execute(call.arguments ?? {}, ctx)
}

// ───────────────────────────── text fallback ─────────────────────────────

/** Navigation cue words (German + English), matched as case-insensitive substrings. */
const NAV_CUES = [
	'öffne', 'offne', 'zeig', 'geh', 'navig', 'wechsel', 'bring mich', 'wechsle', 'zur seite',
	'open', 'show', 'go to', 'goto', 'switch to', 'display', 'take me',
]

/**
 * Recover a navigation intent from free text — requires BOTH a navigation cue and a whole-word
 * view token. Run against the USER prompt (not the model reply) so the model's prose can't
 * trigger a false navigation. Returns the first matching view.
 */
function findViewInText(text: string): ViewDef | undefined {
	const lower = text.toLowerCase()
	if (!NAV_CUES.some((c) => lower.includes(c))) return undefined
	const words = new Set(lower.split(/[^\p{L}\p{N}-]+/u).filter(Boolean))
	for (const v of VIEWS) {
		const tokens = [v.view, ...(v.aliases ?? [])]
		for (const tok of tokens) {
			const hit = tok.includes(' ') || tok.includes('-') ? lower.includes(tok) : words.has(tok)
			if (hit) return v
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
 *      (a cheap safety net for a malformed real call like `view="{...}"`).
 *   3. Else, wrap the model's prose (or a fallback) as a `respond` call.
 */
export async function resolveAgentTurn(opts: {
	replyId: string
	userPrompt: string
	toolCall?: LlmToolCall
	prose: string
	ctx: ToolContext
}): Promise<ToolCallRecord> {
	const { replyId, userPrompt, toolCall, prose, ctx } = opts

	let failed: { name: string; args: Record<string, unknown>; exec: ToolDispatchResult } | undefined
	if (toolCall && TOOLS[toolCall.name]) {
		const exec = await executeToolCall(toolCall, ctx)
		if (exec.ok) return recordFrom(toolCall.name, toolCall.arguments, exec, false)
		// The call failed. Keep it: maybe it's a malformed nav call the prompt-fallback recovers
		// (e.g. the 1.2B nesting JSON into a field) — but if nothing recovers it, surface this
		// real failure rather than hide it behind a `respond` that falsely claims success.
		failed = { name: toolCall.name, args: toolCall.arguments, exec }
	}

	const def = findViewInText(userPrompt)
	if (def) {
		const exec = await executeToolCall(
			{ replyId, name: 'navigate_views', arguments: { view: def.view } },
			ctx,
		)
		// Carry the model's prose as the response if it wrote one, else the synthesized reply.
		const args = { view: def.view, response: String(toolCall?.arguments.response ?? '').trim() }
		return recordFrom('navigate_views', args, exec, true)
	}

	// A real tool call that genuinely failed (e.g. `create_todo` couldn't write the row) — show
	// the failure chip (tool name + error) instead of a misleading "Sure, done!" respond bubble.
	if (failed) return recordFrom(failed.name, failed.args, failed.exec, false)

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
