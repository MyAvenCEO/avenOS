<script lang="ts">
	import { browser } from '$app/environment'
	import {
		jazzPeerMeshRefresh,
		jazzSession,
		jazzStatus,
		jazzBootstrap,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import type { PeerRowReply } from '$lib/peer/api'
	import {
		peerInviteAccept,
		peerInviteCancel,
		peerInviteCreate,
		peerList,
		peerRevoke,
		peerTransportStatus,
	} from '$lib/peer/api'
	import { deviceSession } from '$lib/self/device-session-store'
	import { useSelfContext } from '$lib/self/self-context.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	const ctx = useSelfContext()

	let copyGenesisKey = $state<string | null>(null)

	async function copyGenesis(): Promise<void> {
		if (!ctx.genesisB64) return
		try {
			await navigator.clipboard.writeText(ctx.genesisB64)
			copyGenesisKey = 'genesis'
			setTimeout(() => {
				if (copyGenesisKey === 'genesis') copyGenesisKey = null
			}, 1200)
		} catch {
			copyGenesisKey = null
		}
	}

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)

	let peerStatus = $state<import('$lib/peer/api').PeerTransportStatusReply | undefined>()
	let rows = $state<PeerRowReply[]>([])
	let inviteCode = $state<string | undefined>()
	let acceptCode = $state('')
	let acceptLabel = $state('Their device')
	let meshNote = $state<string | undefined>()
	let actionErr = $state<string | undefined>()
	let actionBusy = $state(false)

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked' || $deviceSession.kind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	async function loadPeersBlock(): Promise<void> {
		if (!tauri || !unlocked) {
			session = undefined
			rows = []
			return
		}
		busy = true
		err = undefined
		try {
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
			session = await jazzSession()
			rows = await peerList()
			peerStatus = await peerTransportStatus()
			const mesh = await jazzPeerMeshRefresh()
			meshNote = `Sync registry: ${mesh.registeredCount} linked peer transport id(s).`
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function hostInvite(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			const r = await peerInviteCreate()
			inviteCode = r.code
			await loadPeersBlock()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	async function acceptInvite(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerInviteAccept(acceptCode.trim(), acceptLabel.trim() || 'Peer')
			acceptCode = ''
			await loadPeersBlock()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	async function cancelInvite(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerInviteCancel()
			inviteCode = undefined
			await loadPeersBlock()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	async function revoke(did: string): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerRevoke(did)
			await loadPeersBlock()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	$effect(() => {
		unlocked
		tauri
		void loadPeersBlock()
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) return
		const id = window.setInterval(() => void loadPeersBlock(), 4000)
		return () => clearInterval(id)
	})
</script>

<svelte:head>
	<title>Peers &amp; anchor · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-10">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Peers &amp; anchor</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Read-only deployment anchor plus invite-only peer devices on this Mac. After pairing here, delegate spark access under
			<a href="/self/workspaces" class="text-primary font-medium underline">Self → Workspace sharing</a>.
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<section class="space-y-4">
		<div class="flex items-baseline justify-between gap-3">
			<div class="flex flex-col">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Genesis anchor</h2>
				<span class="text-muted-foreground text-[10px]">SEC1 uncompressed P-256 point (offline constant)</span>
			</div>
			{#if ctx.genesisShort}
				<span
					class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					>{ctx.genesisShort}</span
				>
			{/if}
		</div>

		<div class="rounded-xl border border-border/60 bg-card/30 p-4">
			{#if ctx.genesisB64}
				<div class="space-y-3">
					<pre
						class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.genesisB64}</pre>
					<div class="flex items-center justify-between gap-3">
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
							onclick={() => void copyGenesis()}
						>
							{copyGenesisKey === 'genesis' ? 'Copied' : 'Copy'}
						</button>
						<span class="text-muted-foreground font-mono text-[10px]">GENESIS_NETWORK_ID</span>
					</div>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</div>
	</section>

	<hr class="border-border/50" />

	<section class="space-y-6">
		<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Device peers</h2>

		{#if session?.peerDid}
			<p class="text-muted-foreground font-mono text-xs break-all">
				This device: <span class="text-foreground">{session.peerDid}</span>
			</p>
		{/if}

		{#if err}
			<p class="text-destructive text-sm">{err}</p>
		{/if}

		{#if busy}
			<p class="text-muted-foreground text-sm">Loading peers…</p>
		{/if}

		{#if meshNote}
			<p class="text-muted-foreground text-xs">{meshNote}</p>
		{/if}

		{#if peerStatus}
			<p class="text-muted-foreground text-xs">
				Hyperswarm {peerStatus.hyperswarmRunning ? 'on' : 'off'} · linked Groove transport ids: {peerStatus.linkedPeerIds.length}
			</p>
		{/if}

		<div class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<h3 class="text-[10px] font-semibold tracking-wider uppercase opacity-70">Pair a device</h3>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={actionBusy}
					onclick={() => void hostInvite()}
				>
					{actionBusy ? '…' : 'Invite (show code)'}
				</button>
				{#if inviteCode}
					<span class="font-mono text-lg font-semibold tracking-widest">{inviteCode}</span>
					<button type="button" class="border-input rounded-md border px-3 py-1.5 text-xs" onclick={() => void cancelInvite()}
						>Cancel invite</button
					>
				{/if}
			</div>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
				<label class="flex flex-1 flex-col gap-1 text-xs">
					<span class="text-muted-foreground">Join with code</span>
					<input
						class="border-input bg-background rounded-md border px-3 py-2 font-mono text-sm uppercase"
						placeholder="ABC12X"
						maxlength={6}
						bind:value={acceptCode}
					/>
				</label>
				<label class="flex flex-1 flex-col gap-1 text-xs">
					<span class="text-muted-foreground">Label for them on this device</span>
					<input class="border-input bg-background rounded-md border px-3 py-2 text-sm" bind:value={acceptLabel} />
				</label>
				<button
					type="button"
					class="border-input hover:bg-accent rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={actionBusy || acceptCode.trim().length < 6}
					onclick={() => void acceptInvite()}
				>
					Accept
				</button>
			</div>
			{#if actionErr}
				<p class="text-destructive text-xs">{actionErr}</p>
			{/if}
		</div>

		<div class="space-y-3">
			<h3 class="text-[10px] font-semibold tracking-wider uppercase opacity-70">Allowlist</h3>
			{#if rows.length === 0}
				<p class="text-muted-foreground text-sm">No peers yet — pair above or accept an invite.</p>
			{:else}
				<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
					{#each rows as r (r.id)}
						<li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<div class="font-medium">{r.label || '(no label)'}</div>
								<div class="text-muted-foreground font-mono text-[11px] break-all">{r.peerDid}</div>
								<div class="text-muted-foreground text-[10px] uppercase">{r.status}</div>
							</div>
							{#if r.status === 'active'}
								<button
									type="button"
									class="text-destructive border-destructive/40 hover:bg-destructive/10 rounded-md border px-3 py-1 text-xs"
									disabled={actionBusy}
									onclick={() => void revoke(r.peerDid)}
								>
									Revoke
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>
