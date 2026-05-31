<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { useSelfContext } from '$lib/self/self-context.svelte'
	import { pickVaultRowForIdentity } from '$lib/self/active-vault-ui'
	import SelfDidCard from '$lib/self/SelfDidCard.svelte'
	import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/self/vault'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { copyToClipboard } from '$lib/runtime/clipboard'
	import { deviceSession } from '$lib/self/device-session-store'

	const ctx = useSelfContext()

	let copyKey = $state<string | null>(null)
	let vaults = $state<VaultListEntry[]>([])

	const sessionKind = $derived($deviceSession.kind)

	$effect(() => {
		if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked') return
		void $deviceSession
		void (async () => {
			try {
				vaults = await vaultList()
			} catch {
				vaults = []
			}
		})()
	})

	const activeVault = $derived.by(() => {
		if ($deviceSession.kind === 'locked') return undefined
		return pickVaultRowForIdentity(vaults, $deviceSession)
	})

	const personName = $derived.by(() => {
		const v = activeVault
		return v ? vaultCardTitle(v) : t('self.identity.title')
	})

	const deviceLabel = $derived(activeVault?.deviceLabel?.trim() || t('common.thisDevice'))

	async function copy(label: string, value: string | undefined): Promise<void> {
		if (!value) return
		const ok = await copyToClipboard(value)
		if (ok) {
			copyKey = label
			setTimeout(() => {
				if (copyKey === label) copyKey = null
			}, 1200)
		} else {
			copyKey = null
		}
	}
</script>

<svelte:head>
	<title>{t('self.identity.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{personName}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('self.identity.subtitle', { device: deviceLabel })}
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<section class="space-y-3">
		<SelfDidCard
			badge={t('self.identity.deviceDid')}
			title={deviceLabel}
			description={t('self.identity.deviceDidDescription')}
			did={ctx.devicePeerDid}
			copied={copyKey === 'device-did'}
			onCopy={() => void copy('device-did', ctx.devicePeerDid)}
			emptyHint={!ctx.status?.registered ? t('self.identity.unlockToProvisionDid') : undefined}
		>
			{#snippet technical()}
				{#if ctx.peerPubB64}
					<p class="text-[10px] uppercase tracking-wide opacity-80">{t('self.identity.secureEnclaveKey')}</p>
					<pre class="overflow-x-auto font-mono text-[10px] leading-snug select-text">{ctx.peerPubB64}</pre>
				{/if}
				<p>{t('self.identity.deviceCryptoNote')}</p>
			{/snippet}
		</SelfDidCard>

		<SelfDidCard
			badge={t('self.identity.peerDid')}
			title={personName}
			description={t('self.identity.peerDidDescription')}
			did={ctx.signingPeerDid}
			copied={copyKey === 'peer-did'}
			onCopy={() => void copy('peer-did', ctx.signingPeerDid)}
			emptyHint={!ctx.status?.unlocked ? t('self.identity.unlockToDeriveDid') : undefined}
		>
			{#snippet technical()}
				{#if ctx.signingPubB64}
					<p class="text-[10px] uppercase tracking-wide opacity-80">{t('self.identity.verifyingKey')}</p>
					<pre class="overflow-x-auto font-mono text-[10px] leading-snug select-text">{ctx.signingPubB64}</pre>
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-2 py-1 text-[10px]"
						onclick={() => void copy('signing-pub', ctx.signingPubB64)}
					>
						{copyKey === 'signing-pub' ? t('common.copied') : t('common.copyKeyBytes')}
					</button>
				{/if}
				<p>{t('self.identity.signingCryptoNote')}</p>
			{/snippet}
		</SelfDidCard>
	</section>
</div>
