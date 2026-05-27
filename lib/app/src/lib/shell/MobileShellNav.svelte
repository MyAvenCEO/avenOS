<script lang="ts">
	import { page } from '$app/state'
	import { mobileFabBottomClass, navigateApp } from '$lib/shell'
	import MobileAsideDrawer from '$lib/ui/MobileAsideDrawer.svelte'
	import MobileAsideNavLink from '$lib/ui/MobileAsideNavLink.svelte'
	import MobileAsideSectionLabel from '$lib/ui/MobileAsideSectionLabel.svelte'
	import { selfNavSections } from './self-nav'
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
	const docsActive = $derived(path.startsWith('/docs'))
	const sparksNavActive = $derived(path.startsWith('/sparks'))
	const dbActive = $derived(path.startsWith('/db'))

	const navItems = $derived<NavItem[]>([
		{ href: '/', label: 'Intents', active: intentsActive },
		{ href: '/sandbox', label: 'Sandbox', active: sandboxActive },
		{ href: '/sparks', label: 'Sparks', active: sparksNavActive },
		{ href: '/db', label: 'DB', active: dbActive },
		{ href: '/docs', label: 'Docs', active: docsActive },
		{ href: '/self/peers', label: selfNavLabel, active: selfActive }
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
	ariaLabel="App navigation"
	hideFromClass="sm:hidden"
	zIndex={49}
>
	{#snippet children()}
		<MobileAsideSectionLabel align="right">Navigate</MobileAsideSectionLabel>
		<nav class="flex flex-col gap-1" aria-label="App sections">
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
		<div class="mb-3 px-1">
			<MobileAsideSectionLabel align="right">Self</MobileAsideSectionLabel>
			<p class="truncate text-[15px] font-semibold tracking-tight" title={selfNavLabel}>
				{selfNavLabel}
			</p>
		</div>
		<nav class="flex max-h-[min(40vh,14rem)] flex-col gap-3 overflow-y-auto" aria-label="Self settings">
			{#each selfNavSections as section (section.title)}
				<div class="flex flex-col gap-1">
					<MobileAsideSectionLabel align="right" class="mb-1 opacity-70">
						{section.title}
					</MobileAsideSectionLabel>
					{#each section.items as tab (tab.href)}
						{@const active = tab.match(path)}
						<MobileAsideNavLink
							href={tab.href}
							active={active}
							align="right"
							muted
							aria-current={active ? 'page' : undefined}
							onclick={(e) => {
								closeNav()
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
</MobileAsideDrawer>

{#if showNavFab}
	<button
		type="button"
		class="border-border bg-background/95 text-foreground hover:bg-background fixed right-3 {mobileFabBottomClass} z-[47] inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-colors sm:hidden
			{selfActive ? 'ring-2 ring-primary/30' : ''}"
		onclick={toggleNav}
		aria-expanded={navOpen}
		aria-label={navOpen ? 'Close app navigation' : selfNavLabel}
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
