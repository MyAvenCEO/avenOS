<script lang="ts">
	import { page } from '$app/state'
	import { mobileFabBottomClass, navigateApp } from '$lib/shell'
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

	$effect(() => {
		if (!navOpen) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') navOpen = false
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	function closeNav() {
		navOpen = false
	}

	function toggleNav() {
		navOpen = !navOpen
	}
</script>

{#if navOpen}
	<button
		type="button"
		class="fixed inset-0 z-[48] bg-background/55 backdrop-blur-[2px] sm:hidden"
		aria-label="Close app navigation"
		onclick={closeNav}
	></button>
{/if}

<aside
	class="border-border/60 bg-card/98 fixed inset-y-0 right-0 z-[49] flex w-[min(85vw,15rem)] max-w-[15rem] flex-col border-l px-4 shadow-xl backdrop-blur-md transition-transform duration-200 ease-out sm:hidden
		{navOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'}"
	aria-label="App navigation"
>
	<div class="flex min-h-0 flex-1 flex-col pt-[max(0.75rem,env(safe-area-inset-top))]">
		<div class="flex min-h-0 flex-1 flex-col justify-end pb-4">
			<p class="text-muted-foreground mb-3 text-[9px] font-bold tracking-[0.2em] uppercase">Navigate</p>
			<nav class="flex flex-col gap-0.5" aria-label="App sections">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						data-sveltekit-preload-data="hover"
						class="rounded-xl px-3 py-2.5 text-[13px] font-semibold tracking-tight transition-colors
							{item.active
							? 'bg-accent/15 text-foreground'
							: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
						aria-current={item.active ? 'page' : undefined}
						onclick={(e) => {
							closeNav()
							navigateApp(item.href, e)
						}}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<div
			class="border-border/60 shrink-0 border-t pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
		>
			<div class="mb-3 px-1">
				<p class="text-muted-foreground mb-1 text-[9px] font-bold tracking-[0.2em] uppercase">Self</p>
				<p class="truncate text-sm font-semibold tracking-tight" title={selfNavLabel}>{selfNavLabel}</p>
			</div>
			<nav class="flex max-h-[min(40vh,14rem)] flex-col gap-3 overflow-y-auto" aria-label="Self settings">
				{#each selfNavSections as section (section.title)}
					<div class="flex flex-col gap-0.5">
						<p
							class="text-muted-foreground/70 mb-0.5 px-1 text-[9px] font-bold tracking-[0.2em] uppercase"
						>
							{section.title}
						</p>
						{#each section.items as tab (tab.href)}
							{@const active = tab.match(path)}
							<a
								href={tab.href}
								data-sveltekit-preload-data="hover"
								class="rounded-xl px-3 py-2 text-[13px] font-medium tracking-tight transition-colors
									{active
									? 'bg-accent/15 text-foreground'
									: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
								aria-current={active ? 'page' : undefined}
								onclick={(e) => {
									closeNav()
									navigateApp(tab.href, e)
								}}
							>
								{tab.label}
							</a>
						{/each}
					</div>
				{/each}
			</nav>
		</div>
	</div>
</aside>

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
