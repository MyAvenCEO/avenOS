<script lang="ts">
	import { page } from '$app/state'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
	import { t } from '$lib/i18n'
	import { vaultNavSections } from '$lib/vault/vault-nav'
	import { isVaultEmbedMode } from '$lib/vault/tauri-vault-embed'
	import VaultEmbedFrame from '$lib/vault/VaultEmbedFrame.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let { children: pageOutlet } = $props()

	const path = $derived(page.url.pathname)
	const vaultEmbed = $derived(isVaultEmbedMode(page.url.searchParams))
	const navSections = $derived(asideNavSectionsFromRoutes(vaultNavSections(), path))
	const useNativeEmbed = $derived(isTauriRuntime() && !vaultEmbed)
</script>

{#if vaultEmbed}
	<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
		{@render pageOutlet()}
	</div>
{:else}
	<AsidePageLayout
		asideLabel={t('vaultNav.title')}
		sections={navSections}
		muted
		routeKey={path}
		mainClass="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-none"
		contentClass="flex min-h-0 flex-1 flex-col pb-16 md:pb-0"
		innerContentClass="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 pb-8 sm:px-6 md:px-8"
	>
		{#snippet header()}
			<div class="mb-3 px-3">
				<p class="text-muted-foreground text-xs leading-snug">{t('vaultNav.subtitle')}</p>
			</div>
		{/snippet}

		{#snippet children()}
			{#if useNativeEmbed}
				<VaultEmbedFrame />
			{:else}
				{@render pageOutlet()}
			{/if}
		{/snippet}
	</AsidePageLayout>
{/if}
