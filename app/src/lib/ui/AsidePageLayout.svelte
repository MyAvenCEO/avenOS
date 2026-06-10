<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { AsideNavSection } from './aside-nav'
	import { asidePageContentClass } from './aside-nav'
	import AsideNav from './AsideNav.svelte'
	import SlideAsideLayout from './SlideAsideLayout.svelte'

	type Props = {
		asideLabel: string
		sections: AsideNavSection[]
		/** Default muted styling for aside links. */
		muted?: boolean
		/** Tailwind `md:grid-cols-*` for desktop two-column layout. */
		desktopGridClass?: string
		/** Extra classes on the root grid wrapper. */
		class?: string
		/** Extra classes on the main content column. */
		mainClass?: string
		/** Extra classes on SlideAsideLayout's inner content wrapper. */
		contentClass?: string
		/** Classes on the page outlet wrapper inside main. */
		innerContentClass?: string
		sectionLabelClass?: string
		/** When set, remount main content and close the mobile drawer on change. */
		routeKey?: string
		header?: Snippet
		/** Rendered in the aside below the nav sections (e.g. a contextual panel). */
		asideExtra?: Snippet
		/** Optional thin right aside (e.g. a metadata/detail panel). Needs a 3-col `desktopGridClass`. */
		asideRight?: Snippet
		asideRightLabel?: string
		children: Snippet
	}

	let {
		asideLabel,
		sections,
		muted = false,
		desktopGridClass = 'md:grid-cols-[14rem_minmax(0,1fr)]',
		class: className = 'min-h-0 flex-1',
		mainClass = 'relative flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-none',
		contentClass = 'pb-16 md:pb-0',
		innerContentClass = asidePageContentClass,
		sectionLabelClass,
		routeKey,
		header,
		asideExtra,
		asideRight,
		asideRightLabel,
		children,
	}: Props = $props()

	let asideOpen = $state(false)

	$effect(() => {
		void routeKey
		asideOpen = false
	})

	function closeAsideOnNav() {
		asideOpen = false
	}
</script>

<SlideAsideLayout
	bind:open={asideOpen}
	{asideLabel}
	{asideRight}
	{asideRightLabel}
	{desktopGridClass}
	class={className}
	{mainClass}
	{contentClass}
	{routeKey}
>
	{#snippet aside()}
		<AsideNav
			{sections}
			{muted}
			{sectionLabelClass}
			{header}
			footer={asideExtra}
			onItemActivate={closeAsideOnNav}
		/>
	{/snippet}

	{#snippet children()}
		<div class={innerContentClass}>
			{@render children()}
		</div>
	{/snippet}
</SlideAsideLayout>
