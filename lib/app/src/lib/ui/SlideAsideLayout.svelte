<script lang="ts">
	import type { Snippet } from 'svelte'
	import { mobileFabBottomClass } from '$lib/shell'
	import { mobileChromeOverrides } from '$lib/shell/mobile-chrome.svelte'
	import MobileAsideDrawer from './MobileAsideDrawer.svelte'

	type Props = {
		asideLabel: string
		/** Tailwind `md:grid-cols-*` for desktop two-column layout. */
		desktopGridClass?: string
		/** Extra classes on the root grid wrapper. */
		class?: string
		/** Extra classes on the main content column. */
		mainClass?: string
		/** Extra classes on the inner content wrapper (mobile bottom padding for FAB). */
		contentClass?: string
		open?: boolean
		aside: Snippet
		/** Main column content (SvelteKit page outlet or inline panel). */
		children: Snippet
		/** When set, remount main content on route change (Tauri/WKWebView outlet refresh). */
		routeKey?: string
	}

	let {
		asideLabel,
		desktopGridClass = 'md:grid-cols-[14rem_minmax(0,1fr)]',
		class: className = '',
		mainClass = 'relative flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-none',
		contentClass = 'pb-16 md:pb-0',
		open = $bindable(false),
		aside,
		children,
		routeKey,
	}: Props = $props()

	const asideId = `slide-aside-${Math.random().toString(36).slice(2, 9)}`
	const chrome = $derived(mobileChromeOverrides())
	const showAsideFab = $derived(!chrome.hideAsideNav)

	function toggle() {
		open = !open
	}
</script>

<div class="flex h-full min-h-0 w-full flex-1 flex-col md:grid md:h-full {desktopGridClass} {className}">
	<aside
		id={asideId}
		class="hidden min-h-0 flex-col border-r border-border/60 bg-card/20 px-3 pt-1 pb-6 md:flex md:min-h-0"
		aria-label={asideLabel}
	>
		{@render aside()}
	</aside>

	<MobileAsideDrawer bind:open side="left" ariaLabel={asideLabel} zIndex={50}>
		{#snippet children()}
			{@render aside()}
		{/snippet}
	</MobileAsideDrawer>

	<main class={mainClass}>
		<div class={contentClass}>
			{#if routeKey !== undefined}
				{#key routeKey}
					{@render children()}
				{/key}
			{:else}
				{@render children()}
			{/if}
		</div>

		{#if showAsideFab}
			<button
				type="button"
				class="border-border bg-background/95 text-foreground hover:bg-background fixed z-30 inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-colors max-sm:left-3 {mobileFabBottomClass} md:hidden"
				onclick={toggle}
				aria-expanded={open}
				aria-controls={asideId}
				aria-label={open ? 'Close navigation' : 'Open navigation'}
			>
				<svg
					viewBox="0 0 24 24"
					class="size-5 shrink-0 opacity-80"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					{#if open}
						<path d="M18 6 6 18M6 6l12 12" />
					{:else}
						<path d="M4 6h16M4 12h16M4 18h16" />
					{/if}
				</svg>
			</button>
		{/if}
	</main>
</div>
