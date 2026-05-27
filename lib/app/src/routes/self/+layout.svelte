<script lang="ts">
	import { page } from '$app/state'
	import { pickVaultRowForIdentity } from '$lib/self/active-vault-ui'
	import { deviceSession } from '$lib/self/device-session-store'
	import { provideSelfContext } from '$lib/self/self-context.svelte'
	import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/self/vault'
	import SlideAsideLayout from '$lib/ui/SlideAsideLayout.svelte'
	import MobileAsideNavLink from '$lib/ui/MobileAsideNavLink.svelte'
	import MobileAsideSectionLabel from '$lib/ui/MobileAsideSectionLabel.svelte'
	import { navigateApp } from '$lib/shell'
	import { selfNavSections } from '$lib/shell/self-nav'
	import { browser } from '$app/environment'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let { children: pageOutlet } = $props()

	const ctx = provideSelfContext()
	const sessionKind = $derived($deviceSession.kind)

	let vaults = $state<VaultListEntry[]>([])
	let asideOpen = $state(false)

	const path = $derived(page.url.pathname)

	$effect(() => {
		void path
		asideOpen = false
	})

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
		if (!v) return 'Self'
		return vaultCardTitle(v)
	})

	const profileDevice = $derived(activeVault?.deviceLabel?.trim() ?? '')

	const navSections = selfNavSections

	function closeAsideOnNav() {
		asideOpen = false
	}
</script>

<SlideAsideLayout bind:open={asideOpen} asideLabel="Self settings" class="min-h-0 flex-1" routeKey={path}>
	{#snippet aside()}
		<div class="mb-3 space-y-0.5 px-3">
			<h2 class="text-sm font-semibold tracking-tight">{profileName}</h2>
			{#if profileDevice}
				<p class="text-muted-foreground/70 text-xs leading-snug">{profileDevice}</p>
			{/if}
		</div>

		<nav class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto md:gap-4">
			{#each navSections as section (section.title)}
				<div class="flex flex-col gap-1 md:gap-0.5">
					<MobileAsideSectionLabel class="px-0 md:px-3">
						{section.title}
					</MobileAsideSectionLabel>
					{#each section.items as tab (tab.href)}
						{@const active = tab.match(path)}
						<MobileAsideNavLink
							href={tab.href}
							active={active}
							muted
							aria-current={active ? 'page' : undefined}
							onclick={(e) => {
								closeAsideOnNav()
								navigateApp(tab.href, e)
							}}
						>
							{tab.label}
						</MobileAsideNavLink>
					{/each}
				</div>
			{/each}
		</nav>
	{/snippet}

	{#snippet children()}
		<div class="mx-auto w-full max-w-3xl px-4 pt-4 pb-8 sm:px-6 md:px-8">
			{#key path}
				{@render pageOutlet()}
			{/key}
		</div>
	{/snippet}
</SlideAsideLayout>
