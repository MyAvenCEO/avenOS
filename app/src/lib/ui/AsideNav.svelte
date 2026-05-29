<script lang="ts">
	import type { Snippet } from 'svelte'
	import { navigateApp } from '$lib/shell'
	import type { AsideNavSection } from './aside-nav'
	import MobileAsideNavLink from './MobileAsideNavLink.svelte'
	import MobileAsideSectionLabel from './MobileAsideSectionLabel.svelte'

	type Props = {
		sections: AsideNavSection[]
		/** Default muted styling for links unless an item overrides. */
		muted?: boolean
		/** Extra classes on the root `<nav>`. */
		navClass?: string
		/** Extra classes on section labels (desktop horizontal padding). */
		sectionLabelClass?: string
		header?: Snippet
		/** Called after an item's own `onclick` (e.g. close mobile drawer). */
		onItemActivate?: (e: MouseEvent) => void
	}

	let {
		sections,
		muted = false,
		navClass = '',
		sectionLabelClass = 'px-0 md:px-3',
		header,
		onItemActivate,
	}: Props = $props()
</script>

{#if header}
	{@render header()}
{/if}

<nav
	class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto md:gap-4 {navClass}"
	aria-label="Section navigation"
>
	{#each sections as section (section.title ?? section.items.map((i) => i.label).join('\0'))}
		<div class="flex flex-col gap-1 md:gap-0.5">
			{#if section.title}
				<MobileAsideSectionLabel class={sectionLabelClass}>
					{section.title}
				</MobileAsideSectionLabel>
			{/if}
			{#each section.items as item (item.href ?? item.label)}
				<MobileAsideNavLink
					href={item.href}
					active={item.active}
					muted={item.muted ?? muted}
					class={item.class}
					aria-current={item['aria-current'] ?? (item.active ? 'page' : undefined)}
					aria-pressed={item['aria-pressed']}
					onclick={(e) => {
						if (item.onclick) {
							item.onclick(e)
						} else if (item.href) {
							navigateApp(item.href, e)
						}
						onItemActivate?.(e)
					}}
				>
					{item.label}
				</MobileAsideNavLink>
			{:else}
				{#if section.emptyMessage}
					<p class="text-muted-foreground px-2 py-4 text-sm md:text-xs">{section.emptyMessage}</p>
				{/if}
			{/each}
		</div>
	{/each}
</nav>
