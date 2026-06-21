<script lang="ts">
import { useQueryClient } from '@tanstack/svelte-query'
import { tick } from 'svelte'
import { getBearerToken } from '$lib/auth/auth-client'
import {
	bumpComposerReload,
	readPublicFiles,
	resolveActiveSpark,
	writePublicFiles
} from '$lib/composer/active-spark'
import Composer from '$lib/composer/Composer.svelte'
import { t } from '$lib/i18n'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { consumeSse } from '$lib/net/sse'
import TodosVibe from '$lib/shell/TodosVibe.svelte'

type ChatMessage = {
	id: number
	role: 'user' | 'assistant'
	text: string
	pending?: boolean
	/** When set, this message renders a live vibe card for the named schema instead of text. */
	vibe?: string
}

type SessionRow = { id: string; title: string }

let messages = $state<ChatMessage[]>([])
let busy = $state(false)
let sessions = $state<SessionRow[]>([])
let currentSessionId = $state<string | null>(null)
let nextId = 0
let scrollEl = $state<HTMLDivElement | null>(null)
let contentEl = $state<HTMLDivElement | null>(null)
let initialized = false
// Session switcher is collapsed by default so the conversation is centered + full-width; a tiny
// toggle button opens the chats viewer. board 0055.
let showSessions = $state(false)
// The active spark's current public/ files (path→content), loaded into the AI context before each
// send so the edit_website tool can diff/create across files. board 0055.
let publicFiles: Record<string, string> = {}

// Live tool-loop activity for the current turn (which tools run / are still running / done),
// shown above the composer for full transparency into the roundtrip. board 0055.
type ToolStatus = {
	id: string
	name: string
	detail: string
	status: 'running' | 'done' | 'error'
	startedAt?: number
}
let toolActivity = $state<ToolStatus[]>([])
// Live GLM edit stream (reasoning + diff text) for the current turn, shown in a scrolling panel so
// the user sees what the website model is actually writing — not just "thinking". board 0056.
let editStream = $state('')
let streamEl = $state<HTMLDivElement | null>(null)
// Only render the tail — the full stream can be many KB; the recent activity is what matters.
const editStreamTail = $derived(
	editStream.length > 1600 ? `…${editStream.slice(-1600)}` : editStream
)
// Keep the stream panel pinned to its newest line as text flows in.
$effect(() => {
	const _pin = editStreamTail
	if (streamEl) streamEl.scrollTop = streamEl.scrollHeight
})
function upsertTool(tl: ToolStatus): void {
	const i = toolActivity.findIndex((x) => x.id === tl.id)
	if (i < 0) {
		toolActivity = [...toolActivity, { ...tl, startedAt: Date.now() }]
	} else {
		const startedAt = toolActivity[i].startedAt
		toolActivity = toolActivity.map((x, j) => (j === i ? { ...tl, startedAt } : x))
	}
}
// Ticks every second while a tool is running, to drive the live elapsed-time counter.
let nowTick = $state(Date.now())
$effect(() => {
	if (!toolActivity.some((tl) => tl.status === 'running')) return
	const iv = setInterval(() => (nowTick = Date.now()), 1000)
	return () => clearInterval(iv)
})

// HITL gateway: destructive tool calls (e.g. a delete) arrive as confirm/decline requests instead
// of executing. The user approves via /api/ai/confirm, which actually runs the action. board 0055.
type HitlRequest = {
	id: string
	tool: string
	label: string
	action: Record<string, unknown>
	status: 'pending' | 'confirmed' | 'declined' | 'error'
}
let hitlRequests = $state<HitlRequest[]>([])
function addHitl(req: {
	id: string
	tool: string
	label: string
	action: Record<string, unknown>
}) {
	hitlRequests = [...hitlRequests.filter((r) => r.id !== req.id), { ...req, status: 'pending' }]
}
function setHitlStatus(id: string, status: HitlRequest['status']): void {
	hitlRequests = hitlRequests.map((r) => (r.id === id ? { ...r, status } : r))
}
async function confirmHitl(req: HitlRequest): Promise<void> {
	if (req.status !== 'pending' || !AI_BASE) return
	setHitlStatus(req.id, 'confirmed')
	try {
		const token = getBearerToken()
		const res = await fetch(`${AI_BASE}/api/ai/confirm`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: JSON.stringify({ action: req.action })
		})
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		void queryClient.invalidateQueries({ queryKey: ['data'] })
	} catch (e) {
		setHitlStatus(req.id, 'error')
		console.error('[chat] HITL confirm failed:', e)
	}
}

