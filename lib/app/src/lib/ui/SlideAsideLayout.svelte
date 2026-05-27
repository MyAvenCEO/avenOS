<script lang="ts">
	import type { Snippet } from 'svelte'
	import { mobileFabBottomClass } from '$lib/shell'
	import { mobileChromeOverrides } from '$lib/shell/mobile-chrome.svelte'

	type Props = {
		asideLabel: string
		/** Tailwind width class for the mobile drawer panel. */
		asideWidthClass?: string
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
		main: Snippet
	}

	let {
		asideLabel,
		asideWidthClass = 'w-[min(85vw,14rem)] max-w-[14rem]',
		desktopGridClass = 'md:grid-cols-[14rem_minmax(0,1fr)]',
		class: className = '',
		mainClass = 'relative flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-none',
		contentClass = 'pb-16 md:pb-0',
		open = $bindable(false),
		aside,
		main,
	}: Props = $props()

	const asideId = `slide-aside-${Math.random().toString(36).slice(2, 9)}`
	const chrome = $derived(mobileChromeOverrides())
	const showAsideFab = $derived(!chrome.hideAsideNav)

	function close() {
		open = false
	}

	function toggle() {
		open = !open
	}

	$effect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
</script>

<div class="flex h-full min-h-0 w-full flex-1 flex-col md:grid md:h-full {desktopGridClass} {className}">
	{#if open}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px] md:hidden"
			aria-label="Close sidebar"
			onclick={close}
		></button>
	{/if}

	<aside
		id={asideId}
		class="fixed inset-y-0 left-0 z-50 flex min-h-0 flex-col border-r border-border/60 bg-card/98 px-3 pt-1 pb-6 shadow-xl transition-transform duration-200 ease-out backdrop-blur-md
			md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0 md:bg-card/20 md:shadow-none md:backdrop-blur-none
			{asideWidthClass}
			{open ? 'translate-x-0' : '-translate-x-full pointer-events-none md:pointer-events-auto md:translate-x-0'}"
		aria-label={asideLabel}
	>
		{@render aside()}
	</aside>

	<main class={mainClass}>
		<div class={contentClass}>
			{@render main()}
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
