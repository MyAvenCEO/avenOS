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
import { persistSparkFiles } from '$lib/avendb/intent-files'
import type { AvenDbStore } from '$lib/avendb/store.svelte'
import { brainAssembleContext, brainDoExtract, brainDreamStep, brainIngest } from '$lib/brain/api'
import {
	EMBED_MODEL_LABEL,
	embedDownloadFraction,
	embedState,
	startEmbedDownload
} from '$lib/embed/model-download-store'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'
import {
	activityBegin,
	activityEnd,
	activityFinish,
	activityStart,
	beginRoundtrip,
	dreamLogEnd,
	dreamLogStart,
	dreamLogStep,
	patchRoundtrip
} from '$lib/identities/talk-brain-roundtrip.svelte'
import { tinfoilAvailable, tinfoilChat } from '$lib/llm/generate'
import {
	CLOUD_SYSTEM_PROMPT,
	CLOUD_TOOLS,
	cloudToolRecord,
	encodeToolCallBody,
	executeToolCall,
	MAX_TOOL_ROUNDS,
	respondRecord,
	type ToolCallRecord,
	type ToolContext,
	type ToolDispatchResult,
	toOpenAiTools
} from '$lib/llm/tools'

// PURE-CLOUD MODE (board 0022): replies go to the Tinfoil cloud agent, now GROUNDED in the
// brain's auto-assembled context (see `submit` → `replyWithAgent` → `runCloudLoop`). The
// on-device LFM2.5 stream + brain-recall structured reply stay disabled — preserved in the
// commented block below. To restore local mode, re-add these imports:
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

/** Trim a tool result / reply to a one-line detail for the activity timeline. */
function snipActivity(s: string, n = 90): string {
	const one = s.replace(/\s+/g, ' ').trim()
	return one.length > n ? `${one.slice(0, n)}…` : one
}

/** One dream at a time across the app — a new turn's dream is skipped while one is running. */
let dreaming = false

/**
 * Drive the STEPPED dream to completion, streaming each phase into the dreaming log. Each step is a
 * separate avenDB-runtime turn, so reads (status polls, DB viewer) interleave between phases — the
 * dream never holds the runtime. Fire-and-forget; idempotent if skipped.
 */
async function runDreamLogged(identity: string): Promise<void> {
	if (dreaming) return
	dreaming = true
	dreamLogStart(identity)
	try {
		let cursor = 0
		for (let guard = 0; guard < 64; guard++) {
			const t0 = Date.now()
			const step = await brainDreamStep(identity, cursor)
			// extract_ready: the actor hands off to a non-actor IPC so the Tinfoil HTTP
			// call never blocks the actor mailbox (DB viewer, next message, etc.)
			if (step.phase === 'extract_ready') {
				dreamLogStep({ phase: 'extract_ready', label: 'Extracting facts (off-actor)…', count: 0, tokens: 0, ms: Date.now() - t0 })
				cursor = step.nextCursor
				// Fire extraction in background — don't await (actor is free for other msgs).
				brainDoExtract(identity)
					.then((es) =>
						dreamLogStep({
							phase: es.phase,
							label: es.label,
							count: es.count,
							tokens: es.tokens,
							ms: 0,
							entities: es.entities
						})
					)
					.catch((e) => dreamLogStep({ phase: 'error', label: String(e), count: 0, tokens: 0, ms: 0 }))
				continue
			}
			dreamLogStep({
				phase: step.phase,
				label: step.label,
				count: step.count,
				tokens: step.tokens,
				ms: Date.now() - t0
			})
			if (step.done) break
			cursor = step.nextCursor
		}
	} catch (e) {
		dreamLogStep({
			phase: 'error',
			label: e instanceof Error ? e.message : String(e),
			count: 0,
			tokens: 0,
			ms: 0
		})
	} finally {
		dreamLogEnd()
		dreaming = false
	}
}

/** Overall agent activity this turn — drives the live status strip above the intent button. */
export type AgentPhase = 'idle' | 'thinking' | 'tool'