// After an AI turn the server has recorded usage + (often) written data via the tool-loop, so
// invalidate those queries to snap the MINDS counter + any todos vibe up to date at once (polling
// is only the fallback). board 0055.
const queryClient = useQueryClient()

const AI_BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined
// Client backstop: abort a chat stream that goes silent this long so the composer can't stay
// stuck busy if the server hangs. Longer than the server's STREAM_IDLE_MS so its graceful
// [DONE] normally lands first. board 0055.
const CLIENT_IDLE_MS = 90_000
const SYSTEM_PROMPT =
	'You are a helpful assistant inside the avenOS Alberobello chat. Be concise and friendly. ' +
	'To show the user their website (read-only), call show_website. To change their website, call ' +
	'edit_website with a clear instruction — a specialist model does the rewrite, so you never ' +
	'write HTML yourself.'
// Sentinel content the server persists for a vibe-card marker message (must match
// VIBE_MARKER in libs/betterauth/src/ai.ts). Re-hydrated into a vibe card on load.
const VIBE_MARKER = '\u200baven-vibe:'

// Pin the conversation to the bottom. tick() waits for Svelte's DOM update; the rAF then waits for
// the browser to lay the new content out (streamed text / a vibe card iframe) so scrollHeight is
// final — pinning once before + once after paint reliably lands at the true bottom. board 0055.
function scrollToBottom(): void {
	const pin = () => {
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
	}
	void tick().then(() => {
		pin()
		requestAnimationFrame(pin)
	})
}

// Refresh the user's session list (most-recent first) for the left switcher.
async function refreshSessions(): Promise<void> {
	if (!AI_BASE) return
	const token = getBearerToken()
	if (!token) return
	try {
		const res = await fetch(`${AI_BASE}/api/ai/sessions`, {
			credentials: 'include',
			headers: { Authorization: `Bearer ${token}` }
		})
		if (res.ok) {
			const { sessions: rows } = (await res.json()) as { sessions: SessionRow[] }
			sessions = rows ?? []
		}
	} catch {
		/* keep the current list on failure */
	}
}

// Load one session's messages into the chat view.
async function loadSessionMessages(id: string): Promise<void> {
	if (!AI_BASE) return
	const token = getBearerToken()
	if (!token) return
	try {
		const res = await fetch(`${AI_BASE}/api/ai/sessions/${id}/messages`, {
			credentials: 'include',
			headers: { Authorization: `Bearer ${token}` }
		})
		if (!res.ok) return
		const { messages: rows } = (await res.json()) as {
			messages: { role: string; content: string }[]
		}
		currentSessionId = id
		messages = rows.map((r) => {
			// Re-hydrate a persisted vibe marker back into a live vibe card.
			if (r.role === 'assistant' && r.content.startsWith(VIBE_MARKER)) {
				return {
					id: nextId++,
					role: 'assistant' as const,
					text: '',
					vibe: r.content.slice(VIBE_MARKER.length)
				}
			}
			return {
				id: nextId++,
				role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
				text: r.content
			}
		})
		scrollToBottom()
	} catch {
		/* ignore */
	}
}

/** Switch to a session from the left list. */
function selectSession(id: string): void {
	if (busy || id === currentSessionId) return
	void loadSessionMessages(id)
}

/** Start a new conversation: next message creates a fresh server-side session. */
function newChat(): void {
	if (busy) return
	messages = []
	currentSessionId = null
}

$effect(() => {
	if (initialized) return
	initialized = true
	void (async () => {
		await refreshSessions()
		if (sessions.length > 0) await loadSessionMessages(sessions[0].id)
	})()
})

// Stick to the bottom while the conversation grows. A ResizeObserver on the message column fires
// on EVERY height change — streamed tokens, an inserted vibe card, a loading iframe — which a
// one-shot scroll misses (it reads scrollHeight before the new content lays out). board 0055.
$effect(() => {
	const el = scrollEl
	if (!el || !contentEl) return
	const ro = new ResizeObserver(() => {
		el.scrollTop = el.scrollHeight
	})
	ro.observe(contentEl)
	return () => ro.disconnect()
})

