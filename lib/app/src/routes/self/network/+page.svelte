<script lang="ts">
	import { browser } from '$app/environment'
	import { listen } from '@tauri-apps/api/event'
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
	let showAdvanced = $state(false)
	let meshNote = $state<string | undefined>()
	let actionErr = $state<string | undefined>()
	let actionBusy = $state(false)

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked',
	)
	const tauri = $derived(browser && isTauriRuntime())

	const pairingPending = $derived(
		Boolean(inviteCode) || Boolean(peerStatus?.pairingCodePending),
	)

	/** Peers row + Hyperswarm status only — avoids jazzSession → hydrate_shell every tick. */
	async function refreshPeersTransport(): Promise<void> {
		if (!tauri || !unlocked) {
			return
		}
		err = undefined
		try {
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
			rows = await peerList()
			peerStatus = await peerTransportStatus()
			const mesh = await jazzPeerMeshRefresh()
			if (mesh.registeredCount === 0) {
				meshNote = undefined
			} else {
				meshNote =
					mesh.registeredCount === 1
						? 'Sync is connected to one other device.'
						: `Sync is connected across ${mesh.registeredCount} other devices.`
			}
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	}

	/** First paint + DID line: one jazzSession (hydrate_shell) when identity context is fresh. */
	async function loadPeersBlockFull(): Promise<void> {
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
			await refreshPeersTransport()
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
			await refreshPeersTransport()
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
			await peerInviteAccept(acceptCode.trim())
			acceptCode = ''
			await refreshPeersTransport()
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
			await refreshPeersTransport()
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
			await refreshPeersTransport()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	$effect(() => {
		unlocked
		tauri
		void loadPeersBlockFull()
	})

	/** Event-driven refresh when Rust finishes pairing handshake (writes peers row). */
	$effect(() => {
		if (!browser || !tauri || !unlocked) return

		const p = listen('peer:invite-paired', () => {
			void refreshPeersTransport()
		})

		return () => {
			void p.then((u) => u())
		}
	})

	/** Light polling: fast while invite is open (waiting for Noise link); slow when idle. */
	$effect(() => {
		if (!browser || !tauri || !unlocked) return
		const fast = pairingPending
		const ms = fast ? 2500 : 12000
		const id = window.setInterval(() => void refreshPeersTransport(), ms)
		return () => clearInterval(id)
	})
</script>

<svelte:head>
	<title>Devices · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Devices</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Connect another Mac on your account, then share sparks from
			<a href="/self/workspaces" class="text-primary font-medium underline">Self → Workspace sharing</a>.
			Labels come from each person’s profile automatically.
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<details class="rounded-lg border border-border/50 bg-card/15" bind:open={showAdvanced}>
		<summary class="cursor-pointer px-4 py-3 text-[11px] font-semibold tracking-wider uppercase opacity-70">
			Advanced · Genesis anchor
		</summary>
		<div class="border-border/50 space-y-4 border-t px-4 py-4">
			<div class="flex items-baseline justify-between gap-3">
				<span class="text-muted-foreground text-[10px]">SEC1 P-256 (offline constant)</span>
				{#if ctx.genesisShort}
					<span
						class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
						>{ctx.genesisShort}</span
					>
				{/if}
			</div>

			<div class="rounded-xl border border-border/60 bg-background/40 p-3">
				{#if ctx.genesisB64}
					<pre
						class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.genesisB64}</pre>
					<div class="mt-3 flex justify-end">
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
							onclick={() => void copyGenesis()}
						>
							{copyGenesisKey === 'genesis' ? 'Copied' : 'Copy'}
						</button>
					</div>
				{:else}
					<p class="text-muted-foreground text-xs">Loading…</p>
				{/if}
			</div>
		</div>
	</details>

	<section class="space-y-4">
		<div class="flex flex-wrap items-start justify-between gap-2">
		<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Connect another Mac</h2>
			{#if session?.peerDid}
				<p
					class="text-muted-foreground max-w-[min(100%,28rem)] break-words text-right text-[10px] leading-tight"
					title={session.peerDid}
				>
					<span class="opacity-80">Your ID</span><br />
					<span class="font-mono text-[9px] text-foreground break-all">{session.peerDid}</span>
				</p>
			{/if}
		</div>

		{#if err}
			<p class="text-destructive text-sm">{err}</p>
		{/if}

		{#if busy}
			<p class="text-muted-foreground flex items-center gap-2 text-sm">
				<span class="peers-spinner shrink-0 opacity-60" aria-hidden="true"></span>
				<span>Getting things ready…</span>
			</p>
		{/if}

		{#if meshNote && !pairingPending}
			<p class="text-muted-foreground text-[11px] leading-snug">{meshNote}</p>
		{/if}

		{#if pairingPending}
			<div
				class="border-border/60 bg-muted/20 flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[11px] leading-snug"
				role="status"
				aria-live="polite"
			>
				<span class="peers-spinner text-primary mt-0.5 shrink-0" aria-hidden="true"></span>
				<div class="text-muted-foreground min-w-0 flex-1">
					{#if peerStatus && peerStatus.linkedPeerIds.length > 0}
						<p class="text-foreground font-medium">Almost there…</p>
						<p>Finishing pairing and saving your connection on this Mac.</p>
					{:else}
						<p class="text-foreground font-medium">Looking for the other device…</p>
						<p>
							Two devices finding each other on the internet usually takes less than a minute; sometimes longer
							with VPNs or strict networks. Putting both on the same Wi‑Fi often speeds this up.
						</p>
					{/if}
				</div>
			</div>
		{/if}

		<div class="space-y-2.5 rounded-xl border border-border/60 bg-card/30 p-3">
			<h3 class="text-[10px] font-semibold tracking-wider uppercase opacity-70">Invite or join</h3>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={actionBusy}
					onclick={() => void hostInvite()}
				>
					{actionBusy ? '…' : 'Get invite code'}
				</button>
				{#if inviteCode}
					<span class="font-mono text-lg font-semibold tracking-widest">{inviteCode}</span>
					<button type="button" class="border-input rounded-md border px-3 py-1.5 text-xs" onclick={() => void cancelInvite()}
						>Cancel</button
					>
				{/if}
			</div>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
				<label class="flex flex-1 flex-col gap-1 text-xs">
					<span class="text-muted-foreground">Code from other Mac</span>
					<input
						class="border-input bg-background rounded-md border px-3 py-2 font-mono text-sm uppercase"
						placeholder="ABC12X"
						maxlength={6}
						bind:value={acceptCode}
					/>
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

		<div class="space-y-2">
			<h3 class="text-[10px] font-semibold tracking-wider uppercase opacity-70">Trusted devices</h3>
			{#if rows.length === 0}
				{#if pairingPending}
					<p class="text-muted-foreground text-xs leading-snug">
						No devices here yet — as soon as the connection completes, the other Mac appears in this list
						automatically.
					</p>
				{:else}
					<p class="text-muted-foreground text-xs leading-snug">
						No other Mac has been added yet. Use the invite or code above, then approve workspace sharing under
						<a href="/self/workspaces" class="text-primary font-medium underline">Self → Workspace sharing</a>.
					</p>
				{/if}
			{:else}
				<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
					{#each rows as r (r.id)}
						<li class="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<div class="font-medium">{r.deviceLabel || '(no label)'}</div>
								<div class="text-muted-foreground font-mono text-[11px] break-all">{r.peerDid}</div>
								<div class="text-muted-foreground text-[10px] uppercase">
									{r.status === 'active' ? 'Connected' : r.status}
								</div>
							</div>
							{#if r.status === 'active'}
								<button
									type="button"
									class="text-destructive border-destructive/40 hover:bg-destructive/10 rounded-md border px-3 py-1 text-xs"
									disabled={actionBusy}
									onclick={() => void revoke(r.peerDid)}
								>
									Remove
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>

<style>
	@keyframes peers-network-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.peers-spinner {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		box-sizing: border-box;
		border-radius: 9999px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: peers-network-spin 0.7s linear infinite;
		vertical-align: middle;
	}
</style>
