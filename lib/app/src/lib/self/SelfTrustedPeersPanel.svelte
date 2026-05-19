<script lang="ts">
	import { browser } from '$app/environment'
	import { listen } from '@tauri-apps/api/event'
	import { jazzPeerMeshRefresh, jazzStatus, jazzBootstrap } from '$lib/jazz/api'
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
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { peerRowSyncPhase, peerSyncLabel, peerSyncTextClass } from '$lib/peer/sync-display'

	let err = $state<string | undefined>()
	let busy = $state(false)

	let peerStatus = $state<import('$lib/peer/api').PeerTransportStatusReply | undefined>()
	let rows = $state<PeerRowReply[]>([])
	let inviteCode = $state<string | undefined>()
	let acceptCode = $state('')
	let actionErr = $state<string | undefined>()
	let actionBusy = $state(false)

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	const pairingPending = $derived(
		Boolean(inviteCode) || Boolean(peerStatus?.pairingCodePending),
	)

	type TrustedDeviceRow = PeerRowReply & { placeholder?: boolean; pairingDetail?: string }

	function pairingPlaceholderCopy(
		hostWaiting: boolean,
		linkedCount: number,
	): { title: string; detail: string } {
		if (linkedCount > 0) {
			return {
				title: 'Almost there…',
				detail: 'Finishing pairing and saving your connection on this device.',
			}
		}
		const detail =
			'Usually under a minute on the open internet; same Wi‑Fi often helps with VPNs or strict networks.'
		if (hostWaiting) {
			return { title: 'Waiting for the other device…', detail }
		}
		return { title: 'Connecting to the other device…', detail }
	}

	const trustedRows = $derived.by((): TrustedDeviceRow[] => {
		if (!pairingPending) return rows

		const hasPairingRow = rows.some((r) => r.status === 'pairing')
		if (hasPairingRow) return rows

		const linked = peerStatus?.linkedPeerIds.length ?? 0
		const copy = pairingPlaceholderCopy(Boolean(inviteCode), linked)
		const placeholder: TrustedDeviceRow = {
			id: '__pairing_placeholder__',
			peerDid: '',
			deviceLabel: copy.title,
			pairingDetail: copy.detail,
			kind: 'remote',
			addedAtMs: 0,
			status: 'pairing',
			placeholder: true,
		}

		return [...rows, placeholder]
	})

	async function refreshPeersTransport(): Promise<void> {
		if (!tauri || !unlocked) return
		err = undefined
		try {
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
			rows = await peerList()
			peerStatus = await peerTransportStatus()
			await jazzPeerMeshRefresh()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	}

	async function loadPeersBlockFull(): Promise<void> {
		if (!tauri || !unlocked) {
			rows = []
			return
		}
		busy = true
		err = undefined
		try {
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
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

	$effect(() => {
		if (!browser || !tauri || !unlocked) return

		const p = listen('peer:invite-paired', () => {
			void refreshPeersTransport()
		})

		return () => {
			void p.then((u) => u())
		}
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) return
		const fast = pairingPending
		const ms = fast ? 2500 : 12000
		const id = window.setInterval(() => void refreshPeersTransport(), ms)
		return () => clearInterval(id)
	})
</script>

<section class="space-y-4">
	<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Connect with peer</h2>

	{#if err}
		<p class="text-destructive text-sm">{err}</p>
	{/if}

	{#if busy}
		<p class="text-muted-foreground flex items-center gap-2 text-sm">
			<span class="peers-spinner shrink-0 opacity-60" aria-hidden="true"></span>
			<span>Getting things ready…</span>
		</p>
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
				<button
					type="button"
					class="border-input rounded-md border px-3 py-1.5 text-xs"
					onclick={() => void cancelInvite()}>Cancel</button
				>
			{/if}
		</div>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
			<label class="flex flex-1 flex-col gap-1 text-xs">
				<span class="text-muted-foreground">Code from other device</span>
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
		<h3 class="text-[10px] font-semibold tracking-wider uppercase opacity-70">Trusted peers</h3>
		{#if trustedRows.length === 0}
			<p class="text-muted-foreground text-xs leading-snug">
				No other device has been added yet. Use the invite or code above, then share sparks under
				<a href="/self/workspaces" class="text-primary font-medium underline">Self → Share</a>.
			</p>
		{:else}
			<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
				{#each trustedRows as r (r.id)}
					{@const rowPhase = peerRowSyncPhase(r.status, pairingPending && !r.placeholder)}
					<li
						class="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between
							{r.placeholder ? 'bg-[color-mix(in_srgb,var(--color-status-info-base)_6%,transparent)]' : ''}"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-start gap-2">
								{#if r.placeholder}
									<span
										class="peers-spinner mt-1 shrink-0 text-[var(--color-status-info-base)]"
										aria-hidden="true"
									></span>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="font-medium">{r.deviceLabel || '(no label)'}</div>
									{#if r.pairingDetail}
										<p class="text-muted-foreground mt-0.5 text-[11px] leading-snug">{r.pairingDetail}</p>
									{:else if r.peerDid}
										<div class="text-muted-foreground font-mono text-[11px] break-all">{r.peerDid}</div>
									{/if}
									<div
										class="mt-1 text-[10px] font-bold tracking-wider uppercase {peerSyncTextClass(rowPhase)}"
									>
										{peerSyncLabel(rowPhase)}
									</div>
								</div>
							</div>
						</div>
						{#if r.status === 'active' && !r.placeholder}
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