function toOpenAi(history: ChatMessage[]): { role: string; content: string }[] {
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		...history.filter((m) => !m.pending && !m.vibe).map((m) => ({ role: m.role, content: m.text }))
	]
}

/**
 * Stream a completion from the authenticated Tinfoil proxy. The server enforces the
 * Better Auth session (only signed-in users can run inference); we send the bearer token
 * (WKWebView drops the cross-site cookie). The proxy pipes Tinfoil's OpenAI-style SSE
 * through; we parse `data:` events and emit each `delta.content` chunk via `onDelta`.
 */
async function streamTinfoil(
	history: ChatMessage[],
	onDelta: (chunk: string) => void,
	onVibe: (schema: string) => void,
	onEdit: (files: Record<string, string>) => void,
	onTool: (tl: ToolStatus) => void,
	onHitl: (req: {
		id: string
		tool: string
		label: string
		action: Record<string, unknown>
	}) => void,
	onEditChunk: (text: string) => void
): Promise<void> {
	if (!AI_BASE) throw new Error('auth server URL not configured')
	const token = getBearerToken()
	const ac = new AbortController()
	let idle = setTimeout(() => ac.abort(), CLIENT_IDLE_MS)
	const res = await fetch(`${AI_BASE}/api/ai/chat`, {
		method: 'POST',
		credentials: 'include',
		signal: ac.signal,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify({
			messages: toOpenAi(history),
			stream: true,
			sessionId: currentSessionId ?? undefined,
			// Current public/ files → the server's edit_website tool (GLM) diffs/creates across them.
			publicFiles
		})
	})
	const sid = res.headers.get('X-Session-Id')
	if (sid) currentSessionId = sid
	if (res.status === 402) {
		clearTimeout(idle)
		throw new Error(t('mainnet.chat.outOfCredits'))
	}
	if (!res.ok || !res.body) {
		clearTimeout(idle)
		const err = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
		throw new Error(
			err?.error ? `${err.error}${err.detail ? `: ${err.detail}` : ''}` : `HTTP ${res.status}`
		)
	}
	// Same SSE reader the realtime subscription uses (DRY). onChunk resets the idle watchdog; the
	// server sends `[DONE]` then closes, so the loop ends naturally — no early return needed.
	const bumpIdle = (): void => {
		clearTimeout(idle)
		idle = setTimeout(() => ac.abort(), CLIENT_IDLE_MS)
	}
	try {
		await consumeSse(
			res,
			(payload) => {
				if (payload === '[DONE]') return
				try {
					const json = JSON.parse(payload) as {
						choices?: { delta?: { content?: string } }[]
						aven_vibe?: { schema?: string }
						aven_edit?: { files?: Record<string, string> }
						aven_tool?: ToolStatus
						aven_hitl?: {
							id: string
							tool: string
							label: string
							action: Record<string, unknown>
						}
						aven_edit_chunk?: { text?: string }
					}
					if (json.aven_tool) onTool(json.aven_tool)
					if (json.aven_hitl) onHitl(json.aven_hitl)
					if (json.aven_vibe?.schema) onVibe(json.aven_vibe.schema)
					if (json.aven_edit?.files) onEdit(json.aven_edit.files)
					if (json.aven_edit_chunk?.text) onEditChunk(json.aven_edit_chunk.text)
					const delta = json.choices?.[0]?.delta?.content
					if (delta) onDelta(delta)
				} catch {
					/* skip keep-alives / partial frames */
				}
			},
			bumpIdle
		)
	} finally {
		clearTimeout(idle)
	}
}

// Apply an AI website edit: write the changed public/ files to the active spark (same Storage
// primitive as the Tigris deploy) and refresh any mounted Composer vibe. board 0055.
async function applyEdit(files: Record<string, string>): Promise<void> {
	if (!files || Object.keys(files).length === 0) return
	const spark = await resolveActiveSpark()
	if (!spark) return
	try {
		await writePublicFiles(spark, files)
		bumpComposerReload()
	} catch (e) {
		console.error('[chat] apply website edit failed:', e)
	}
}

