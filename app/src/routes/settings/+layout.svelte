<script lang="ts">
	import { page } from '$app/state'
	import { pickVaultRowForIdentity } from '$lib/settings/active-vault-ui'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { provideSelfContext } from '$lib/settings/self-context.svelte'
	import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/settings/vault'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
	import { t } from '$lib/i18n'
	import { settingsNavSections } from '$lib/shell/settings-nav'
	import { browser } from '$app/environment'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let { children: pageOutlet } = $props()

	const ctx = provideSelfContext()
	const sessionKind = $derived($deviceSession.kind)

	let vaults = $state<VaultListEntry[]>([])

	const path = $derived(page.url.pathname)

	const navSections = $derived(asideNavSectionsFromRoutes(settingsNavSections(), path))

	$effect(() => {
		void sessionKind
		void ctx.refresh()
	})

	$effect(() => {
		if (!browser || !isTauriRuntime()) return
		void sessionKind
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

	const profileName = $derived.by(() => {
		const v = activeVault
		if (!v) return t('nav.self')
		return vaultCardTitle(v)
	})

	const profileDevice = $derived(activeVault?.deviceLabel?.trim() ?? '')
</script>

<AsidePageLayout
	asideLabel={t('nav.selfSettings')}
	sections={navSections}
	muted
	routeKey={path}
>
	{#snippet header()}
		<div class="mb-3 space-y-0.5 px-3">
			<h2 class="text-sm font-semibold tracking-tight">{profileName}</h2>
			{#if profileDevice}
				<p class="text-muted-foreground/70 text-xs leading-snug">{profileDevice}</p>
			{/if}
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