/** One live tool-call badge: a pill that starts `running` and resolves to `done`/`error`. */
export type ToolBadge = {
	id: number
	/** The tool name (e.g. `navigate_views`, `todos`) — used for the icon/emoji. */
	name: string
	/** Human-facing line: the "running" verb while live, then the tool's result message. */
	label: string
	status: 'running' | 'done' | 'error'
}

/**
 * A destructive action awaiting explicit human sign-off (HITL). The cloud loop pauses and the
 * unified live-state renders an accept/cancel card before the action actually runs. Currently
 * only `todos delete` is gated.
 */
export type PendingConfirm = {
	action: 'delete'
	/** Human-readable titles of the todos that would be removed — shown in the confirm card. */
	titles: string[]
}

/** A short "running" label for a tool call before its result is known (in the user's language-ish). */
function runningLabel(name: string, args: Record<string, unknown>): string {
	if (name === 'navigate_views') {
		const view = String(args.view ?? '').trim()
		return view ? `Opening ${view}…` : 'Switching view…'
	}
	if (name === 'todos') {
		const action = String(args.action ?? '')
			.trim()
			.toLowerCase()
		return (
			{
				list: 'Reading todos…',
				create: 'Adding todos…',
				update: 'Updating todos…',
				delete: 'Removing todos…'
			}[action] ?? 'Working on todos…'
		)
	}
	return `${name}…`
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
	/** Overall agent activity this turn (idle / thinking / tool) — drives the live status strip. */
	readonly phase: AgentPhase
	/** Live tool-call badges for the current/last turn (running → done/error), newest last. */
	readonly toolBadges: ToolBadge[]
	/** A destructive action awaiting human sign-off (HITL), or undefined. Drives the confirm card. */
	readonly pendingConfirm: PendingConfirm | undefined
	/** Last submit/agent error (file persist failure, generation error, …). */
	readonly err: string | undefined
	/** True while a submit is in flight. */
	readonly busy: boolean
	/** Submit an intent (text + optional files) from any identity sub-view. */
	submit(message: string, files: File[]): Promise<void>
	/** Accept the pending HITL action — lets the gated tool call run. */
	confirmPending(): void
	/** Reject the pending HITL action — the gated tool call is skipped. */
	cancelPending(): void
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
	let phase = $state<AgentPhase>('idle')
	let toolBadges = $state<ToolBadge[]>([])
	let badgeSeq = 0
	let pendingConfirm = $state<PendingConfirm | undefined>(undefined)
	// Resolver for the in-flight HITL gate; called by confirm/cancel to un-block the cloud loop.
	let confirmResolver: ((accepted: boolean) => void) | undefined
	let err = $state<string | undefined>(undefined)
	let busy = $state(false)
	let dismissTimer: ReturnType<typeof setTimeout> | undefined
	// Whether the Tinfoil cloud path is usable (feature compiled + `TINFOIL_API_KEY` set).
	// Probed once on first reply and memoized — it can't change within an app run.
	let cloudReady: boolean | undefined

	/**
	 * Pause the cloud loop on a destructive action and await explicit human sign-off (HITL).
	 * Surfaces `pendingConfirm` (the live-state renders the accept/cancel card) and resolves to
	 * the human's choice. Settling clears the pending state so the strip returns to normal.
	 */
	function requestConfirm(p: PendingConfirm): Promise<boolean> {
		return new Promise((resolve) => {
			confirmResolver = resolve
			pendingConfirm = p
		})
	}
	function settleConfirm(accepted: boolean): void {
		const resolve = confirmResolver
		confirmResolver = undefined
		pendingConfirm = undefined
		resolve?.(accepted)
	}

	function showFloating(rec: ToolCallRecord): void {
		lastReply = rec
		if (dismissTimer) clearTimeout(dismissTimer)
		dismissTimer = setTimeout(() => {
			lastReply = undefined
			// The live badges linger alongside the reply chip, then clear together.
			toolBadges = []
		}, FLOATING_REPLY_MS)
	}

	/** Append a fresh `running` badge for a tool call; returns its id so the caller can resolve it. */
	function startToolBadge(name: string, args: Record<string, unknown>): number {
		const id = ++badgeSeq
		toolBadges = [...toolBadges, { id, name, label: runningLabel(name, args), status: 'running' }]
		return id
	}

	/** Resolve a tool badge to its outcome (result line + done/error), in place. */
	function finishToolBadge(id: number, label: string, ok: boolean): void {
		toolBadges = toolBadges.map((b) =>
			b.id === id ? { ...b, label, status: ok ? 'done' : 'error' } : b
		)
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
			identityId: env.canonicalSparkId,
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
			}
		}
	}

	/** Persist a resolved turn as the agent row body (chip JSON), surface it, and ingest the prose. */
	async function persistRecord(
		env: IdentityAgentEnv,
		replyId: string,
		record: ToolCallRecord
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
				veracity: 'inferred'
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
		context?: string
	): Promise<ToolCallRecord> {
		// The brain's auto-assembled context (L0 self · L1 gist · working window · live recall ·
		// entity cards) rides as a second system message — so the model answers WITH memory, not
		// from nothing. It's reassembled fresh every turn (no per-session/day summary): the closest
		// to realtime, fully-dynamic context management we can do.
		const messages: unknown[] = [{ role: 'system', content: CLOUD_SYSTEM_PROMPT }]
		if (context?.trim()) {
			messages.push({
				role: 'system',
				content: `What you remember (auto-assembled from memory — use it to ground your reply):\n\n${context}`
			})
		}
		messages.push({ role: 'user', content: prompt })
		const tools = toOpenAiTools(CLOUD_TOOLS)
		let last: { name: string; args: Record<string, unknown>; exec: ToolDispatchResult } | undefined

		const finalize = (reply: string): ToolCallRecord =>
			last ? cloudToolRecord(last.name, last.args, last.exec, reply) : respondRecord(reply)

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			phase = 'thinking'
			const llmId = activityBegin('llm', `Asking the cloud model (round ${round + 1})…`)
			const turn = await tinfoilChat(messages, tools)
			const nCalls = turn.toolCalls?.length ?? 0
			activityFinish(llmId, {
				label: `Model round ${round + 1}`,
				detail: nCalls > 0 ? `requested ${nCalls} tool call${nCalls === 1 ? '' : 's'}` : 'final reply'
			})
			if (!turn.toolCalls || turn.toolCalls.length === 0) {
				const reply = turn.content ?? ''
				if (reply.trim()) activityBegin('respond', 'Replied', snipActivity(reply))
				return finalize(reply)
			}

			messages.push(turn.assistantRaw) // verbatim — carries the tool_call ids
			phase = 'tool'
			for (const call of turn.toolCalls) {
				const args =
					call.arguments && typeof call.arguments === 'object'
						? (call.arguments as Record<string, unknown>)
						: {}

				// HITL gate: destructive actions do NOT run until the human accepts them — a
				// `todos delete` and a `memory_forget` (board 0025) both pause the loop, show
				// the accept/cancel card, and on cancel feed a "cancelled" result back to the
				// model (so it tells the user nothing was deleted) instead of executing.
				const isTodoDelete =
					call.name === 'todos' && String(args.action ?? '').toLowerCase() === 'delete'
				const isMemoryForget = call.name === 'memory_forget'
				if (isTodoDelete || isMemoryForget) {
					let titles: string[]
					if (isTodoDelete) {
						const items = Array.isArray(args.items) ? (args.items as { id?: unknown }[]) : []
						titles = items
							.map((it) => ctx.resolveTodo(String(it?.id ?? '').trim())?.title)
							.filter((tt): tt is string => !!tt)
					} else {
						titles = [`memory ${String(args.id ?? '').trim()}`]
					}
					const accepted = await requestConfirm({ action: 'delete', titles })
					if (!accepted) {
						const message = t('identities.talk.deleteCancelled')
						const badgeId = startToolBadge(call.name, args)
						finishToolBadge(badgeId, message, false)
						const exec: ToolDispatchResult = {
							ok: false,
							message,
							toolResult: JSON.stringify({ ok: false, action: 'delete', cancelled: true })
						}
						last = { name: call.name, args, exec }
						streaming = { ...streaming, [replyId]: message }
						messages.push({ role: 'tool', tool_call_id: call.id, content: exec.toolResult })
						continue
					}
				}

				const badgeId = startToolBadge(call.name, args) // live "running" pill
				const toolLabel = args.action ? `${call.name} · ${String(args.action)}` : call.name
				const actId = activityBegin('tool', toolLabel)
				const exec = await executeToolCall({ replyId, name: call.name, arguments: args }, ctx)
				finishToolBadge(badgeId, exec.message, exec.ok) // → done/error with the result line
				activityFinish(actId, {
					detail: snipActivity(exec.message),
					status: exec.ok ? 'done' : 'error'
				})
				last = { name: call.name, args, exec }
				streaming = { ...streaming, [replyId]: exec.message } // live progress line
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: exec.toolResult ?? exec.message
				})
			}
		}
		// Round cap reached — force a final no-tools reply so the user always gets a sentence.
		phase = 'thinking'
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
	async function replyWithAgent(
		prompt: string,
		_userRowId?: string,
		context?: string
	): Promise<void> {
		const env = deps.env()
		if (!env.canonicalSparkId) return
		let replyId: string | undefined
		try {
			const reply = await deps.messages.create({
				owner: env.canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: AGENT_DID,
				role: 'agent',
				body: ''
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
					respondRecord('Cloud AI is unavailable — set TINFOIL_API_KEY to enable Aven.')
				)
				return
			}
			const record = await runCloudLoop(prompt, reply.id, ctx, context)
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
		// Hard-block the turn until the on-device embedder is ready (board 0032). The brain NEVER
		// recalls on a stub — mixing fake (hashed bag-of-words) and real EmbeddingGemma vectors in
		// one store permanently corrupts recall. The first message triggers the model download (like
		// voice STT); the turn waits until it's loaded rather than degrading silently.
		if (env.tauri && body) {
			const emb = get(embedState)
			if (emb.status !== 'ready') {
				void startEmbedDownload()
				const frac = embedDownloadFraction(emb)
				const pct = frac == null ? '' : ` ${Math.round(frac * 100)}%`
				err =
					emb.status === 'error'
						? `Memory model failed to load: ${emb.error ?? 'unknown error'}. Retrying — send again shortly.`
						: `Preparing memory model${pct}… ${EMBED_MODEL_LABEL} is downloading. Your message will send once it's ready.`
				return
			}
		}
		busy = true
		err = undefined
		// Fresh status strip for this turn: clear the prior run's badges, show "thinking".
		toolBadges = []
		phase = 'thinking'
		try {
			const row = await deps.messages.create({
				owner: env.canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: did,
				role: 'user',
				body
			})
			// The brain is the context manager. Store the turn, then assemble the auto-managed
			// context (L0 self · L1 gist · working window · live recall · entity cards) — this both
			// drives the roundtrip aside AND grounds the LLM reply below. Reassembled fresh every
			// turn (no per-session/day summary): realtime, fully-dynamic context. Best-effort —
			// any brain error falls back to a context-free reply.
			let assembledContext: string | undefined
			let embedBlocked = false
			if (body) {
				activityStart(env.canonicalSparkId)
				beginRoundtrip(env.canonicalSparkId, row.id, body)
				try {
					const storeId = activityBegin('store', 'Storing your message in memory…')
					const { id: memoryId } = await brainIngest(env.canonicalSparkId, body, {
						stream: 'talk',
						authorRole: 'user',
						source: row.id,
						contentDateMs: Date.now(),
						veracity: 'stated'
					})
					activityFinish(storeId, { label: 'Stored in memory', detail: memoryId })
					patchRoundtrip(row.id, { memoryId, phase: 'recalling' })
					const recallId = activityBegin(
						'recall',
						'Recalling relevant memories (embed + hybrid search)…'
					)
					const bundle = await brainAssembleContext(env.canonicalSparkId, body, {
						stream: 'talk'
					})
					assembledContext = bundle.prompt
					const tr = bundle.trace
					const hits = tr?.recalled?.length ?? 0
					// Per-phase breakdown (slowest first) so the recall cost is transparent.
					const breakdown = (tr?.timings ?? [])
						.slice()
						.sort((a, b) => b.ms - a.ms)
						.map((p) => `${p.label} ${p.ms >= 1000 ? `${(p.ms / 1000).toFixed(1)}s` : `${p.ms}ms`}`)
						.join(' · ')
					activityFinish(recallId, {
						label: 'Assembled context',
						detail: `${hits} hits · ${tr?.entities?.length ?? 0} entities · ${tr?.embedder ?? '—'} · ${tr?.budget?.usedChars ?? 0} chars${breakdown ? `\n${breakdown}` : ''}`
					})
					patchRoundtrip(row.id, { trace: bundle.trace, prompt: bundle.prompt, phase: 'done' })
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					// The embedder isn't loaded (model still downloading, or load failed — board 0032).
					// HARD-BLOCK the turn: never answer without memory on a stub. Trigger the download
					// and surface a clear preparing state instead of a silent context-free reply.
					if (msg.includes('EMBED_MODEL_NOT_READY')) {
						embedBlocked = true
						void startEmbedDownload()
						const emb = get(embedState)
						const frac = embedDownloadFraction(emb)
						const pct = frac == null ? '' : ` ${Math.round(frac * 100)}%`
						err = `Preparing memory model${pct}… ${EMBED_MODEL_LABEL} isn't ready yet. Your message will send once it's loaded.`
						activityBegin('error', 'Memory model not ready', err)
						patchRoundtrip(row.id, { error: err, phase: 'error' })
					} else {
						console.error('[brain] roundtrip failed:', msg)
						activityBegin('error', 'Memory roundtrip failed', msg)
						patchRoundtrip(row.id, { error: msg, phase: 'error' })
					}
				}
			}
			if (files.length > 0) {
				const { stored, errors } = await persistSparkFiles(row.id, files, {
					identityId: env.canonicalSparkId
				})
				if (errors.length > 0) {
					err =
						stored > 0
							? `Message sent; ${stored} file(s) saved. ${errors.join('; ')}`
							: `Message sent but files failed: ${errors.join('; ')}`
				}
			}
			// Fire the agent reply, grounded in the auto-assembled context — UNLESS the embedder
			// wasn't ready (board 0032): we never answer without memory on a stub. The user resends
			// once the model finishes loading.
			if (body && !embedBlocked) await replyWithAgent(body, row.id, assembledContext)
			// Dreaming runs after every turn: heal claims, merge entities, decay bonds, consolidate +
			// build the entity graph for new memories — continuous upkeep. Fire-and-forget AND
			// STEPPED (one phase per call) so it never blocks the talk loop OR the avenDB runtime,
			// and every step streams into the brain aside's Dreaming tab.
			if (body && !embedBlocked) void runDreamLogged(env.canonicalSparkId)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
			// The turn is over: stop "thinking"; resolved badges linger via the floating-chip timer.
			phase = 'idle'
			activityEnd()
			// Safety: never leave a HITL gate dangling if the turn ended unexpectedly.
			if (pendingConfirm) settleConfirm(false)
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
		get phase() {
			return phase
		},
		get toolBadges() {
			return toolBadges
		},
		get pendingConfirm() {
			return pendingConfirm
		},
		get err() {
			return err
		},
		get busy() {
			return busy
		},
		submit,
		confirmPending() {
			settleConfirm(true)
		},
		cancelPending() {
			settleConfirm(false)
		},
		dismissReply() {
			lastReply = undefined
			toolBadges = []
			if (dismissTimer) clearTimeout(dismissTimer)
		},
		setErr(message: string) {
			err = message
		},
		clearErr() {
			err = undefined
		}
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
