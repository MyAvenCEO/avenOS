<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import type { JazzRow } from '$lib/jazz/api'
	import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
	import type { ComposerMode } from '$lib/intents/types'
	import { persistSparkFiles } from '$lib/jazz/intent-files'
	import { streamReply } from '$lib/llm/generate'
	import { speak } from '$lib/tts/speak'
	import {
		agentUnavailableReason,
		llmDownloadFraction,
		llmState,
		startLlmReadiness,
	} from '$lib/llm/model-download-store'
	import { formatBytesPair } from '$lib/asr/format'
	import { onMount } from 'svelte'
	import { jazzShell } from '$lib/runtime/jazz-shell'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import IdentityMessageAttachments from '$lib/identities/IdentityMessageAttachments.svelte'
	import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import { peerRows } from '$lib/peer/peer-mesh-store'
	import type { PeerRowReply } from '$lib/peer/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { vaultList } from '$lib/settings/vault'
	import {
		mobileActionVeilClass,
		mobileComposerVeilZClass,
	} from '$lib/shell'
	import {
		clearMobileChromeOverrides,
		setMobileChromeOverrides
	} from '$lib/shell/mobile-chrome.svelte'

	type Props = {
		identityId: string
		sparkName?: string
	}

	let { identityId, sparkName }: Props = $props()

	// Deterministic author DID for on-device agent replies (role-tagged in the row).
	const AGENT_DID = 'did:aven:agent:lfm2'

	const session = $derived($jazzShell.session)
	let err = $state<string | undefined>()
	let sendBusy = $state(false)
	// Row id of the agent reply currently streaming (or undefined). The live text
	// is held in `streaming` and only persisted to the row once the stream ends, so
	// we don't write a Jazz row per token.
	let streamingId = $state<string | undefined>()
	let streaming = $state<Record<string, string>>({})
	// Row id of the agent reply currently being spoken on-device (or undefined) +
	// live playback state (synthesizing vs playing) and seconds since Speak was pressed.
	let speakingId = $state<string | undefined>()
	let speakPhase = $state<'generating' | 'playing' | undefined>()
	let speakElapsed = $state(0)
	let composerMode = $state<ComposerMode>('collapsed')
	let localPairingLabel = $state<string | undefined>(undefined)
	let scrollEl = $state<HTMLDivElement | undefined>(undefined)

	const identitiesStore = jazzStore('identities')
	const messages = jazzStore('messages')
	const filesStore = jazzStore('files')

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())
	const composerDisabled = $derived(!session?.peerDid?.trim())

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
			$llmState.status === 'downloading',
	)

	// On-device voice transcription: IntentComposer wires the real on-device STT
	// path (and the download-progress / setup states) itself when running in Tauri,
	// so nothing voice-specific needs to be passed here beyond surfacing errors.

	const peersAllow = $derived<PeerRowReply[]>(
		!tauri || !unlocked ? [] : $peerRows,
	)

	function idsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
		const na = (a ?? '').trim().toLowerCase()
		const nb = (b ?? '').trim().toLowerCase()
		return na !== '' && na === nb
	}

	const identityMeta = $derived(identitiesStore.rows.find((s) => idsMatch(s.owner, identityId)))
	const canonicalSparkId = $derived(identityMeta?.owner ?? identityId)
	const displayName = $derived(sparkName?.trim() || identityMeta?.name || t('identities.identityLabel'))

	const thread = $derived(
		[...messages.rows]
			.filter((m) => idsMatch(m.owner, canonicalSparkId))
			.sort((a, b) => coerceEpochMs(a.created_at_ms) - coerceEpochMs(b.created_at_ms)),
	)

	const filesByMessageId = $derived.by(() => {
		const map = new Map<string, JazzRow[]>()
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
		new Map(peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const)),
	)

	function authorLabel(authorDid: string | null | undefined): string {
		const local = session?.peerDid?.trim().toLowerCase() ?? ''
		const did = (authorDid ?? '').trim()
		const norm = did.toLowerCase()
		if (local && norm === local) return t('common.you')
		const peer = norm ? peersByDid.get(norm) : undefined
		return peerDisplayLabel(did, peer?.deviceLabel, localPairingLabel)
	}

	/** Groove IPC may send exposeTs bigint as number or legacy string. */
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

	function isOwnMessage(row: JazzRow): boolean {
		const local = session?.peerDid?.trim().toLowerCase() ?? ''
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

	$effect(() => {
		const typing = composerMode === 'typing'
		setMobileChromeOverrides({
			hideProfile: typing,
			hideAsideNav: typing
		})
		return () => clearMobileChromeOverrides()
	})

	async function handleComposerSubmit(message: string, files: File[]): Promise<void> {
		const body = message.trim()
		const did = session?.peerDid?.trim()
		if ((!body && files.length === 0) || !did || !tauri || !unlocked || !canonicalSparkId || sendBusy) {
			return
		}
		sendBusy = true
		err = undefined
		try {
			const row = await messages.create({
				owner: canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: did,
				role: 'user',
				body,
			})
			if (files.length > 0) {
				const { stored, errors } = await persistSparkFiles(row.id, files, {
					identityId: canonicalSparkId,
				})
				if (errors.length > 0) {
					const suffix =
						stored > 0
							? `Message sent; ${stored} file(s) saved. ${errors.join('; ')}`
							: `Message sent but files failed: ${errors.join('; ')}`
					err = suffix
				}
			}
			// Fire the on-device agent reply (text-only prompts for now).
			if (body) void replyWithAgent(body)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			sendBusy = false
		}
	}

	/**
	 * Create an empty agent message row, then stream LFM2.5 tokens into it live.
	 * Tokens accumulate in `streaming[id]` (rendered as the bubble body); the final
	 * text is persisted to the row once on completion.
	 */
	async function replyWithAgent(prompt: string): Promise<void> {
		if (!canonicalSparkId) return
		let replyId: string | undefined
		try {
			const reply = await messages.create({
				owner: canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: AGENT_DID,
				role: 'agent',
				body: '',
			})
			replyId = reply.id
			streamingId = reply.id
			streaming = { ...streaming, [reply.id]: '' }
			const full = await streamReply(prompt, reply.id, (piece) => {
				// Reassign (not mutate) so the {#each} liveBody const re-derives reliably.
				streaming = { ...streaming, [reply.id]: (streaming[reply.id] ?? '') + piece }
			})
			await messages.update(reply.id, { body: full || (streaming[reply.id] ?? '') })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (replyId) {
				await messages.update(replyId, { body: `⚠️ ${msg}` }).catch(() => {})
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
					<p class="text-muted-foreground py-8 text-center text-sm">{t('common.loadingMessages')}</p>
				{:else if thread.length === 0}
					<p class="text-muted-foreground py-8 text-center text-sm leading-relaxed">
						{t('identities.talk.noMessagesYet')}
					</p>
				{:else}
					{#each thread as msg (msg.id)}
						{@const own = isOwnMessage(msg)}
						{@const isAgent = msg.role === 'agent'}
						{@const label = isAgent ? t('identities.talk.agentLabel') : authorLabel(msg.author_did)}
						{@const liveBody = streaming[msg.id] ?? msg.body}
						{@const pending = streamingId === msg.id && !liveBody?.trim()}
						{@const attachments = filesByMessageId.get(msg.id) ?? []}
						<article
							class="flex flex-col gap-0.5 {own ? 'items-end' : 'items-start'}"
							aria-label={t('identities.talk.authorAtTime', {
								author: label,
								time: formatTime(msg.created_at_ms),
							})}
						>
							<div class="flex items-baseline gap-2 px-0.5 text-[10px]">
								<span class="text-foreground font-medium {isAgent ? 'text-primary' : ''}">{label}</span>
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
													<span class="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.3s]"></span>
													<span class="size-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.15s]"></span>
													<span class="size-1.5 animate-bounce rounded-full bg-foreground/40"></span>
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
								{:else if liveBody?.trim()}
									<p class="text-sm leading-relaxed whitespace-pre-wrap break-words">
										{liveBody}
									</p>
									{#if isAgent && streamingId !== msg.id}
										<button
											type="button"
											class="text-muted-foreground hover:text-primary -mb-0.5 -ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors disabled:opacity-60"
											onclick={() => speakMessage(msg.id, liveBody)}
											disabled={speakingId != null}
											aria-label={t('identities.talk.speak')}
											title={t('identities.talk.speak')}
										>
											<span aria-hidden="true"
												>{speakingId === msg.id ? (speakPhase === 'generating' ? '⏳' : '⏸') : '▶'}</span
											>
											<span
												>{#if speakingId !== msg.id}{t('identities.talk.speak')}{:else if speakPhase === 'generating'}{t('identities.talk.generating', { seconds: speakElapsed })}{:else}{t('identities.talk.playing', { seconds: speakElapsed })}{/if}</span
											>
										</button>
									{/if}
								{:else if isAgent}
									<p class="text-sm italic text-muted-foreground">{t('identities.talk.agentNoReply')}</p>
								{/if}
								{#if attachments.length > 0}
									<IdentityMessageAttachments files={attachments} inverted={own} />
								{/if}
							</div>
						</article>
					{/each}
				{/if}
			</div>

			<div
				class={`pointer-events-none fixed inset-x-0 bottom-0 ${mobileComposerVeilZClass} flex justify-center max-sm:px-2 sm:px-5 sm:pt-3 sm:pb-5 ${mobileActionVeilClass}`}
			>
				<div
					class="relative flex w-full max-w-none items-center justify-center max-sm:px-0 sm:pl-0 sm:pr-0"
				>
					<div class="pointer-events-auto w-full min-w-0">
					<IntentComposer
						placeholder={t('identities.talk.messagePlaceholder')}
						disabled={composerDisabled}
						submitBusy={sendBusy}
						enableAttachments={true}
						embedAttachmentNamesInMessage={false}
						onSubmitMessage={handleComposerSubmit}
						onModeChange={(mode) => {
							composerMode = mode
						}}
						onTranscribeError={(message) => {
							err = message
						}}
					/>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
