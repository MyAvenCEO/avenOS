<script lang="ts">
	import { browser } from '$app/environment'
	import type { MessagesRow } from '@avenos/jazz-schema'
	import { jazzSession, type JazzSessionReply } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { pairingLabelForSession } from '$lib/self/active-vault-ui'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import { peerList, type PeerRowReply } from '$lib/peer/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'
	import { vaultList } from '$lib/self/vault'

	type Props = {
		sparkId: string
		sparkName?: string
	}

	let { sparkId, sparkName }: Props = $props()

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let bodyDraft = $state('')
	let sendBusy = $state(false)
	let peersAllow = $state<PeerRowReply[]>([])
	let localPairingLabel = $state<string | undefined>(undefined)
	let scrollEl = $state<HTMLDivElement | undefined>(undefined)

	const sparksStore = jazzStore('sparks')
	const messages = jazzStore('messages')

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

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
		if (!tauri || !unlocked) {
			peersAllow = []
			return
		}
		void peerList()
			.then((rows) => {
				peersAllow = rows
			})
			.catch(() => {
				peersAllow = []
			})
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

	async function sendMessage(): Promise<void> {
		const body = bodyDraft.trim()
		const did = session?.peerDid?.trim()
		if (!body || !did || !tauri || !unlocked || !canonicalSparkId) return
		sendBusy = true
		err = undefined
		try {
			await messages.create({
				spark_id: canonicalSparkId,
				created_at_ms: Date.now(),
				author_did: did,
				body,
			})
			bodyDraft = ''
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			sendBusy = false
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<header class="shrink-0 space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">Talk</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
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
		<div class="flex min-h-0 flex-1 flex-col gap-3">
		{#if err}
			<p
				class="text-destructive border-destructive/40 bg-destructive/10 shrink-0 rounded-lg border px-3 py-2 text-sm leading-snug"
				role="alert"
			>
				{err}
			</p>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col gap-2">
		<div
			bind:this={scrollEl}
			class="border-border/60 bg-card/20 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border px-3 py-3"
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
						<p
							class="max-w-[min(100%,36rem)] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words
								{own
								? 'bg-primary text-primary-foreground rounded-br-md'
								: 'bg-muted text-foreground rounded-bl-md'}"
						>
							{msg.body}
						</p>
					</article>
				{/each}
			{/if}
		</div>

		<form
			class="border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/80 flex shrink-0 flex-col gap-2 rounded-xl border p-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] backdrop-blur sm:flex-row sm:items-end"
			onsubmit={(e) => {
				e.preventDefault()
				void sendMessage()
			}}
		>
			<label class="flex min-w-0 flex-1 flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Message</span>
				<textarea
					bind:value={bodyDraft}
					rows={2}
					placeholder="Write a message…"
					class="border-input bg-background focus-visible:ring-ring max-h-32 min-h-[2.75rem] resize-y rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
					disabled={sendBusy || !session}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							void sendMessage()
						}
					}}
				></textarea>
			</label>
			<button
				type="submit"
				class="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
				disabled={sendBusy || !bodyDraft.trim() || !session}
			>
				{sendBusy ? '…' : 'Send'}
			</button>
		</form>
		</div>
		</div>
	{/if}
</div>
