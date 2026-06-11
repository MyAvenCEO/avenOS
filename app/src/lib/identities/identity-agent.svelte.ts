/**
 * Identity-wide agent runtime. Created ONCE by the identity layout and shared with every
 * sub-view (talk, todos, files, …) via Svelte context, so the intent bar is identity-wide:
 * a submit from any view creates the user message, streams the on-device LFM2.5 reply, resolves
 * the turn into a single tool-call record (navigate within the identity, add a todo, or respond),
 * and persists it. The talk view renders the live `streaming` text + thread; other views render
 * the transient `lastReply` chip in place (the agent acts without yanking you to talk).
 *
 * Lives in `.svelte.ts` so it can hold runes (`$state`). `avenDbStore` is NOT called here (it needs
 * component init for ref-counting) — the layout passes its already-mounted stores in.
 */

import { getContext, setContext } from 'svelte'
import type { AvenDbStore } from '$lib/avendb/store.svelte'
import { persistSparkFiles } from '$lib/avendb/intent-files'
import { brainIngest } from '$lib/brain/api'
import { tinfoilAvailable, tinfoilChat } from '$lib/llm/generate'
import {
	CLOUD_SYSTEM_PROMPT,
	CLOUD_TOOLS,
	MAX_TOOL_ROUNDS,
	cloudToolRecord,
	encodeToolCallBody,
	executeToolCall,
	respondRecord,
	toOpenAiTools,
	type ToolCallRecord,
	type ToolContext,
	type ToolDispatchResult,
} from '$lib/llm/tools'
// PURE-CLOUD MODE (board 0022): the on-device LFM + brain-recall reply path is disabled — see
// the commented `replyWithAgent` block below. To restore local mode, re-add these imports:
//   import { brainAssembleContext } from '$lib/brain/api'
//   import { avenDbTable } from '$lib/avendb/api'
//   import { streamReply } from '$lib/llm/generate'
//   import { LLM_TOOLS, resolveAgentTurn, type LlmToolCall } from '$lib/llm/tools'

/** Deterministic author DID for on-device agent replies (role-tagged in the row). */
const AGENT_DID = 'did:aven:agent:lfm2'

/** How long the floating reply chip lingers on non-talk views before auto-dismissing. */
const FLOATING_REPLY_MS = 9000

const CONTEXT_KEY = Symbol('identity-agent')

