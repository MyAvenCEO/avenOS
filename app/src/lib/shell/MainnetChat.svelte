<script lang="ts">
import { useQueryClient } from '@tanstack/svelte-query'
import { tick } from 'svelte'
import { getBearerToken } from '$lib/auth/auth-client'
import { filesToVisionImages, persistMainnetFiles } from '$lib/avendb/intent-files'
import {
	bumpComposerReload,
	readSrcFiles,
	resolveActiveSpark,
	writeSrcFiles
} from '$lib/composer/active-spark'
import Composer from '$lib/composer/Composer.svelte'
import { t } from '$lib/i18n'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { pendingMainnetFileDrop } from '$lib/intents/global-file-drop'
import { consumeSse } from '$lib/net/sse'
import TodosVibe from '$lib/shell/TodosVibe.svelte'
import VibeCard from '$lib/shell/VibeCard.svelte'

// board 0113 — ANY vibe schema renders from its DB vibe.* rows through the generic VibeCard host (no
// client allow-list: a config-minted skill's card works with zero client change; a schema without rows
// gets VibeCard's soft error). Only `todos` (live interactive list) and `composer` stay special-cased.

type ChatMessage = {
	id: number
	role: 'user' | 'assistant'
	text: string
	pending?: boolean
	/** When set, this message renders a live vibe card for the named schema instead of text. */
	vibe?: string
	/** Classification/metadata payload for ephemeral vibes (bookkeeping). */
	vibeData?: Record<string, unknown>
}

type SessionRow = { id: string; title: string }

