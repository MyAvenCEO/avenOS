<script lang="ts">
import { onMount } from 'svelte'
import { browser } from '$app/environment'
import { formatBytesPair } from '$lib/asr/format'
import type { AvenDbRow } from '$lib/avendb/api'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import IdentityMessageAttachments from '$lib/identities/IdentityMessageAttachments.svelte'
import { getIdentityAgent } from '$lib/identities/identity-agent.svelte'
import {
	agentUnavailableReason,
	llmDownloadFraction,
	llmState,
	startLlmReadiness
} from '$lib/llm/model-download-store'
import { parseToolCallBody } from '$lib/llm/tools'
import type { PeerRowReply } from '$lib/peer/api'
import { peerDisplayLabel } from '$lib/peer/display-label'
import { peerRows } from '$lib/peer/peer-mesh-store'
import { avendbShell } from '$lib/runtime/avendb-shell'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
import { deviceSession } from '$lib/settings/device-session-store'
import { vaultList } from '$lib/settings/vault'
import { speak } from '$lib/tts/speak'

type Props = {
	identityId: string
	sparkName?: string
}

let { identityId, sparkName }: Props = $props()

// The intent bar + agent submit/stream pipeline live in the identity layout (identity-wide).
// This panel is the talk SURFACE: it renders the message thread + the live streaming tokens
// the shared runtime is producing.
const agent = getIdentityAgent()
const streaming = $derived(agent.streaming)
const streamingId = $derived(agent.streamingId)

const session = $derived($avendbShell.session)
let err = $state<string | undefined>()
// Row id of the agent reply currently being spoken on-device (or undefined) +
// live playback state (synthesizing vs playing) and seconds since Speak was pressed.
let speakingId = $state<string | undefined>()
let speakPhase = $state<'generating' | 'playing' | undefined>()
let speakElapsed = $state(0)
let localPairingLabel = $state<string | undefined>(undefined)
let scrollEl = $state<HTMLDivElement | undefined>(undefined)

const identitiesStore = avenDbStore('safes')
const messages = avenDbStore('messages')
const filesStore = avenDbStore('files')

const unlocked = $derived($deviceSession.kind === 'unlocked')
const tauri = $derived(browser && isTauriRuntime())

// Keep the on-device LLM status live so a pending agent bubble can explain WHY
// it's waiting (downloading the multi-GB model, loading it, not set up, error)
// instead of showing an opaque infinite spinner.
onMount(() => {
	let unlisten: (() => void) | undefined
	void startLlmReadiness().then((u) => (unlisten = u))
	return () => unlisten?.()
})

/** Status line shown inside a pending agent bubble (before any token arrives). */
const agentPendingLabel = $derived.by(() => {
	const s = $llmState
	if (s.status === 'ready') return t('identities.talk.agentThinking')
	const reason = agentUnavailableReason(s) ?? t('identities.talk.agentThinking')
	if (s.status === 'downloading' && s.totalBytes > 0) {
		return `${reason} ${formatBytesPair(s.receivedBytes, s.totalBytes)}`
	}
	return reason
})
const agentDownloadFraction = $derived(llmDownloadFraction($llmState))
/** While pending, show animated dots only when actively generating/loading. */
const agentPendingBusy = $derived(
	$llmState.status === 'ready' ||
		$llmState.status === 'loading' ||
		$llmState.status === 'downloading'
)

const peersAllow = $derived<PeerRowReply[]>(!tauri || !unlocked ? [] : $peerRows)

function idsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
	const na = (a ?? '').trim().toLowerCase()
	const nb = (b ?? '').trim().toLowerCase()
	return na !== '' && na === nb
}

const identityMeta = $derived(identitiesStore.rows.find((s) => idsMatch(s.owner, identityId)))
const canonicalSparkId = $derived(identityMeta?.owner ?? identityId)
const displayName = $derived(
	sparkName?.trim() || identityMeta?.name || t('identities.identityLabel')
)

const thread = $derived(
	[...messages.rows]
		.filter((m) => idsMatch(m.owner, canonicalSparkId))
		.sort((a, b) => coerceEpochMs(a.created_at_ms) - coerceEpochMs(b.created_at_ms))
)

const filesByMessageId = $derived.by(() => {
	const map = new Map<string, AvenDbRow[]>()
	for (const row of filesStore.rows) {
		if (!idsMatch(row.owner, canonicalSparkId)) continue
		const parentId = row.intent_id?.trim()
		if (!parentId) continue
		const list = map.get(parentId) ?? []
		list.push(row)
		map.set(parentId, list)
	}
	for (const list of map.values()) {
		list.sort((a, b) => coerceEpochMs(a.created_at_ms) - coerceEpochMs(b.created_at_ms))
	}
	return map
})

const peersByDid = $derived(
	new Map(peersAllow.map((p) => [p.signerDid.trim().toLowerCase(), p] as const))
)