// Real inference via the authenticated proxy: append the user message + a pending
// placeholder, then stream the AI reply into it token-by-token (or surface an error).
async function handleSubmit(text: string, files: File[]): Promise<void> {
	const trimmed = text.trim()
	const fileNote = files.length > 0 ? ` (${files.length} attachment(s))` : ''
	if (trimmed === '' && files.length === 0) return

	// Load the current public/ files into the AI context so edit_website can diff/create across them.
	publicFiles = await readPublicFiles(await resolveActiveSpark())
	toolActivity = [] // fresh tool-activity strip for this turn
	editStream = '' // fresh GLM edit stream for this turn

	const pendingId = nextId + 1
	messages = [
		...messages,
		{ id: nextId, role: 'user', text: `${trimmed}${fileNote}` },
		{ id: pendingId, role: 'assistant', text: t('mainnet.chat.thinking'), pending: true }
	]
	nextId += 2
	scrollToBottom()
	busy = true
	let acc = ''
	// One live vibe card per touched schema per turn, inserted just above the streaming reply.
	const turnVibes = new Set<string>()
	const insertVibe = (schema: string): void => {
		if (turnVibes.has(schema)) return
		turnVibes.add(schema)
		const card: ChatMessage = { id: nextId++, role: 'assistant', text: '', vibe: schema }
		const idx = messages.findIndex((m) => m.id === pendingId)
		messages =
			idx < 0 ? [...messages, card] : [...messages.slice(0, idx), card, ...messages.slice(idx)]
		scrollToBottom()
	}
	try {
		await streamTinfoil(
			messages,
			(chunk) => {
				acc += chunk
				messages = messages.map((m) => (m.id === pendingId ? { ...m, text: acc } : m))
				scrollToBottom()
			},
			insertVibe,
			(files) => void applyEdit(files),
			upsertTool,
			addHitl,
			(text) => {
				editStream += text
				scrollToBottom()
			}
		)
		const finalText = acc.trim() || t('mainnet.chat.noReply')
		messages = messages.map((m) =>
			m.id === pendingId ? { ...m, text: finalText, pending: false } : m
		)
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		messages = messages.map((m) =>
			m.id === pendingId
				? { ...m, text: t('mainnet.chat.aiError', { message }), pending: false }
				: m
		)
	} finally {
		busy = false
		scrollToBottom()
		void refreshSessions()
		void queryClient.invalidateQueries({ queryKey: ['usage'] })
		void queryClient.invalidateQueries({ queryKey: ['data'] })
	}
}

// Voice input is already wired: in the Tauri runtime IntentComposer transcribes on-device
// (Parakeet) and calls onSubmitMessage with the transcript, which flows through handleSubmit
// above. Surface transcription failures here so they aren't silent.
function handleTranscribeError(message: string): void {
	messages = [
		...messages,
		{ id: nextId++, role: 'assistant', text: t('mainnet.chat.voiceError', { message }) }
	]
	scrollToBottom()
}
</script>