let messages = $state<ChatMessage[]>([])
let busy = $state(false)
let currentSessionId = $state<string | null>(null)
let nextId = 0
let scrollEl = $state<HTMLDivElement | null>(null)
let contentEl = $state<HTMLDivElement | null>(null)
let initialized = false
// The chat's IntentComposer instance — so a global file drop can push files into it (preview
// thumbnails above the input). Bound below; consumed by the pendingMainnetFileDrop effect. 0063.
let composerRef = $state<{ openWithFiles(files: File[] | FileList): void } | null>(null)
let pendingDrop = $state<File[] | null>(null)
$effect(() => {
	const unsub = pendingMainnetFileDrop.subscribe((v) => {
		pendingDrop = v
	})
	return unsub
})
$effect(() => {
	const files = pendingDrop
	if (!files?.length || !composerRef) return
	const ref = composerRef
	// tick() so the composer is fully mounted/bound before we hand it the files (matches the
	// testnet drop path) — otherwise the attachments + preview can be dropped.
	void tick().then(() => ref.openWithFiles(files))
	pendingMainnetFileDrop.set(null)
})
// The active spark's current src/ files (path→content), loaded into the AI context before each send
// so the edit_website tool can diff/create across them (sent as the body's `publicFiles`). board 0057.
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
/** Dismiss a HITL card (the user clicked, so it always disappears from view). board 0058. */
function removeHitl(id: string): void {
	hitlRequests = hitlRequests.filter((r) => r.id !== id)
}
/** Action-specific confirm/decline button labels (delete vs publish vs …) + the confirm intent. */
function hitlVerb(tool: string): { confirm: string; decline: string; danger: boolean } {
	if (tool === 'deploy_website') return { confirm: 'Publish', decline: 'Cancel', danger: false }
	if (tool === 'mutate') return { confirm: 'Apply', decline: 'Cancel', danger: true } // board 0101
	return { confirm: 'Delete', decline: 'Keep', danger: true }
}
/** Append a short assistant note (e.g. the publish result) into the conversation. */
function appendNote(text: string): void {
	messages = [...messages, { id: nextId++, role: 'assistant', text }]
}
/** board 0099 — the delete actor: flow a todos-deleted summary card showing what was removed. */
function appendVibe(vibe: string, vibeData?: Record<string, unknown>): void {
	messages = [...messages, { id: nextId++, role: 'assistant', text: '', vibe, vibeData }]
	scrollToBottom()
}
function declineHitl(req: HitlRequest): void {
	removeHitl(req.id) // dismiss — nothing runs
}
async function confirmHitl(req: HitlRequest): Promise<void> {
	if (req.status !== 'pending' || !AI_BASE) return
	removeHitl(req.id) // hide the card immediately on click
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
		const data = (await res.json().catch(() => null)) as {
			ok?: boolean
			result?: { url?: string; deployed?: number; vibe?: string; data?: Record<string, unknown> }
			error?: string
		} | null
		if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`)
		if (req.tool === 'deploy_website') {
			appendNote(`✅ Published — live at ${data.result?.url ?? 'www.next.aven.ceo'}`)
		} else if (req.tool === 'mutate') {
			// board 0101 — a confirmed structural mutation: flow the diff card, then refresh the live data.
			if (data.result?.vibe === 'mutation-result') appendVibe('mutation-result', data.result.data)
			void queryClient.invalidateQueries({ queryKey: ['data'] })
		} else {
			// board 0099 — a confirmed todos delete streams a todos-deleted card listing EVERY removed task
			// (a batch delete removes many), then refreshes the live list. Other deletes just refresh.
			if (req.action.schema === 'todos') {
				const items = Array.isArray(req.action._deleted)
					? (req.action._deleted as { id: string; title: string }[])
					: []
				appendVibe('todos-deleted', { items })
			}
			void queryClient.invalidateQueries({ queryKey: ['data'] })
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (req.tool === 'deploy_website') appendNote(`⚠️ Publish failed: ${msg}`)
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
	'write HTML yourself. To PUBLISH their website to the live web (www.next.aven.ceo), call ' +
	'deploy_website — the user must confirm a publish prompt and only an admin can deploy; you never ' +
	'upload anything yourself.'
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

// Load the single rolling conversation (the most-recent server session) into the view. There is no
// session switcher — one continuous context, hydrated on mount so it survives restarts. board 0111.
async function loadRollingSession(): Promise<void> {
	if (!AI_BASE) return
	const token = getBearerToken()
	if (!token) return
	try {
		const res = await fetch(`${AI_BASE}/api/ai/sessions`, {
			credentials: 'include',
			headers: { Authorization: `Bearer ${token}` }
		})
		if (!res.ok) return
		const { sessions: rows } = (await res.json()) as { sessions: SessionRow[] }
		if (rows?.length) await loadSessionMessages(rows[0].id)
	} catch {
		/* start fresh on failure */
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
			// Re-hydrate a persisted vibe marker back into a live vibe card. The marker is
			// `<ZWSP>aven-vibe:<schema>` optionally followed by `\n<json data>` (board 0067) so the
			// card renders its stored content after reload, not an empty shell. Data-backed vibes
			// (todos) carry no payload — they re-fetch live from /api/data.
			if (r.role === 'assistant' && r.content.startsWith(VIBE_MARKER)) {
				const rest = r.content.slice(VIBE_MARKER.length)
				const nl = rest.indexOf('\n')
				const schema = (nl >= 0 ? rest.slice(0, nl) : rest).trim()
				let vibeData: Record<string, unknown> | undefined
				if (nl >= 0) {
					try {
						vibeData = JSON.parse(rest.slice(nl + 1)) as Record<string, unknown>
					} catch {
						/* malformed payload — render the empty card */
					}
				}
				return { id: nextId++, role: 'assistant' as const, text: '', vibe: schema, vibeData }
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

$effect(() => {
	if (initialized) return
	initialized = true
	void loadRollingSession()
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
	onVibe: (schema: string, data?: Record<string, unknown>) => void,
	onEdit: (files: Record<string, string>) => void,
	onTool: (tl: ToolStatus) => void,
	onHitl: (req: {
		id: string
		tool: string
		label: string
		action: Record<string, unknown>
	}) => void,
	onEditChunk: (text: string) => void,
	attachments: { mimeType: string; b64: string }[],
	fileHashes: string[]
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
			publicFiles,
			// Image attachments for the classify_document vision tool. board 0063.
			...(attachments.length > 0 ? { attachments } : {}),
			// Content hashes of the source files persisted to the PRIVATE store; the server stamps the
			// first into the extracted doc JSON (file_hash). board 0082.
			...(fileHashes.length > 0 ? { fileHashes } : {})
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
						aven_vibe?: { schema?: string; data?: Record<string, unknown> }
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
					if (json.aven_vibe?.schema) onVibe(json.aven_vibe.schema, json.aven_vibe.data)
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

// Apply an AI website edit: write the changed src/ files to the active spark (the generator
// re-assembles the preview) and refresh any mounted Composer vibe. board 0055/0057.
async function applyEdit(files: Record<string, string>): Promise<void> {
	if (!files || Object.keys(files).length === 0) return
	const spark = await resolveActiveSpark()
	if (!spark) return
	try {
		await writeSrcFiles(spark, files)
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

	// Load the spark's src/ files into the AI context so edit_website can diff/create across them.
	publicFiles = await readSrcFiles(await resolveActiveSpark())
	toolActivity = [] // fresh tool-activity strip for this turn
	editStream = '' // fresh GLM edit stream for this turn

	// Build vision attachments for server-side multimodal classification: images pass through,
	// PDFs are rasterized to page images (gemma4-31b can't read raw PDFs). The first page also
	// becomes the inline bookkeeping preview. board 0063.
	const visionImages = await filesToVisionImages(files)
	const attachments: { mimeType: string; b64: string }[] = visionImages.map((img) => ({
		mimeType: img.mimeType,
		b64: img.dataUrl.split(',')[1] ?? ''
	}))
	const previewImage = visionImages[0] ?? null
	// Persist the ORIGINAL source files to the mainnet PRIVATE content-addressed store, and pass their
	// hashes so the server can stamp file_hash into the extracted JSON. Mainnet-only. board 0082.
	const fileHashes = (await persistMainnetFiles(files)).map((r) => r.hash)

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
	// vibeData carries ephemeral classification payload for the bookkeeping vibe. board 0063.
	const turnVibes = new Set<string>()
	const insertVibe = (schema: string, data?: Record<string, unknown>): void => {
		if (turnVibes.has(schema)) return
		turnVibes.add(schema)
		const wantsPreview = schema === 'bookkeeping' || schema === 'doc-compare'
		const vibeData: Record<string, unknown> =
			wantsPreview && data
				? {
						...data,
						...(previewImage
							? { fileUrl: previewImage.dataUrl, mimeType: previewImage.mimeType }
							: {})
					}
				: (data ?? {})
		const card: ChatMessage = { id: nextId++, role: 'assistant', text: '', vibe: schema, vibeData }
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
			},
			attachments,
			fileHashes
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
	<!-- One continuous conversation — no session switcher (single rolling context). board 0111. -->
	<div class="flex min-h-0 min-w-0 flex-1 flex-col pt-2">
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
								<TodosVibe
									containerName={`aven-vibes-chat-${message.id}`}
									filter={message.vibeData?.filter as
										| { field: string; value?: unknown; op?: string }
										| undefined}
								/>
							</div>
						{:else if message.vibe === 'composer'}
							<div
								class="border-border h-[70vh] w-full overflow-hidden rounded-[var(--radius-xl)] border bg-[var(--color-surface-soft)]"
							>
								<Composer />
							</div>
						{:else}
							<!-- board 0113 — GENERIC: any other schema renders its own DB vibe rows via VibeCard. -->
							<div class="max-h-[80vh] w-full overflow-y-auto">
								<VibeCard
									schema={message.vibe ?? ''}
									data={message.vibeData ?? {}}
									containerName={`aven-vibes-chat-${message.id}`}
								/>
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
					{@const v = hitlVerb(req.tool)}
					<!-- a small confirm card: question on top, buttons at the bottom; dismissed on click -->
					<div
						class="border-border bg-card mx-auto mb-2 max-w-xs rounded-[var(--radius-lg)] border px-4 py-3 text-center text-[13px] shadow-sm"
					>
						<p class="text-foreground mb-3 font-medium">{req.label}</p>
						<div class="flex justify-center gap-2">
							<!-- decline always LEFT, confirm always RIGHT -->
							<button
								type="button"
								class="border-border hover:bg-muted rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors"
								onclick={() => declineHitl(req)}
							>
								{v.decline}
							</button>
							<button
								type="button"
								class="rounded-full px-4 py-1.5 text-xs font-semibold transition-colors {v.danger
									? 'border-destructive/50 text-destructive hover:bg-destructive/10 border'
									: 'bg-primary text-primary-foreground hover:opacity-90'}"
								onclick={() => void confirmHitl(req)}
							>
								{v.confirm}
							</button>
						</div>
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
					bind:this={composerRef}
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
