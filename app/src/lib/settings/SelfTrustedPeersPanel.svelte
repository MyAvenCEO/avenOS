<script lang="ts">
	import { browser } from '$app/environment'
	import { peerRevoke } from '$lib/peer/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { peerPersonName, shortPeerDid } from '$lib/peer/display-label'
	import { peerRows } from '$lib/peer/peer-mesh-store'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
	import { vaultList } from '$lib/settings/vault'
	import { t } from '$lib/i18n'

	const rows = $derived($peerRows)
	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	let actionBusy = $state(false)
	let actionErr = $state<string | undefined>()
	let localPairingLabel = $state<string | undefined>(undefined)

	$effect(() => {
		if (!browser || !tauri || !unlocked) {
			localPairingLabel = undefined
			return
		}
		void $deviceSession
		void (async () => {
			try {
				const vaultRows = await vaultList()
				localPairingLabel = pairingLabelForSession(vaultRows, $deviceSession)
			} catch {
				localPairingLabel = undefined
			}
		})()
	})

	async function revoke(did: string): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerRevoke(did)
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}
</script>

<section class="space-y-4">
	<h2 class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/75">
		{t('peer.trustedPeers')}
	</h2>

	{#if actionErr}
		<p class="text-destructive text-sm">{actionErr}</p>
	{/if}

	{#if rows.length === 0}
		<p class="text-muted-foreground px-1 text-xs leading-snug">
			{t('peer.noTrustedPeersYet')}
		</p>
	{:else}
		<ul class="divide-border/60 divide-y overflow-hidden rounded-xl border border-border/60">
			{#each rows as r (r.id)}
				<li class="flex min-w-0 items-start gap-3 px-3 py-2.5">
					<div class="min-w-0 flex-1">
						<div class="font-medium text-sm">
							{peerPersonName(r.peerDid, r.deviceLabel, localPairingLabel)}
						</div>
						{#if r.peerDid}
							<div
								class="text-muted-foreground/65 mt-0.5 font-mono text-[11px] break-all"
								title={r.peerDid}
							>
								<span class="sm:hidden">{shortPeerDid(r.peerDid)}</span>
								<span class="hidden sm:inline">{r.peerDid}</span>
							</div>
						{/if}
					</div>
					{#if r.status === 'active'}
						<button
							type="button"
							class="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap"
							disabled={actionBusy}
							title={t('peer.removePeerTitle')}
							onclick={() => void revoke(r.peerDid)}
						>
							{t('peer.removePeer')}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
