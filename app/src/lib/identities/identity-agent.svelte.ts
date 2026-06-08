/**
 * Identity-wide agent runtime. Created ONCE by the identity layout and shared with every
 * sub-view (talk, todos, files, …) via Svelte context, so the intent bar is identity-wide:
 * a submit from any view creates the user message, streams the on-device LFM2.5 reply, resolves
 * the turn into a single tool-call record (navigate within the identity, add a todo, or respond),
 * and persists it. The talk view renders the live `streaming` text + thread; other views render
 * the transient `lastReply` chip in place (the agent acts without yanking you to talk).
 *
 * Lives in `.svelte.ts` so it can hold runes (`$state`). `jazzStore` is NOT called here (it needs
 * component init for ref-counting) — the layout passes its already-mounted stores in.
 */

import { getContext, setContext } from 'svelte'
import type { JazzStore } from '$lib/jazz/store.svelte'
import { persistSparkFiles } from '$lib/jazz/intent-files'
import { streamReply } from '$lib/llm/generate'
import {
	LLM_TOOLS,
	encodeToolCallBody,
	resolveAgentTurn,
	type LlmToolCall,
	type ToolCallRecord,
	type ToolContext,
} from '$lib/llm/tools'

/** Deterministic author DID for on-device agent replies (role-tagged in the row). */
const AGENT_DID = 'did:aven:agent:lfm2'

/** How long the floating reply chip lingers on non-talk views before auto-dismissing. */
const FLOATING_REPLY_MS = 9000

const CONTEXT_KEY = Symbol('identity-agent')

/**
 * Live, reactive view of the active identity, read fresh inside each turn so the runtime always
 * acts on the current identity / session even as the user navigates between sub-views.
 */
export type IdentityAgentEnv = {
	canonicalSparkId: string
	identityBase: string
	authorDid: string | undefined
	tauri: boolean
	unlocked: boolean
}

export type IdentityAgent = {
	/** Per-reply-id live token buffer (rendered as the streaming bubble body on talk). */
	readonly streaming: Record<string, string>
	/** Row id of the reply currently streaming, or undefined. */
	readonly streamingId: string | undefined
	/** The most recent resolved turn, for the transient floating chip on non-talk views. */
	readonly lastReply: ToolCallRecord | undefined
	/** Last submit/agent error (file persist failure, generation error, …). */
	readonly err: string | undefined
	/** True while a submit is in flight. */
	readonly busy: boolean
	/** Submit an intent (text + optional files) from any identity sub-view. */
	submit(message: string, files: File[]): Promise<void>
	/** Dismiss the floating reply chip. */
	dismissReply(): void
	/** Surface an error (e.g. a transcription failure from the composer). */
	setErr(message: string): void
	/** Clear the current error. */
	clearErr(): void
}

/**
 * Build the runtime. `env()` is a getter so methods read the LIVE identity/session at call time.
 */
export function createIdentityAgent(deps: {
	messages: JazzStore
	todos: JazzStore
	env: () => IdentityAgentEnv
}): IdentityAgent {
	let streaming = $state<Record<string, string>>({})
	let streamingId = $state<string | undefined>(undefined)
	let lastReply = $state<ToolCallRecord | undefined>(undefined)
	let err = $state<string | undefined>(undefined)
	let busy = $state(false)
	let dismissTimer: ReturnType<typeof setTimeout> | undefined

	function showFloating(rec: ToolCallRecord): void {
		lastReply = rec
		if (dismissTimer) clearTimeout(dismissTimer)
		dismissTimer = setTimeout(() => {
			lastReply = undefined
		}, FLOATING_REPLY_MS)
	}

	/**
	 * Create an empty agent row, stream LFM2.5 tokens into `streaming[id]`, then resolve the turn
	 * into one tool-call record (executing its side effect) and persist it as the row body.
	 */
	async function replyWithAgent(prompt: string): Promise<void> {
		const env = deps.env()
		if (!env.canonicalSparkId) return
		let replyId: string | undefined
		try {
			const reply = await deps.messages.create({
				owner: env.canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: AGENT_DID,
				role: 'agent',
				body: '',
			})
			replyId = reply.id
			streamingId = reply.id
			streaming = { ...streaming, [reply.id]: '' }
			// The agent is tool-call-only. Capture any real `<|tool_call_start|>` call and the
			// streamed prose, then resolve the turn into exactly one tool-call record (executing
			// the side effect). The chip is what's persisted + rendered — never bare prose.
			let capturedCall: LlmToolCall | undefined
			const full = await streamReply(
				prompt,
				reply.id,
				(piece) => {
					// Reassign (not mutate) so the talk view's liveBody const re-derives reliably.
					streaming = { ...streaming, [reply.id]: (streaming[reply.id] ?? '') + piece }
				},
				{
					tools: LLM_TOOLS,
					onToolCall: (call) => (capturedCall = call),
				},
			)
			const ctx: ToolContext = {
				identityBase: env.identityBase,
				createTodo: async (title) => {
					await deps.todos.create({ title, done: false, owner: env.canonicalSparkId })
				},
			}
			const record = await resolveAgentTurn({
				replyId: reply.id,
				userPrompt: prompt,
				toolCall: capturedCall,
				prose: full,
				ctx,
			})
			const body = encodeToolCallBody(record)
			streaming = { ...streaming, [reply.id]: body }
			await deps.messages.update(reply.id, { body })
			showFloating(record)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (replyId) {
				await deps.messages.update(replyId, { body: `⚠️ ${msg}` }).catch(() => {})
			} else {
				err = msg
			}
		} finally {
			if (replyId) {
				const { [replyId]: _drop, ...rest } = streaming
				streaming = rest
			}
			streamingId = undefined
		}
	}

	async function submit(message: string, files: File[]): Promise<void> {
		const env = deps.env()
		const body = message.trim()
		const did = env.authorDid?.trim()
		if (
			(!body && files.length === 0) ||
			!did ||
			!env.tauri ||
			!env.unlocked ||
			!env.canonicalSparkId ||
			busy
		) {
			return
		}
		busy = true
		err = undefined
		try {
			const row = await deps.messages.create({
				owner: env.canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: did,
				role: 'user',
				body,
			})
			if (files.length > 0) {
				const { stored, errors } = await persistSparkFiles(row.id, files, {
					identityId: env.canonicalSparkId,
				})
				if (errors.length > 0) {
					err =
						stored > 0
							? `Message sent; ${stored} file(s) saved. ${errors.join('; ')}`
							: `Message sent but files failed: ${errors.join('; ')}`
				}
			}
			// Fire the on-device agent reply (text-only prompts for now).
			if (body) await replyWithAgent(body)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	return {
		get streaming() {
			return streaming
		},
		get streamingId() {
			return streamingId
		},
		get lastReply() {
			return lastReply
		},
		get err() {
			return err
		},
		get busy() {
			return busy
		},
		submit,
		dismissReply() {
			lastReply = undefined
			if (dismissTimer) clearTimeout(dismissTimer)
		},
		setErr(message: string) {
			err = message
		},
		clearErr() {
			err = undefined
		},
	}
}

/** Publish the runtime to descendant sub-views. Call from the identity layout `<script>`. */
export function setIdentityAgent(agent: IdentityAgent): IdentityAgent {
	setContext(CONTEXT_KEY, agent)
	return agent
}

/** Read the identity-wide agent runtime from a descendant sub-view. */
export function getIdentityAgent(): IdentityAgent {
	const agent = getContext<IdentityAgent | undefined>(CONTEXT_KEY)
	if (!agent) throw new Error('getIdentityAgent: no IdentityAgent in context')
	return agent
}
