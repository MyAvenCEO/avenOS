<script lang="ts">
	import { page } from '$app/state'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
	import { t } from '$lib/i18n'
	import { vaultNavSections } from '$lib/vault/vault-nav'
	import { deviceSession } from '$lib/settings/device-session-store'

	let { children: pageOutlet } = $props()

	const path = $derived(page.url.pathname)
	const navSections = $derived(asideNavSectionsFromRoutes(vaultNavSections(), path))
	const unlocked = $derived($deviceSession.kind === 'unlocked')
</script>

<AsidePageLayout asideLabel={t('vaultNav.title')} sections={navSections} muted routeKey={path}>
	{#snippet header()}
		<div class="mb-3 px-3">
			<p class="text-muted-foreground text-xs leading-snug">{t('vaultNav.subtitle')}</p>
		</div>
	{/snippet}

	{#snippet children()}
		{#if unlocked}
			{@render pageOutlet()}
		{:else}
			<p class="text-muted-foreground px-4 py-8 text-sm">{t('vaultNav.lockedHint')}</p>
		{/if}
	{/snippet}
</AsidePageLayout>
