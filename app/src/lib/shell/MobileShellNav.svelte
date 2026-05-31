<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { mobileFabBottomClass, mobileProfileFabZClass, navigateApp } from '$lib/shell'
	import MobileAsideDrawer from '$lib/ui/MobileAsideDrawer.svelte'
	import MobileAsideNavLink from '$lib/ui/MobileAsideNavLink.svelte'
	import MobileAsideSectionLabel from '$lib/ui/MobileAsideSectionLabel.svelte'
	import { mobileChromeOverrides } from './mobile-chrome.svelte'

	type NavItem = {
		href: string
		label: string
		active: boolean
	}

	let {
		selfNavLabel,
		selfActive
	}: {
		selfNavLabel: string
		selfActive: boolean
	} = $props()

	let navOpen = $state(false)

	const path = $derived(page.url.pathname)
	const chrome = $derived(mobileChromeOverrides())

	const intentsActive = $derived(path === '/')
	const sandboxActive = $derived(path.startsWith('/sandbox'))
	const uiLabActive = $derived(path.startsWith('/ui-lab'))
	const docsActive = $derived(path.startsWith('/docs'))
	const sparksNavActive = $derived(path.startsWith('/sparks'))
	const dbActive = $derived(path.startsWith('/db'))
	const vaultNavActive = $derived(path.startsWith('/vault'))
	const avenCityActive = $derived(path.startsWith('/aven-city'))

	const navItems = $derived<NavItem[]>([
		{ href: '/', label: t('nav.intents'), active: intentsActive },
		{ href: '/sandbox', label: t('nav.sandbox'), active: sandboxActive },
		{ href: '/ui-lab', label: t('nav.uiLab'), active: uiLabActive },
		{ href: '/sparks', label: t('nav.sparks'), active: sparksNavActive },
		{ href: '/db', label: t('nav.db'), active: dbActive },
		{ href: '/vault', label: t('nav.vault'), active: vaultNavActive },
		{ href: '/aven-city', label: t('nav.avenCity'), active: avenCityActive },
		{ href: '/docs', label: t('nav.docs'), active: docsActive }
	])

	const showNavFab = $derived(!chrome.hideProfile)

	$effect(() => {
		void path
		navOpen = false
	})

	function closeNav() {
		navOpen = false
	}

	function toggleNav() {
		navOpen = !navOpen
	}
</script>

<MobileAsideDrawer
	bind:open={navOpen}
	side="right"
	ariaLabel={t('nav.appNavigation')}
	hideFromClass="sm:hidden"
	zIndex={49}
>
	{#snippet children()}
		<MobileAsideSectionLabel align="right">{t('nav.navigate')}</MobileAsideSectionLabel>
		<nav class="flex flex-col gap-1" aria-label={t('nav.appSections')}>
			{#each navItems as item (item.href)}
				<MobileAsideNavLink
					href={item.href}
					active={item.active}
					align="right"
					aria-current={item.active ? 'page' : undefined}
					onclick={(e) => {
						closeNav()
						navigateApp(item.href, e)
					}}
				>
					{item.label}
				</MobileAsideNavLink>
			{/each}
		</nav>
	{/snippet}

	{#snippet footer()}
		<MobileAsideSectionLabel align="right">{t('nav.self')}</MobileAsideSectionLabel>
		<nav class="flex flex-col gap-1" aria-label={t('nav.self')}>
			<MobileAsideNavLink
				href="/settings/peers"
				active={selfActive}
				align="right"
				aria-current={selfActive ? 'page' : undefined}
				onclick={(e) => {
					closeNav()
					navigateApp('/settings/peers', e)
				}}
			>
				{selfNavLabel}
			</MobileAsideNavLink>
		</nav>
	{/snippet}
</MobileAsideDrawer>

{#if showNavFab}
	<button
		type="button"
		class="border-border bg-background/95 text-foreground hover:bg-background fixed right-3 {mobileFabBottomClass} {mobileProfileFabZClass} inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-colors sm:hidden
			{selfActive ? 'ring-2 ring-primary/30' : ''}"
		onclick={toggleNav}
		aria-expanded={navOpen}
		aria-label={navOpen ? t('nav.closeAppNavigation') : selfNavLabel}
		title={selfNavLabel}
	>
		<svg
			viewBox="0 0 24 24"
			class="size-5 shrink-0 opacity-85"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{#if navOpen}
				<path d="M18 6 6 18M6 6l12 12" />
			{:else}
				<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			{/if}
		</svg>
	</button>
{/if}