function authorLabel(authorDid: string | null | undefined): string {
	const local = session?.signerDid?.trim().toLowerCase() ?? ''
	const did = (authorDid ?? '').trim()
	const norm = did.toLowerCase()
	if (local && norm === local) return t('common.you')
	const peer = norm ? peersByDid.get(norm) : undefined
	return peerDisplayLabel(did, peer?.deviceLabel, localPairingLabel)
}

/** avenDB IPC may send exposeTs bigint as number or legacy string. */
function coerceEpochMs(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
	return Number.NaN
}

function formatTime(ms: unknown): string {
	const n = coerceEpochMs(ms)
	if (!Number.isFinite(n)) return ''
	try {
		return new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	} catch {
		return ''
	}
}

function isOwnMessage(row: AvenDbRow): boolean {
	const local = session?.signerDid?.trim().toLowerCase() ?? ''
	const author = (row.author_did ?? '').trim().toLowerCase()
	return local !== '' && author !== '' && author === local
}

const storeError = $derived(identitiesStore.error ?? messages.error)

$effect(() => {
	if (storeError) err = storeError
})

$effect(() => {
	if (!browser || !tauri || !unlocked) {
		localPairingLabel = undefined
		return
	}
	void $deviceSession
	void (async () => {
		try {
			const vr = await vaultList()
			localPairingLabel = pairingLabelForSession(vr, $deviceSession)
		} catch {
			localPairingLabel = undefined
		}
	})()
})

$effect(() => {
	const n = thread.length
	if (n === 0) return
	queueMicrotask(() => {
		scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: n > 1 ? 'smooth' : 'auto' })
	})
})

/**
 * Speak an agent message on-device (MOSS-TTS-Nano). Streams `tts:audio-chunk`
 * PCM and plays it via Web Audio. Surfaces backend errors (e.g. model not yet
 * downloaded) inline rather than throwing.
 */
