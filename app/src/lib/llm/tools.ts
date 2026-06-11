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

// ───────────────────────────── todos (generic CRUD) ─────────────────────────────
//
// ONE tool for the whole task list (board 0021). The model picks an `action` and passes a
// BATCH of `items`; ids are never guessed app-side — the model reads them from a `list` call
// and copies them EXACTLY. No keyword/regex recovery on this path: structured arguments only.
// Advertised to the Tinfoil cloud model (which runs the agentic list→mutate loop), not the
// on-device 1.2B (it can't reliably emit nested JSON arrays).

/** The generic `todos` schema: one action + a batch of items + the standard `response`. */
const TODOS_TOOL: ToolDef = {
	name: 'todos',
	description:
		"Query and modify the current identity's todo list — the ONE tool for all task operations. " +
		"Actions: 'list' returns every todo with its exact id, title and done state; " +
		"'create' adds the given items (each needs a title); " +
		"'update' edits the given items by id (new title and/or done — set done true to complete, " +
		"false to reopen); 'delete' removes the given items by id. " +
		'Batch freely: pass several entries in `items` to act on many todos in one call. ' +
		"ALWAYS call 'list' first to get the real ids before updating or deleting.",
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['list', 'create', 'update', 'delete'],
				description: 'What to do with the todo list.'
			},
			items: {
				type: 'array',
				description:
					'The todos to act on (ignored for `list`). create: {title}; update: {id, title? and/or done?}; delete: {id}.',
				items: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description: 'The EXACT id of an existing todo, copied from a `list` result.'
						},
						title: {
							type: 'string',
							description: "The task text — a short imperative phrase, in the user's language."
						},
						done: { type: 'boolean', description: 'Whether the task is completed.' }
					}
				}
			},
			...RESPONSE_PROP
		},
		required: ['action', 'response']
	}
}

/** One entry of the model's `items` batch (all fields optional — validated per action). */
type TodoItemArg = { id?: unknown; title?: unknown; done?: unknown }

/** Human summary for a completed batch: singular keys for one item, plural for several. */
function todosSummary(
	action: 'create' | 'update' | 'delete',
	titles: string[]
): { message: string; response: string } {
	const base = { create: 'todoAdded', update: 'todoUpdated', delete: 'todoDeleted' }[action]
	if (titles.length === 1) {
		return {
			message: t(`identities.talk.${base}`, { title: titles[0] }),
			response: t(`identities.talk.${base}Reply`, { title: titles[0] })
		}
	}
	const params = { count: titles.length, titles: titles.join(', ') }
	const plural = base.replace('todo', 'todos')
	return {
		message: t(`identities.talk.${plural}`, params),
		response: t(`identities.talk.${plural}Reply`, params)
	}
}

/**
 * The generic todos executor. `list` reads live rows and returns them as the machine-facing
 * `toolResult` (JSON) for the agent loop; mutations run the batch item-by-item, collecting
 * per-item errors instead of failing the whole call.
 */
async function executeTodos(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const action = String(args.action ?? '')
		.trim()
		.toLowerCase()
	const items = Array.isArray(args.items) ? (args.items as TodoItemArg[]) : []

	if (action === 'list') {
		const todos = ctx.listTodos()
		return {
			ok: true,
			message: t('identities.talk.todosListed', { count: todos.length }),
			toolResult: JSON.stringify(todos)
		}
	}
	if (action !== 'create' && action !== 'update' && action !== 'delete') {
		return {
			ok: false,
			message: t('identities.talk.todoNoChange'),
			toolResult: `unknown action: ${action || '?'}`
		}
	}
	if (items.length === 0) {
		return {
			ok: false,
			message: t('identities.talk.todoEmpty'),
			toolResult: `${action}: items is empty`
		}
	}

	const errors: string[] = []
	const titles: string[] = []
	for (const item of items) {
		try {
			if (action === 'create') {
				const title = String(item.title ?? '').trim()
				if (!title) {
					errors.push('create: missing title')
					continue
				}
				await ctx.createTodo(title)
				titles.push(title)
				continue
			}
			const id = String(item.id ?? '').trim()
			const target = ctx.resolveTodo(id)
			if (!target) {
				errors.push(`${action}: no todo with id "${id}"`)
				continue
			}
			if (action === 'delete') {
				await ctx.deleteTodoById(target.id)
			} else {
				const patch: { title?: string; done?: boolean } = {}
				const title = item.title === undefined ? '' : String(item.title).trim()
				if (title) patch.title = title
				if (typeof item.done === 'boolean') patch.done = item.done
				if (Object.keys(patch).length === 0) {
					errors.push(`update: nothing to change on "${id}"`)
					continue
				}
				await ctx.updateTodoById(target.id, patch)
			}
			titles.push(target.title)
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e))
		}
	}

	const toolResult = JSON.stringify({
		ok: errors.length === 0,
		action,
		changed: titles.length,
		errors
	})
	if (titles.length === 0) {
		return { ok: false, message: errors.join('; ') || t('identities.talk.todoEmpty'), toolResult }
	}
	const { message, response } = todosSummary(action, titles)
	return {
		ok: errors.length === 0,
		message: errors.length > 0 ? `${message} · ⚠️ ${errors.join('; ')}` : message,
		response,
		toolResult
	}
}

// ───────────────────────────── tool registry ─────────────────────────────

const TOOLS: Record<string, ToolEntry> = {
	[NAVIGATE_VIEWS_TOOL.name]: { def: NAVIGATE_VIEWS_TOOL, execute: executeNavigateViews },
	[TODOS_TOOL.name]: { def: TODOS_TOOL, execute: executeTodos }
}

/**
 * Tools advertised to the ON-DEVICE 1.2B model: navigation only. Todo CRUD is the generic,
 * batch `todos` tool (nested JSON arrays + an agentic list→mutate loop) — more than the 1.2B
 * can reliably emit — so it's reserved for the Tinfoil cloud model (see {@link CLOUD_TOOLS}).
 */
export const LLM_TOOLS: ToolDef[] = [NAVIGATE_VIEWS_TOOL]

/**
 * Tools advertised to the Tinfoil CLOUD model: navigation + the generic `todos` CRUD tool.
 * The cloud path runs a real tool loop, so the model calls `todos {action:"list"}` to learn
 * ids, then batches create/update/delete — no app-side id matching or keyword parsing.
 */
export const CLOUD_TOOLS: ToolDef[] = [NAVIGATE_VIEWS_TOOL, TODOS_TOOL]

/** Hard cap on the cloud agentic tool loop (list → mutate → reply) so one turn can't run away. */
export const MAX_TOOL_ROUNDS = 5

/** System prompt for the cloud agent: act via tools, query before mutating, reply concisely. */
export const CLOUD_SYSTEM_PROMPT =
	'You are Aven, the assistant inside one identity. Fulfil the user request by calling the ' +
	'provided tools: use `navigate_views` to switch the open view, and `todos` to manage the task ' +
	'list. To edit or delete todos you MUST first call `todos` with action "list" to get the real ' +
	'ids, then call `todos` again with the exact ids. Batch related changes into one call. When ' +
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
