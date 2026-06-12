/**
 * On-device LLM tool layer for the identity intent bar. The agent is tool-call-only: every turn
 * resolves to a tool call (never bare prose). Concerns, one file:
 *
 *   1. SCHEMAS  — standard function-calling JSON Schema per tool. EVERY tool carries a standard
 *                 `response` field: a short, human-facing reply (in the user's language) that we
 *                 render as the bubble text and can speak via the TTS model.
 *   2. ROUTER   — `executeToolCall` dispatches a call by name to its executor (the side effect),
 *                 passing a per-turn {@link ToolContext} (the active identity + its mutations).
 *                 `navigate_views` → in-identity routing; `todos` → the generic task CRUD.
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
import { MEMORY_TOOL_DEFS, MEMORY_TOOL_EXECUTORS } from './memory-tools'
import { VIBE_TOOL_DEFS, VIBE_TOOL_EXECUTORS } from './vibe-tools'

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
	/** The active identity's canonical id (its SAFE) — the memory tools' brain scope. */
	identityId: string
	/** Read the active identity's todos LIVE (id + title + done) — the `todos` list action. */
	listTodos: () => { id: string; title: string; done: boolean }[]
	/** Add a todo to the active identity's task list. Resolves on success, throws on failure. */
	createTodo: (title: string) => Promise<void>
	/**
	 * Resolve an id the model copied from a todo list it was shown (a prior `list` result) to the
	 * real row. The model selects the id; no app-side title matching. Undefined if the id is gone.
	 */
	resolveTodo: (id: string) => { id: string; title: string; done: boolean } | undefined
	/** Patch a todo by its real id (title and/or done). Resolves on success, throws on failure. */
	updateTodoById: (id: string, patch: { title?: string; done?: boolean }) => Promise<void>
	/** Remove a todo by its real id. Resolves on success, throws on failure. */
	deleteTodoById: (id: string) => Promise<void>
}

/**
 * Outcome of executing a tool call's side effect. `message` is the human-facing result line;
 * `toolResult` (when set) is the MACHINE-facing content sent back to the model as the
 * `role:"tool"` message on the cloud agent loop (e.g. the JSON todo list for `list`).
 */
export type ToolDispatchResult = {
	ok: boolean
	message: string
	response?: string
	toolResult?: string
}

/** A tool executor: receives the (parsed) arguments + the turn context, performs the side effect. */
type ToolExecutor = (
	args: Record<string, unknown>,
	ctx: ToolContext
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
			"'Ich öffne die Aufgaben für dich.'. This is shown and spoken back to the user."
	}
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
	{
		view: 'talk',
		subpath: '/talk',
		labelKey: 'nav.talk',
		desc: 'Talk — chat with the identity agent',
		aliases: ['chat', 'message', 'messages', 'nachricht', 'nachrichten', 'gespräch']
	},
	{
		view: 'todos',
		subpath: '/todos',
		labelKey: 'nav.todos',
		desc: 'Todos — the identity task list',
		aliases: ['todo', 'task', 'tasks', 'aufgabe', 'aufgaben']
	},
	{
		view: 'files',
		subpath: '/gallery',
		labelKey: 'nav.gallery',
		desc: 'Files — media & files gallery',
		aliases: ['file', 'gallery', 'galerie', 'media', 'medien', 'datei', 'dateien']
	},
	{
		view: 'members',
		subpath: '/members',
		labelKey: 'nav.members',
		desc: 'Members — people with access',
		aliases: ['member', 'people', 'mitglied', 'mitglieder', 'leute']
	},
	{
		view: 'db',
		subpath: '/db',
		labelKey: 'nav.db',
		desc: 'DB — raw table explorer',
		aliases: ['database', 'datenbank', 'table', 'tables', 'tabelle', 'tabellen']
	}
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
				description: 'Which sub-view to open.'
			},
			...RESPONSE_PROP
		},
		required: ['view', 'response']
	}
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
		response: t('identities.talk.navOpening', { target: label })
	}
}

// ───────────────────────────── tool registry ─────────────────────────────

// The registry = navigation (host-owned) + every VIBE-owned tool (schema from the vibe's
// `tools.json`, executor = the host applier that runs the vibe's sandboxed planner — see
// `vibe-tools.ts`). This is the seam where dynamically-loaded vibes contribute agent tools.
const TOOLS: Record<string, ToolEntry> = {
	[NAVIGATE_VIEWS_TOOL.name]: { def: NAVIGATE_VIEWS_TOOL, execute: executeNavigateViews },
	...Object.fromEntries(
		VIBE_TOOL_DEFS.map((def) => [
			def.name,
			{
				def,
				execute: (args: Record<string, unknown>, ctx: ToolContext) =>
					VIBE_TOOL_EXECUTORS[def.name](args, ctx)
			}
		])
	),
	// The agentic memory surface (board 0025): deliberate remember/recall/link/attest/
	// forget over the identity's brain — executors in `memory-tools.ts`.
	...Object.fromEntries(
		MEMORY_TOOL_DEFS.map((def) => [
			def.name,
			{
				def,
				execute: (args: Record<string, unknown>, ctx: ToolContext) =>
					MEMORY_TOOL_EXECUTORS[def.name](args, ctx)
			}
		])
	)
}

