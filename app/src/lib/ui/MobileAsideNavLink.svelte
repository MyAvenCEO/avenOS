<script lang="ts">
import type { Snippet } from 'svelte'
import { mobileAsideNavLinkClass, mobileAsideNavLinkMutedClass } from './mobile-aside'

type Props = {
	active?: boolean
	align?: 'left' | 'right'
	href?: string
	muted?: boolean
	class?: string
	'aria-current'?: 'page' | undefined
	'aria-label'?: string
	'aria-pressed'?: boolean
	onclick?: (e: MouseEvent) => void
	children: Snippet
}

let {
	active = false,
	align = 'left',
	href,
	muted = false,
	class: className = '',
	'aria-current': ariaCurrent,
	'aria-label': ariaLabel,
	'aria-pressed': ariaPressed,
	onclick,
	children
}: Props = $props()

const linkClass = $derived(
	`${muted ? mobileAsideNavLinkMutedClass(active, align) : mobileAsideNavLinkClass(active, align)} ${className}`.trim()
)
</script>

{#if href}
	<a
		{href}
		data-sveltekit-preload-data="hover"
		class={linkClass}
		aria-current={ariaCurrent}
		aria-label={ariaLabel}
		{onclick}
	>
		{@render children()}
	</a>
{:else}
	<button
		type="button"
		class={linkClass}
		aria-current={ariaCurrent}
		aria-label={ariaLabel}
		aria-pressed={ariaPressed}
		{onclick}
	>
		{@render children()}
	</button>
{/if}
