<script lang="ts">
	import { browser } from '$app/environment'
	import { jazzSession, peerList, peerForget, type PeerRow } from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { peerMeshSnapshot } from '$lib/peer/peer-mesh-store'
	import { meshPeerPhase, peerMeshDotClass, peerMeshTextClass, peerMeshPhaseUserLabel } from '$lib/peer/mesh-state'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { formatDebugReport } from '$lib/debug/console-capture'
	import { t } from '$lib/i18n'

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	let ownDid = $state<string>('')
	let peers = $state<PeerRow[]>([])
	let err = $state<string | undefined>()
	let busy = $state(false)
	let forgetting = $state<string | undefined>()
	let confirmForget = $state<string | undefined>()
	let copied = $state(false)
	let debugCopied = $state(false)
	let loadGen = 0

	async function copyDebug(): Promise<void> {
		if (!browser) return
		const report = formatDebugReport({ ownDid, peerRows: peers, meshSnapshot: $peerMeshSnapshot })
		try {
			await navigator.clipboard.writeText(report)
			debugCopied = true
			setTimeout(() => (debugCopied = false), 1500)
		} catch {
			/* clipboard blocked */
		}
	}

	async function load(): Promise<void> {
		if (!tauri || !unlocked) {
			peers = []
			ownDid = ''
			return
		}
		const gen = ++loadGen
		busy = true
		err = undefined
		try {
			await waitForGrooveSessionReady()
			const [session, rows] = await Promise.all([jazzSession(), peerList()])
			if (gen !== loadGen) return
			ownDid = session.peerDid
			peers = rows.filter((p) => p.status === 'active')
		} catch (e) {
			if (gen !== loadGen) return
			err = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === loadGen) busy = false
		}
	}

	async function forget(did: string): Promise<void> {
		if (forgetting) return
		// Inline two-step confirm — native confirm() no-ops in the Tauri webview.
		if (confirmForget !== did) {
			confirmForget = did
			setTimeout(() => {
				if (confirmForget === did) confirmForget = undefined
			}, 4000)
			return
		}
		confirmForget = undefined
		forgetting = did
		err = undefined
		try {
			await peerForget(did)
			await load()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			forgetting = undefined
		}
	}

	async function copyOwnDid(): Promise<void> {
		if (!browser || !ownDid) return
		try {
			await navigator.clipboard.writeText(ownDid)
			copied = true
			setTimeout(() => (copied = false), 1500)
		} catch {
			/* clipboard blocked — DID is selectable in the field */
		}
	}

	$effect(() => {
		void $deviceSession
		void load()
	})
</script>

<div class="flex w-full max-w-2xl flex-col gap-8">
	<header class="flex flex-col gap-1">
		<div class="flex items-start justify-between gap-2">
			<h1 class="text-lg font-semibold">{t('peers.title')}</h1>
			<button
				type="button"
				class="bg-muted hover:bg-muted/70 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
				title={t('peers.copyDebugHint')}
				onclick={() => void copyDebug()}>{debugCopied ? t('peers.copied') : t('peers.copyDebug')}</button
			>
		</div>
		<p class="text-muted-foreground text-sm">{t('peers.subtitle')}</p>
	</header>

	{#if !tauri || !unlocked}
		<p class="text-muted-foreground text-sm">{t('sparks.needsDesktop')}</p>
	{:else}
		<!-- Your peer ID (share so others can add you to a spark) -->
		<section class="flex flex-col gap-2">
			<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">{t('peers.yourId')}</h2>
			<div class="flex items-center gap-2">
				<code class="bg-muted/40 min-w-0 flex-1 truncate rounded-lg px-3 py-2 font-mono text-[11px] select-all" title={ownDid}>{ownDid || '…'}</code>
				<button
					type="button"
					class="bg-muted hover:bg-muted/70 shrink-0 rounded-lg px-3 py-2 text-xs font-medium"
					onclick={() => void copyOwnDid()}
					disabled={!ownDid}>{copied ? t('peers.copied') : t('peers.copy')}</button
				>
			</div>
			<p class="text-muted-foreground text-xs leading-relaxed">{t('peers.shareHint')}</p>
		</section>

		<!-- Synced-with roster (derived from spark grants; manage access in each spark's Members) -->
		<section class="flex flex-col gap-3">
			<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">{t('peers.trusted')}</h2>
			{#if err}
				<p class="text-destructive text-sm">{err}</p>
			{:else if busy && peers.length === 0}
				<p class="text-muted-foreground text-sm">{t('peers.loading')}</p>
			{:else if peers.length === 0}
				<p class="text-muted-foreground text-sm">{t('peers.noneRoster')}</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each peers as p (p.id)}
						{@const phase = meshPeerPhase($peerMeshSnapshot, p.peerDid, p.status)}
						<li class="rounded-xl border border-border/50 bg-background/40 px-4 py-3 transition-opacity" class:opacity-50={forgetting === p.peerDid}>
							<div class="flex items-start justify-between gap-3">
								<p class="min-w-0 text-sm font-semibold" title={p.deviceLabel}>{p.deviceLabel || t('peers.unnamed')}</p>
								<span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
									<span class="h-2 w-2 rounded-full {peerMeshDotClass(phase)}"></span>
									<span class={peerMeshTextClass(phase)}>{peerMeshPhaseUserLabel(phase)}</span>
								</span>
							</div>
							<p class="text-muted-foreground mt-0.5 font-mono text-[11px] leading-snug break-all select-text" title={p.peerDid}>{p.peerDid}</p>
							<div class="mt-2 flex justify-end">
								<button
									type="button"
									class="text-destructive hover:bg-destructive/10 rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
									disabled={forgetting === p.peerDid}
									onclick={() => void forget(p.peerDid)}
									>{forgetting === p.peerDid
										? t('peers.forgetting')
										: confirmForget === p.peerDid
											? t('peers.forgetConfirmInline')
											: t('peers.forget')}</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