async function speakMessage(id: string, body: string): Promise<void> {
	const text = body.trim()
	if (!text || speakingId) return
	speakingId = id
	speakPhase = 'generating'
	speakElapsed = 0
	const startedAt = Date.now()
	const tick = setInterval(() => {
		speakElapsed = Math.floor((Date.now() - startedAt) / 1000)
	}, 250)
	try {
		await speak(text, id, (phase) => {
			speakPhase = phase
		})
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		clearInterval(tick)
		speakingId = undefined
		speakPhase = undefined
	}
}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="shrink-0 space-y-1 pb-3 sm:pb-0 sm:space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">{t('identities.talk.title')}</h1>
		<p class="text-muted-foreground hidden text-sm leading-relaxed sm:block">
			{t('identities.talk.subtitle', { name: displayName })}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.talk.unlockToSend')}</p>
	{:else if !canonicalSparkId}
		<p class="text-muted-foreground text-sm">{t('identities.talk.missingSparkId')}</p>
	{:else}
		<div class="relative flex min-h-0 flex-1 flex-col">
			{#if err}
				<p
					class="text-destructive border-destructive/40 bg-destructive/10 mb-2 shrink-0 rounded-lg border px-3 py-2 text-sm leading-snug"
					role="alert"
				>
					{err}
				</p>
			{/if}

			<div
				bind:this={scrollEl}
				class="border-border/60 bg-card/20 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border px-3 py-3 pb-24 sm:mb-2 sm:pb-3 md:pb-3"
				role="log"
				aria-label={t('identities.talk.messagesLog')}
			>
				{#if !messages.loaded && !err}
					<p class="text-muted-foreground py-8 text-center text-sm">
						{t('common.loadingMessages')}
					</p>
				{:else if thread.length === 0}
					<p class="text-muted-foreground py-8 text-center text-sm leading-relaxed">
						{t('identities.talk.noMessagesYet')}
					</p>
				{:else}
					{#snippet speakBtn(id: string, text: string)}
						<button
							type="button"
							class="text-muted-foreground hover:text-primary -mb-0.5 -ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors disabled:opacity-60"
							onclick={() => speakMessage(id, text)}
							disabled={speakingId != null}
							aria-label={t('identities.talk.speak')}
							title={t('identities.talk.speak')}
						>
							{#if speakingId !== id}
								<!-- idle: play -->
								<svg class="size-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
									<path d="M5 3.5v9l7-4.5z" />
								</svg>
							{:else if speakPhase === 'generating'}
								<!-- generating: spinning loader -->
								<svg class="size-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle
										cx="12"
										cy="12"
										r="9"
										stroke="currentColor"
										stroke-width="3"
										opacity="0.25"
									/>
									<path
										d="M21 12a9 9 0 0 0-9-9"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
									/>
								</svg>
							{:else}
								<!-- playing: pause bars -->
								<svg class="size-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
									<rect x="4" y="3" width="3" height="10" rx="1" />
									<rect x="9" y="3" width="3" height="10" rx="1" />
								</svg>
							{/if}
							<span
								>{#if speakingId !== id}
									{t('identities.talk.speak')}
								{:else if speakPhase === 'generating'}
									{t('identities.talk.generating', { seconds: speakElapsed })}
								{:else}
									{t('identities.talk.playing', { seconds: speakElapsed })}
								{/if}</span
							>
						</button>
					{/snippet}
					{#each thread as msg (msg.id)}
						{@const own = isOwnMessage(msg)}
						{@const isAgent = msg.role === 'agent'}
						{@const label = isAgent ? t('identities.talk.agentLabel') : authorLabel(msg.author_did)}
						{@const liveBody = streaming[msg.id] ?? msg.body}
						{@const toolCall = isAgent ? parseToolCallBody(liveBody) : null}
						{@const pending = streamingId === msg.id && !liveBody?.trim()}
						{@const speakText = toolCall ? toolCall.response : (liveBody ?? '')}
						{@const showSpeak = isAgent && streamingId !== msg.id && !!speakText?.trim()}
						{@const attachments = filesByMessageId.get(msg.id) ?? []}
						<article
							class="flex flex-col gap-0.5 {own ? 'items-end' : 'items-start'}"
							aria-label={t('identities.talk.authorAtTime', {
								author: label,
								time: formatTime(msg.created_at_ms),
							})}
						>
							<div class="flex items-baseline gap-2 px-0.5 text-[10px]">
								<span class="text-foreground font-medium {isAgent ? 'text-primary' : ''}"
									>{label}</span
								>
								<time
									class="text-muted-foreground"
									datetime={Number.isFinite(coerceEpochMs(msg.created_at_ms))
										? new Date(coerceEpochMs(msg.created_at_ms)).toISOString()
										: undefined}
								>
									{formatTime(msg.created_at_ms)}
								</time>
							</div>
							<div
								class="flex max-w-[min(100%,36rem)] flex-col gap-2 rounded-2xl px-3 py-2
									{own
									? 'bg-primary text-primary-foreground rounded-br-md'
									: isAgent
										? 'bg-muted/70 text-foreground rounded-bl-md ring-1 ring-primary/20'
										: 'bg-muted text-foreground rounded-bl-md'}"
							>
								{#if pending}
									<div class="flex flex-col gap-1.5 py-0.5" aria-live="polite">
										<span class="flex items-center gap-2 text-xs text-muted-foreground">
											{#if agentPendingBusy}
												<span class="flex gap-1" aria-hidden="true">
													<span
														class="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.3s]"
													></span>
													<span
														class="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.15s]"
													></span>
													<span
														class="size-1.5 animate-bounce rounded-full bg-foreground/40"
													></span>
												</span>
											{/if}
											<span>{agentPendingLabel}</span>
										</span>
										{#if $llmState.status === 'downloading' && agentDownloadFraction != null}
											<div class="h-1 w-40 overflow-hidden rounded-full bg-muted">
												<div
													class="h-full rounded-full bg-primary transition-[width] duration-300"
													style={`width: ${Math.round(agentDownloadFraction * 100)}%`}
												></div>
											</div>
										{/if}
									</div>
								{:else if toolCall}
									<!-- `respond` is just the agent's message. Action tools add ONE clean
									     confirmation pill (human result + status) — no raw args/JSON. -->
									{#if toolCall.response?.trim()}
										<p class="text-sm leading-relaxed whitespace-pre-wrap break-words">
											{toolCall.response}
										</p>
									{/if}
									{#if toolCall.name !== 'respond' && (toolCall.result || toolCall.name)}
										<div
											class="border-border/60 bg-background/40 text-muted-foreground mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
										>
											{#if toolCall.ok}
												<svg
													class="size-3 shrink-0 text-emerald-600 dark:text-emerald-500"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<path d="M5 13l4 4L19 7" />
												</svg>
											{:else}
												<svg
													class="size-3 shrink-0 text-amber-600 dark:text-amber-500"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<path d="M12 8v5" />
													<path d="M12 16.5h.01" />
												</svg>
											{/if}
											<span class="truncate">{toolCall.result || toolCall.name}</span>
											{#if toolCall.inferred}
												<span
													class="bg-muted-foreground/15 rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
													>auto</span
												>
											{/if}
										</div>
									{/if}
								{:else if liveBody?.trim()}
									<p class="text-sm leading-relaxed whitespace-pre-wrap break-words">
										{liveBody}
									</p>
								{:else if isAgent}
									<p class="text-sm italic text-muted-foreground">
										{t('identities.talk.agentNoReply')}
									</p>
								{/if}
								<!-- Speak (on-device TTS) hidden for now — pure-cloud mode (board 0022).
									{#if showSpeak}
										{@render speakBtn(msg.id, speakText)}
									{/if}
								-->

								{#if attachments.length > 0}
									<IdentityMessageAttachments files={attachments} inverted={own} />
								{/if}
							</div>
						</article>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
