<script lang="ts">
import { tick } from 'svelte'
import { getBearerToken } from '$lib/auth/auth-client'
import { fmtMinds } from '$lib/billing/minds'
import { t } from '$lib/i18n'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import TodosCard from '$lib/shell/TodosCard.svelte'

type ChatMessage = {
	id: number
	role: 'user' | 'assistant'
	text: string
	pending?: boolean
}

type UsageStat = { tokens: number; costUsd: number }
type Credit = { tier: string; allowanceUsd: number; spentUsd: number; remainingUsd: number }
type UsageStats = { total: UsageStat; week: UsageStat; credit?: Credit }
type SessionRow = { id: string; title: string }

let messages = $state<ChatMessage[]>([])
let busy = $state(false)
let usage = $state<UsageStats | null>(null)
let sessions = $state<SessionRow[]>([])
let currentSessionId = $state<string | null>(null)
let nextId = 0
let scrollEl = $state<HTMLDivElement | null>(null)
let initialized = false

const AI_BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined
const SYSTEM_PROMPT =
	'You are a helpful assistant inside the avenOS Alberobello chat. Be concise and friendly.'

function scrollToBottom(): void {
	void tick().then(() => {
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
	})
}

// Pull the signed-in user's token-usage stats (all-time total + current week) from the
// session-gated endpoint. Refreshed on mount and after each completion.
async function refreshUsage(): Promise<void> {
	if (!AI_BASE) return
	const token = getBearerToken()
	if (!token) return
	try {
		const res = await fetch(`${AI_BASE}/api/ai/usage`, {
			credentials: 'include',
			headers: { Authorization: `Bearer ${token}` }
		})
		if (res.ok) usage = (await res.json()) as UsageStats
	} catch {
		/* leave the card hidden on failure */
	}
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
		messages = rows.map((r) => ({
			id: nextId++,
			role: r.role === 'assistant' ? 'assistant' : 'user',
			text: r.content
		}))
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
	void refreshUsage()
})

function toOpenAi(history: ChatMessage[]): { role: string; content: string }[] {
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		...history.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.text }))
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
	onDelta: (chunk: string) => void
): Promise<void> {
	if (!AI_BASE) throw new Error('auth server URL not configured')
	const token = getBearerToken()
	const res = await fetch(`${AI_BASE}/api/ai/chat`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify({
			messages: toOpenAi(history),
			stream: true,
			sessionId: currentSessionId ?? undefined
		})
	})
	const sid = res.headers.get('X-Session-Id')
	if (sid) currentSessionId = sid
	if (res.status === 402) {
		void refreshUsage()
		throw new Error(t('mainnet.chat.outOfCredits'))
	}
	if (!res.ok || !res.body) {
		const err = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
		throw new Error(
			err?.error ? `${err.error}${err.detail ? `: ${err.detail}` : ''}` : `HTTP ${res.status}`
		)
	}
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buf = ''
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		buf += decoder.decode(value, { stream: true })
		const events = buf.split('\n\n')
		buf = events.pop() ?? ''
		for (const event of events) {
			const dataLine = event.split('\n').find((l) => l.startsWith('data:'))
			if (!dataLine) continue
			const payload = dataLine.slice(5).trim()
			if (payload === '[DONE]') return
			try {
				const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
				const delta = json.choices?.[0]?.delta?.content
				if (delta) onDelta(delta)
			} catch {
				/* skip keep-alives / partial frames */
			}
		}
	}
}

// Real inference via the authenticated proxy: append the user message + a pending
// placeholder, then stream the AI reply into it token-by-token (or surface an error).
async function handleSubmit(text: string, files: File[]): Promise<void> {
	const trimmed = text.trim()
	const fileNote = files.length > 0 ? ` (${files.length} attachment(s))` : ''
	if (trimmed === '' && files.length === 0) return

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
	try {
		await streamTinfoil(messages, (chunk) => {
			acc += chunk
			messages = messages.map((m) => (m.id === pendingId ? { ...m, text: acc } : m))
			scrollToBottom()
		})
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
		void refreshUsage()
		void refreshSessions()
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
	<!-- Left: session switcher -->
	<aside
		class="border-border hidden w-56 shrink-0 flex-col border-r pt-[max(0.75rem,env(safe-area-inset-top))] sm:flex"
	>
		<div class="px-3 pb-2">
			<button
				type="button"
				class="border-border hover:bg-card flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
				onclick={newChat}
				disabled={busy || (messages.length === 0 && currentSessionId === null)}
			>
				+ {t('mainnet.chat.newChat')}
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

	<!-- Right: the conversation -->
	<div class="flex min-h-0 flex-1 flex-col">
		<header class="shrink-0 px-4 pt-2 pb-2 text-center">
			<p class="text-primary text-[10px] font-bold tracking-[0.18em] uppercase">
				{t('mainnet.chat.tag')}
			</p>
			<h1 class="font-display text-lg font-medium tracking-tight">{t('mainnet.chat.title')}</h1>
		</header>

		{#if usage}
			<div class="shrink-0 px-4 pb-2">
				<div
					class="border-border bg-card mx-auto w-full max-w-2xl overflow-hidden rounded-[var(--radius-lg)] border"
				>
					{#if usage.credit}
						<div
							class="border-border flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs"
						>
							<span
								class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {usage
									.credit.tier === 'avenCITY'
									? 'bg-primary/15 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{usage.credit.tier}
							</span>
							<span class="text-muted-foreground tabular-nums">
								{t('mainnet.chat.credits')}:
								<span
									class={usage.credit.remainingUsd <= 0 ? 'text-destructive' : 'text-foreground'}
								>
									{fmtMinds(usage.credit.remainingUsd)}
								</span>
								/ {fmtMinds(usage.credit.allowanceUsd)} {t('mainnet.chat.creditsLeft')}
							</span>
						</div>
					{/if}
					<div class="flex items-stretch divide-x divide-border text-center">
						<div class="flex-1 px-3 py-2">
							<div class="text-muted-foreground text-[10px] font-bold tracking-[0.14em] uppercase">
								{t('mainnet.chat.usageWeek')}
							</div>
							<div class="text-primary mt-0.5 text-sm font-medium tabular-nums">
								{fmtMinds(usage.week.costUsd)}
							</div>
						</div>
						<div class="flex-1 px-3 py-2">
							<div class="text-muted-foreground text-[10px] font-bold tracking-[0.14em] uppercase">
								{t('mainnet.chat.usageTotal')}
							</div>
							<div class="text-primary mt-0.5 text-sm font-medium tabular-nums">
								{fmtMinds(usage.total.costUsd)}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<TodosCard />

		<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-4">
			<div class="mx-auto flex w-full max-w-2xl flex-col gap-3 py-4">
				{#if messages.length === 0}
					<div class="text-muted-foreground py-16 text-center text-sm leading-relaxed">
						{t('mainnet.chat.empty')}
					</div>
				{/if}
				{#each messages as message (message.id)}
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
				{/each}
			</div>
		</div>

		<div class="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
			<div class="mx-auto w-full max-w-2xl">
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