/**
 * Tools advertised to the ON-DEVICE 1.2B model: navigation only. Vibe CRUD tools (nested JSON
 * arrays + an agentic list→mutate loop) are more than the 1.2B can reliably emit, so they're
 * reserved for the Tinfoil cloud model (see {@link CLOUD_TOOLS}).
 */
export const LLM_TOOLS: ToolDef[] = [NAVIGATE_VIEWS_TOOL]

/**
 * Tools advertised to the Tinfoil CLOUD model: navigation + every vibe-owned tool. The cloud path
 * runs a real tool loop, so the model can call `todos {action:"list"}` to learn ids, then batch
 * create/update/delete — the schema + decision logic live in the vibe, not here.
 */
export const CLOUD_TOOLS: ToolDef[] = [NAVIGATE_VIEWS_TOOL, ...VIBE_TOOL_DEFS, ...MEMORY_TOOL_DEFS]

/** Hard cap on the cloud agentic tool loop (list → mutate → reply) so one turn can't run away. */
export const MAX_TOOL_ROUNDS = 5

/** System prompt for the cloud agent: act via tools, query before mutating, reply concisely. */
export const CLOUD_SYSTEM_PROMPT =
	'You are Aven, the assistant inside one identity. Fulfil the user request by calling the ' +
	'provided tools: use `navigate_views` to switch the open view, and `todos` to manage the task ' +
	'list. To edit or delete todos you MUST first call `todos` with action "list" to get the real ' +
	'ids, then call `todos` again with the exact ids. Batch related changes into one call. ' +
	'You also have a deliberate memory: routine chat is stored automatically, so call ' +
	'`memory_remember` only for durable facts, preferences, and decisions you would want in a ' +
	'future session ("would I want this next session?") — choose an importance (0..1) and ' +
	'veracity. When the context above does not contain the answer, or the user asks what you ' +
	'remember, search deeper with `memory_recall`; use the returned ids with `memory_link` ' +
	'(relate two memories), `memory_attest` (mark one as proven true), and `memory_forget` ' +
	'(ONLY when the user explicitly asks to forget — they will be asked to confirm). When ' +
	"the task is done, reply with a short, friendly sentence in the user's language."

/** Map our {@link ToolDef}s onto the OpenAI `tools` array shape the Tinfoil SDK expects. */
export function toOpenAiTools(defs: ToolDef[]): unknown[] {
	return defs.map((d) => ({
		type: 'function',
		function: { name: d.name, description: d.description, parameters: d.parameters }
	}))
}

/** Dispatch a tool call to its executor (the router). Unknown tools are surfaced, not thrown. */
export function executeToolCall(
	call: LlmToolCall,
	ctx: ToolContext
): ToolDispatchResult | Promise<ToolDispatchResult> {
	const entry = TOOLS[call.name]
	if (!entry) return { ok: false, message: `⚠️ ${call.name}?` }
	return entry.execute(call.arguments ?? {}, ctx)
}

// ───────────────────────────── text fallback ─────────────────────────────

/** Navigation cue words (German + English), matched as case-insensitive substrings. */
const NAV_CUES = [
	'öffne',
	'offne',
	'zeig',
	'geh',
	'navig',
	'wechsel',
	'bring mich',
	'wechsle',
	'zur seite',
	'open',
	'show',
	'go to',
	'goto',
	'switch to',
	'display',
	'take me'
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
	inferred: boolean
): ToolCallRecord {
	const modelResponse = String(args.response ?? '').trim()
	return {
		kind: 'tool_call',
		name,
		arguments: args,
		response: modelResponse || exec.response || exec.message,
		result: exec.message,
		ok: exec.ok,
		inferred
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
			ctx
		)
		// Carry the model's prose as the response if it wrote one, else the synthesized reply.
		const args = { view: def.view, response: String(toolCall?.arguments.response ?? '').trim() }
		return recordFrom('navigate_views', args, exec, true)
	}

	// A real tool call that genuinely failed (e.g. `todos` couldn't write the row) — show the
	// failure chip (tool name + error) instead of a misleading "Sure, done!" respond bubble.
	if (failed) return recordFrom(failed.name, failed.args, failed.exec, false)

	return respondRecord(prose)
}

/** Wrap free text as a `respond` tool-call record (the agent is tool-call-only — prose is never
 *  shown bare). Used by the local prose fallback and the cloud loop's final reply. */
export function respondRecord(text: string): ToolCallRecord {
	const trimmed = text.trim()
	return {
		kind: 'tool_call',
		name: 'respond',
		arguments: { response: trimmed },
		response: trimmed || t('identities.talk.agentNoReply'),
		result: '',
		ok: true,
		inferred: false
	}
}

/**
 * Build a {@link ToolCallRecord} from an executed cloud tool call. The cloud loop persists one
 * record per turn (the last meaningful tool call), so the existing chip UI + TTS speak path work
 * unchanged. `response` prefers the model's final reply, else the record's own response.
 */
export function cloudToolRecord(
	name: string,
	args: Record<string, unknown>,
	exec: ToolDispatchResult,
	finalReply?: string
): ToolCallRecord {
	const rec = recordFrom(name, args, exec, false)
	const reply = (finalReply ?? '').trim()
	return reply ? { ...rec, response: reply } : rec
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
