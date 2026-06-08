/**
 * On-device LLM tool registry. The single source of truth for the tools the LFM2.5 agent
 * may call from the Talk chat. Today there is one: `navigate_pages`, which moves the app to
 * one of its main routes. Tool *schemas* (sent to the model in the prompt) and tool *execution*
 * (run in the webview) both live here, so adding a tool is a one-file change.
 *
 * Flow (single-turn): the model emits a tool call → the Rust engine parses it and emits an
 * `llm:tool-call` event → `streamReply` forwards it to `executeToolCall`, which performs the
 * side effect (navigation) and returns a short confirmation for the chat bubble.
 */

import { navigateAppTo } from '$lib/shell'

/** Payload of the `llm:tool-call` event (see `app/src-tauri/src/llm.rs`). */
export type LlmToolCall = {
	replyId: string
	name: string
	arguments: Record<string, unknown>
}

/** A JSON-Schema-ish tool definition, shaped for the LFM2 tool list in the prompt. */
export type ToolDef = {
	name: string
	description: string
	parameters: Record<string, unknown>
}

/** A navigable destination: the enum value the model picks, the actual href, and a label. */
type RouteDef = {
	/** The enum value advertised to the model (kept short + lowercase). */
	route: string
	/** Where `navigateAppTo` sends the app. */
	href: string
	/** Human label for the confirmation bubble. */
	label: string
	/** Extra words the model might emit for this route (matched case-insensitively). */
	aliases?: string[]
}

/** The core route set. Extend here to teach the agent new destinations. */
const ROUTES: RouteDef[] = [
	{ route: 'intent', href: '/', label: 'Intent', aliases: ['intents', 'home', 'start'] },
	{ route: 'identities', href: '/identities', label: 'Identitäten', aliases: ['identity', 'identitaeten'] },
	{ route: 'settings', href: '/settings/identity', label: 'Einstellungen', aliases: ['settings', 'einstellung'] },
	{ route: 'models', href: '/settings/models', label: 'Modelle', aliases: ['model', 'modell'] },
	{ route: 'network', href: '/settings/network', label: 'Netzwerk', aliases: ['netzwerk'] },
	{ route: 'todos', href: '/todos', label: 'Todos', aliases: ['tasks', 'aufgaben'] },
	{ route: 'board', href: '/board', label: 'Board' },
	{ route: 'docs', href: '/docs', label: 'Docs', aliases: ['documentation', 'dokumentation'] },
	{ route: 'dreams', href: '/dreams', label: 'Dreams', aliases: ['träume', 'traeume'] },
]

/** The `navigate_pages` tool, with the route enum + a label hint baked into the description. */
const NAVIGATE_TOOL: ToolDef = {
	name: 'navigate_pages',
	description:
		'Navigate the app to one of its main pages. Call this whenever the user asks to open, ' +
		'go to, show, or switch to a section of the app. Available pages: ' +
		ROUTES.map((r) => `${r.route} (${r.label})`).join(', ') +
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

/** The tools advertised to the model on every Talk generation. */
export const LLM_TOOLS: ToolDef[] = [NAVIGATE_TOOL]

export type ToolDispatchResult = { ok: boolean; message: string }

/** Resolve a model-emitted route value (or alias) to its [`RouteDef`], case-insensitively. */
function resolveRoute(value: unknown): RouteDef | undefined {
	const raw = String(value ?? '')
		.trim()
		.toLowerCase()
	if (!raw) return undefined
	return ROUTES.find((r) => r.route === raw || r.aliases?.includes(raw))
}

/**
 * Execute a tool call the model made. Returns a short confirmation/error for the chat bubble.
 * Navigation is a terminal side effect — there is no round-trip back into the model.
 */
export function executeToolCall(call: LlmToolCall): ToolDispatchResult {
	if (call.name !== 'navigate_pages') {
		return { ok: false, message: `⚠️ Unbekanntes Tool: ${call.name}` }
	}
	const def = resolveRoute(call.arguments?.route)
	if (!def) {
		const got = String(call.arguments?.route ?? '').trim()
		return { ok: false, message: `⚠️ Unbekannte Seite${got ? `: ${got}` : ''}` }
	}
	navigateAppTo(def.href)
	return { ok: true, message: `→ Öffne ${def.label}` }
}