/** Case-insensitive owner-id equality (todos are scoped to the active identity). */
function idsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
	const na = (a ?? '').trim().toLowerCase()
	const nb = (b ?? '').trim().toLowerCase()
	return na !== '' && na === nb
}

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
	messages: AvenDbStore
	todos: AvenDbStore
	env: () => IdentityAgentEnv
}): IdentityAgent {
	let streaming = $state<Record<string, string>>({})
	let streamingId = $state<string | undefined>(undefined)
	let lastReply = $state<ToolCallRecord | undefined>(undefined)
	let err = $state<string | undefined>(undefined)
	let busy = $state(false)
	let dismissTimer: ReturnType<typeof setTimeout> | undefined
	// Whether the Tinfoil cloud path is usable (feature compiled + `TINFOIL_API_KEY` set).
	// Probed once on first reply and memoized — it can't change within an app run.
	let cloudReady: boolean | undefined

	function showFloating(rec: ToolCallRecord): void {
		lastReply = rec
		if (dismissTimer) clearTimeout(dismissTimer)
		dismissTimer = setTimeout(() => {
			lastReply = undefined
		}, FLOATING_REPLY_MS)
	}

	/**
	 * The per-turn tool execution context, reading the active identity's todos LIVE each call (so
	 * the cloud loop sees its own creates/deletes between rounds; `resolveTodo` validates the exact
	 * id the model copied from a `list` result). Shared by the local and cloud paths.
	 */
	function buildToolContext(env: IdentityAgentEnv): ToolContext {
		const mine = () =>
			deps.todos.rows
				.filter((r) => idsMatch(r.owner, env.canonicalSparkId))
				.map((r) => ({ id: String(r.id), title: String(r.title ?? ''), done: r.done === true }))
		return {
			identityBase: env.identityBase,
			listTodos: mine,
			createTodo: async (title) => {
				await deps.todos.create({ title, done: false, owner: env.canonicalSparkId })
			},
			resolveTodo: (id) => mine().find((todo) => todo.id === String(id).trim()),
			updateTodoById: async (id, patch) => {
				await deps.todos.update(id, patch)
			},
			deleteTodoById: async (id) => {
				await deps.todos.delete(id)
			},
		}
	}

	/** Persist a resolved turn as the agent row body (chip JSON), surface it, and ingest the prose. */
	async function persistRecord(
		env: IdentityAgentEnv,
		replyId: string,
		record: ToolCallRecord,
	): Promise<void> {
		const body = encodeToolCallBody(record)
		streaming = { ...streaming, [replyId]: body }
		await deps.messages.update(replyId, { body })
		if (record.response) {
			void brainIngest(env.canonicalSparkId, record.response, {
				stream: 'talk',
				authorRole: 'agent',
				source: replyId,
				contentDateMs: Date.now(),
				veracity: 'inferred',
			}).catch(() => {})
		}
		showFloating(record)
	}

	/**
	 * The Tinfoil cloud agent loop: drive the generic `todos` CRUD + navigation via real
	 * OpenAI-style tool calls. Each round runs the returned tool calls against avenDB, appends the
	 * assistant turn + `role:"tool"` results, and re-calls — so the model can `list` todos to learn
	 * ids, then batch update/delete. Capped at {@link MAX_TOOL_ROUNDS}; the last meaningful tool
	 * call (or the final prose) becomes the one persisted {@link ToolCallRecord}. Progress shows in
	 * the live streaming bubble. No regex/keyword parsing — structured tool arguments only.
	 */
	async function runCloudLoop(
		prompt: string,
		replyId: string,
		ctx: ToolContext,
	): Promise<ToolCallRecord> {
		const messages: unknown[] = [
			{ role: 'system', content: CLOUD_SYSTEM_PROMPT },
			{ role: 'user', content: prompt },
		]
		const tools = toOpenAiTools(CLOUD_TOOLS)
		let last:
			| { name: string; args: Record<string, unknown>; exec: ToolDispatchResult }
			| undefined

		const finalize = (reply: string): ToolCallRecord =>
			last ? cloudToolRecord(last.name, last.args, last.exec, reply) : respondRecord(reply)

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			const turn = await tinfoilChat(messages, tools)
			if (!turn.toolCalls || turn.toolCalls.length === 0) return finalize(turn.content ?? '')

			messages.push(turn.assistantRaw) // verbatim — carries the tool_call ids
			for (const call of turn.toolCalls) {
				const args =
					call.arguments && typeof call.arguments === 'object'
						? (call.arguments as Record<string, unknown>)
						: {}
				const exec = await executeToolCall({ replyId, name: call.name, arguments: args }, ctx)
				last = { name: call.name, args, exec }
				streaming = { ...streaming, [replyId]: exec.message } // live progress line
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: exec.toolResult ?? exec.message,
				})
			}
		}
		// Round cap reached — force a final no-tools reply so the user always gets a sentence.
		const turn = await tinfoilChat(messages, [])
		return finalize(turn.content ?? '')
	}

	/**
	 * Create an empty agent row, produce one tool-call record (executing its side effect), and
	 * persist it as the row body. PURE-CLOUD MODE (board 0022): EVERY LLM request goes to the
	 * Tinfoil cloud agent (navigation + `todos` CRUD). The on-device LFM2.5 stream and the
	 * brain-recall structured reply are disabled for now — preserved in the commented block below
	 * so local mode can be restored by uncommenting it (and re-adding the imports listed up top).
	 */
	async function replyWithAgent(prompt: string, _userRowId?: string): Promise<void> {
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

			const ctx = buildToolContext(env)

			// Probe cloud availability once, then memoize for the app run.
			if (cloudReady === undefined) cloudReady = await tinfoilAvailable()
			if (!cloudReady) {
				// Pure-cloud mode with no key: there is no local fallback (disabled). Surface it.
				await persistRecord(
					env,
					reply.id,
					respondRecord('Cloud AI is unavailable — set TINFOIL_API_KEY to enable Aven.'),
				)
				return
			}
			const record = await runCloudLoop(prompt, reply.id, ctx)
			await persistRecord(env, reply.id, record)

			/* ───────────────── DISABLED: on-device LFM + brain-recall fallback ─────────────────
			 * Restore local mode by uncommenting this block and re-adding the imports listed at the
			 * top of the file. It runs the brain-recall structured reply, then the local LFM2.5
			 * tool-call stream (navigation only). Replace the `if (!cloudReady) {…} runCloudLoop`
			 * lines above with `if (cloudReady) { runCloudLoop; return }` to make it the fallback.
			 *
			 * // E4: the brain is the context manager — assembled, budgeted, traced.
			 * const assembled = await brainAssembleContext(env.canonicalSparkId, prompt, {
			 * 	stream: 'talk',
			 * }).catch(() => undefined)
			 * const brainPrefix = assembled?.prompt ? `${assembled.prompt}\n\n` : ''
			 * // E4 (brain-recall mode): deterministic structured RECALL, no conversational LLM.
			 * if (assembled) {
			 * 	const t = assembled.trace
			 * 	const lines: string[] = [
			 * 		`🧠 stored · found ${t.recalled.length} related, ${t.entities.length} entities`,
			 * 	]
			 * 	for (const r of t.recalled.slice(0, 5)) lines.push(`• ${r.snippet} (${r.via})`)
			 * 	if (t.entities.length > 0) lines.push(`↳ ${t.entities.map((e) => e.name).join(' · ')}`)
			 * 	const recallBody = lines.join('\n')
			 * 	streaming = { ...streaming, [reply.id]: recallBody }
			 * 	await deps.messages.update(reply.id, { body: recallBody })
			 * 	if (_userRowId) {
			 * 		void avenDbTable('context_traces')
			 * 			.create({
			 * 				owner: env.canonicalSparkId,
			 * 				message_id: _userRowId,
			 * 				reply_id: reply.id,
			 * 				trace: JSON.stringify(t),
			 * 				created_at_ms: Date.now(),
			 * 			})
			 * 			.catch(() => {})
			 * 	}
			 * 	return
			 * }
			 * // Tool-call-only on-device stream (navigation).
			 * let capturedCall: LlmToolCall | undefined
			 * const full = await streamReply(
			 * 	brainPrefix + prompt,
			 * 	reply.id,
			 * 	(piece) => {
			 * 		streaming = { ...streaming, [reply.id]: (streaming[reply.id] ?? '') + piece }
			 * 	},
			 * 	{ tools: LLM_TOOLS, onToolCall: (call) => (capturedCall = call) },
			 * )
			 * const record = await resolveAgentTurn({
			 * 	replyId: reply.id,
			 * 	userPrompt: prompt,
			 * 	toolCall: capturedCall,
			 * 	prose: full,
			 * 	ctx,
			 * })
			 * await persistRecord(env, reply.id, record)
			 * ──────────────────────────────────────────────────────────────────────────────── */
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
			// E3: the brain reads along — fire-and-forget, never blocks the talk loop.
			if (body) {
				void brainIngest(env.canonicalSparkId, body, {
					stream: 'talk',
					authorRole: 'user',
					source: row.id,
					contentDateMs: Date.now(),
					veracity: 'stated',
				}).catch((e) =>
					console.error('[brain] ingest failed:', e instanceof Error ? e.message : e),
				)
			}
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
			if (body) await replyWithAgent(body, row.id)
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