<div class="flex min-h-0 flex-1 bg-background">
	<!-- Left: session switcher — collapsed by default, opened by the tiny "Chats" toggle -->
	{#if showSessions}
		<aside
			class="border-border flex w-56 shrink-0 flex-col border-r pt-[max(0.75rem,env(safe-area-inset-top))]"
		>
			<div class="flex items-center gap-1.5 px-3 pb-2">
				<button
					type="button"
					class="border-border hover:bg-card flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
					onclick={newChat}
					disabled={busy || (messages.length === 0 && currentSessionId === null)}
				>
					+ {t('mainnet.chat.newChat')}
				</button>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground hover:bg-card rounded-[var(--radius)] px-2 py-1.5 text-xs transition-colors"
					onclick={() => (showSessions = false)}
					aria-label="Close chats"
					title="Close"
				>
					✕
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{#if sessions.length === 0}
					<p class="text-muted-foreground px-2 py-2 text-[11px] leading-relaxed">
						{t('mainnet.chat.noSessions')}
					</p>
				{/if}
				{#each sessions as s (s.id)}
					<button
						type="button"
						class="mb-0.5 block w-full truncate rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {s.id ===
					currentSessionId
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
						title={s.title}
						onclick={() => selectSession(s.id)}
						disabled={busy}
					>
						{s.title || t('mainnet.chat.untitled')}
					</button>
				{/each}
			</div>
		</aside>
	{/if}

	<!-- Right: the conversation (truly centered when the switcher is collapsed) -->
	<div class="flex min-h-0 flex-1 flex-col pt-2">
		{#if !showSessions}
			<div class="shrink-0 px-4 pb-1">
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground hover:bg-card inline-flex items-center gap-1.5 rounded-[var(--radius)] px-2 py-1 text-xs transition-colors"
					onclick={() => (showSessions = true)}
					title="Open chats"
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="4" width="18" height="16" rx="2" />
						<line x1="9" y1="4" x2="9" y2="20" />
					</svg>
					Chats
				</button>
			</div>
		{/if}
		<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-4">
			<div bind:this={contentEl} class="mx-auto flex w-full max-w-[52rem] flex-col gap-3 py-4">
				{#if messages.length === 0}
					<div class="text-muted-foreground py-16 text-center text-sm leading-relaxed">
						{t('mainnet.chat.empty')}
					</div>
				{/if}
				{#each messages as message (message.id)}
					{#if message.vibe}
						<!-- Vibes flow into the stream. Data vibes size to content (capped + scroll); the
						     Composer needs a definite height, so it renders in a fixed-height card. -->
						{#if message.vibe === 'todos'}
							<div class="max-h-[80vh] w-full overflow-y-auto">
								<TodosVibe containerName={`aven-vibes-chat-${message.id}`} />
							</div>
						{:else if message.vibe === 'composer'}
							<div
								class="border-border h-[70vh] w-full overflow-hidden rounded-[var(--radius-lg)] border"
							>
								<Composer />
							</div>
						{/if}
					{:else}
						<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
							<div
								class="max-w-[80%] rounded-[var(--radius-lg)] px-3.5 py-2 text-sm leading-relaxed {message.role ===
							'user'
								? 'bg-primary text-primary-foreground'
								: 'border-border bg-card text-foreground border'}{message.pending
								? ' animate-pulse italic opacity-60'
								: ''}"
							>
								{message.text}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>

		<div class="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
			<div class="mx-auto w-full max-w-[52rem]">
				{#each hitlRequests as req (req.id)}
					<div
						class="border-border bg-card mb-2 flex flex-wrap items-center justify-center gap-2 rounded-[var(--radius-lg)] border px-3 py-2 text-[13px]"
					>
						<span class="text-foreground font-medium">{req.label}</span>
						{#if req.status === 'pending'}
							<button
								type="button"
								class="border-destructive/50 text-destructive hover:bg-destructive/10 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
								onclick={() => void confirmHitl(req)}
							>
								Delete
							</button>
							<button
								type="button"
								class="border-border hover:bg-muted rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
								onclick={() => setHitlStatus(req.id, 'declined')}
							>
								Keep
							</button>
						{:else if req.status === 'confirmed'}
							<span class="text-muted-foreground text-xs">✓ deleted</span>
						{:else if req.status === 'declined'}
							<span class="text-muted-foreground text-xs">kept</span>
						{:else}
							<span class="text-destructive text-xs">failed — try again</span>
						{/if}
					</div>
				{/each}
				{#if editStream}
					<!-- live GLM edit stream: reasoning + diff text as the website model writes it -->
					<div
						bind:this={streamEl}
						class="border-border bg-card text-muted-foreground mb-2 max-h-36 overflow-y-auto rounded-[var(--radius-lg)] border px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap"
					>
						{editStreamTail}
					</div>
				{/if}
				{#if toolActivity.length > 0}
					<div class="flex flex-wrap justify-center gap-1.5 pb-2">
						{#each toolActivity as tool (tool.id)}
							<span
								class="border-border bg-card inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] {tool.status ===
								'error'
									? 'text-destructive'
									: 'text-muted-foreground'}"
								title={tool.detail}
							>
								{#if tool.status === 'running'}
									<span
										class="bg-primary inline-block h-1.5 w-1.5 animate-pulse rounded-full"
									></span>
								{:else if tool.status === 'done'}
									<span class="text-primary">✓</span>
								{:else}
									<span class="text-destructive">✕</span>
								{/if}
								<b class="text-foreground font-semibold">{tool.name}</b>
								<span class="opacity-80">{tool.detail}</span>
								{#if tool.status === 'running' && tool.startedAt}
									<span class="text-foreground/60 tabular-nums">
										· {Math.max(0, Math.round((nowTick - tool.startedAt) / 1000))}s
									</span>
								{/if}
							</span>
						{/each}
					</div>
				{/if}
				<IntentComposer
					placeholder={t('mainnet.chat.placeholder')}
					enableAttachments={true}
					submitBusy={busy}
					onSubmitMessage={handleSubmit}
					onTranscribeError={handleTranscribeError}
				/>
			</div>
		</div>
	</div>
</div>
