<script lang="ts">
	import { browser } from '$app/environment'
	import type { FilesRow, MessagesRow } from '@avenos/jazz-schema'
	import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
	import type { ComposerMode } from '$lib/intents/types'
	import { persistSparkFiles } from '$lib/jazz/intent-files'
	import { jazzSession, type JazzSessionReply } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import SparkMessageAttachments from '$lib/sparks/SparkMessageAttachments.svelte'
	import { pairingLabelForSession } from '$lib/self/active-vault-ui'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import { peerRows } from '$lib/peer/peer-mesh-store'
	import type { PeerRowReply } from '$lib/peer/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'
	import { vaultList } from '$lib/self/vault'
	import {
		mobileActionVeilClass,
		mobileComposerVeilZClass,
	} from '$lib/shell'
	import {
		clearMobileChromeOverrides,
		setMobileChromeOverrides
	} from '$lib/shell/mobile-chrome.svelte'

	type Props = {
		sparkId: string
		sparkName?: string
	}

	let { sparkId, sparkName }: Props = $props()

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let sendBusy = $state(false)
	let composerMode = $state<ComposerMode>('collapsed')
	let localPairingLabel = $state<string | undefined>(undefined)
	let scrollEl = $state<HTMLDivElement | undefined>(undefined)

	const sparksStore = jazzStore('sparks')
	const messages = jazzStore('messages')
	const filesStore = jazzStore('files')

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())
	const composerDisabled = $derived(!session?.peerDid?.trim())

	const peersAllow = $derived<PeerRowReply[]>(
		!tauri || !unlocked ? [] : $peerRows,
	)

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const sparkMeta = $derived(sparksStore.rows.find((s) => idsMatch(s.spark_id, sparkId)))
	const canonicalSparkId = $derived(sparkMeta?.spark_id ?? sparkId)
	const displayName = $derived(sparkName?.trim() || sparkMeta?.name || 'Spark')

	const thread = $derived(
		[...messages.rows]
			.filter((m) => idsMatch(m.spark_id, canonicalSparkId))
			.sort((a, b) => a.created_at_ms - b.created_at_ms),
	)

	const filesByMessageId = $derived.by(() => {
		const map = new Map<string, FilesRow[]>()
		for (const row of filesStore.rows) {
			if (!idsMatch(row.spark_id, canonicalSparkId)) continue
			const parentId = row.intent_id?.trim()
			if (!parentId) continue
			const list = map.get(parentId) ?? []
			list.push(row)
			map.set(parentId, list)
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.created_at_ms - b.created_at_ms)
		}
		return map
	})

	const peersByDid = $derived(
		new Map(peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const)),
	)

	function authorLabel(authorDid: string): string {
		const local = session?.peerDid?.trim().toLowerCase() ?? ''
		const norm = authorDid.trim().toLowerCase()
		if (local && norm === local) return 'You'
		const peer = peersByDid.get(norm)
		return peerDisplayLabel(authorDid, peer?.deviceLabel, localPairingLabel)
	}

	function formatTime(ms: number): string {
		try {
			return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		} catch {
			return ''
		}
	}

	function isOwnMessage(row: MessagesRow): boolean {
		const local = session?.peerDid?.trim().toLowerCase() ?? ''
		return local !== '' && row.author_did.trim().toLowerCase() === local
	}

	const storeError = $derived(sparksStore.error ?? messages.error)

	$effect(() => {
		if (storeError) err = storeError
	})

	$effect(() => {
		if (!tauri || !unlocked) {
			session = undefined
			return
		}
		let cancelled = false
		void jazzSession()
			.then((s) => {
				if (!cancelled) session = s
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
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
				spark_id: canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: did,
				body,
			})
			if (files.length > 0) {
				const { stored, errors } = await persistSparkFiles(row.id, files, {
					sparkId: canonicalSparkId,
				})
				if (errors.length > 0) {
					const suffix =
						stored > 0
							? `Message sent; ${stored} file(s) saved. ${errors.join('; ')}`
							: `Message sent but files failed: ${errors.join('; ')}`
					err = suffix
				}
			}
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			sendBusy = false
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="shrink-0 space-y-1 pb-3 sm:pb-0 sm:space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">Talk</h1>
		<p class="text-muted-foreground hidden text-sm leading-relaxed sm:block">
			Messages in <strong class="text-foreground font-medium">{displayName}</strong> — synced over Jazz when peers share this spark.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock to send and read messages.</p>
	{:else if !canonicalSparkId}
		<p class="text-muted-foreground text-sm">Missing spark id.</p>
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
				aria-label="Messages"
			>
				{#if !messages.loaded && !err}
					<p class="text-muted-foreground py-8 text-center text-sm">Loading messages…</p>
				{:else if thread.length === 0}
					<p class="text-muted-foreground py-8 text-center text-sm leading-relaxed">
						No messages yet. Say hello — peers with access to this spark will see it after sync.
					</p>
				{:else}
					{#each thread as msg (msg.id)}
						{@const own = isOwnMessage(msg)}
						{@const attachments = filesByMessageId.get(msg.id) ?? []}
						<article
							class="flex flex-col gap-0.5 {own ? 'items-end' : 'items-start'}"
							aria-label="{authorLabel(msg.author_did)} at {formatTime(msg.created_at_ms)}"
						>
							<div class="flex items-baseline gap-2 px-0.5 text-[10px]">
								<span class="text-foreground font-medium">{authorLabel(msg.author_did)}</span>
								<time class="text-muted-foreground" datetime={new Date(msg.created_at_ms).toISOString()}>
									{formatTime(msg.created_at_ms)}
								</time>
							</div>
							<div
								class="flex max-w-[min(100%,36rem)] flex-col gap-2 rounded-2xl px-3 py-2
									{own
									? 'bg-primary text-primary-foreground rounded-br-md'
									: 'bg-muted text-foreground rounded-bl-md'}"
							>
								{#if msg.body.trim()}
									<p class="text-sm leading-relaxed whitespace-pre-wrap break-words">
										{msg.body}
									</p>
								{/if}
								{#if attachments.length > 0}
									<SparkMessageAttachments files={attachments} inverted={own} />
								{/if}
							</div>
						</article>
					{/each}
				{/if}
			</div>

			<div
				class={`pointer-events-none fixed inset-x-0 bottom-0 ${mobileComposerVeilZClass} flex justify-center bg-gradient-to-t from-background via-background/88 to-transparent max-sm:px-2 sm:px-5 sm:from-55% sm:pt-3 sm:pb-5 ${mobileActionVeilClass}`}
			>
				<div
					class="relative flex w-full max-w-none items-center justify-center max-sm:px-0 sm:pl-0 sm:pr-0"
				>
					<div class="pointer-events-auto w-full min-w-0">
					<IntentComposer
						placeholder="Write a message…"
						disabled={composerDisabled}
						submitBusy={sendBusy}
						enableAttachments={true}
						embedAttachmentNamesInMessage={false}
						onSubmitMessage={handleComposerSubmit}
						onModeChange={(mode) => {
							composerMode = mode
						}}
					/>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
