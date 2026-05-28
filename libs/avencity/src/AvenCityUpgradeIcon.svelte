<script lang="ts">
	import type { AvenCityUpgradeIcon } from './upgrades'

	let {
		variant,
		size = 28,
		class: className = ''
	}: {
		variant: AvenCityUpgradeIcon
		size?: number | string
		class?: string
	} = $props()

	const dimension = $derived(typeof size === 'number' ? size : undefined)
</script>

<svg
	class={className}
	width={dimension}
	height={dimension}
	viewBox="0 0 32 32"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	style={typeof size === 'string' ? `width:${size};height:${size}` : undefined}
>
	{#if variant === 'small-dome'}
		<path d="M6 22 L16 8 L26 22 Z" />
		<path d="M16 8 L16 22" />
		<path d="M6 22 L26 22" />
		<path d="M10 22 L10 18" />
		<path d="M22 22 L22 18" />
	{:else if variant === 'large-dome'}
		<path d="M4 22 Q16 6 28 22 Z" />
		<path d="M4 22 L28 22" />
		<path d="M8 22 L8 17" />
		<path d="M24 22 L24 17" />
		<path d="M16 22 L16 14" />
	{:else if variant === 'glamping-dome'}
		<path d="M5 22 Q16 7 27 22 Z" />
		<path d="M5 22 L27 22" />
		<rect x="13" y="16" width="6" height="6" rx="0.5" />
		<path d="M16 7 L16 10" />
		<circle cx="16" cy="6" r="1.2" />
		<path d="M9 22 L9 18" />
		<path d="M23 22 L23 18" />
	{:else if variant === 'geo-lodge'}
		<circle cx="16" cy="15" r="8" />
		<path d="M8 15 L24 15" />
		<path d="M16 7 L16 23" />
		<path d="M10.5 9.5 L21.5 20.5" />
		<path d="M21.5 9.5 L10.5 20.5" />
		<path d="M6 23 L26 23" />
		<path d="M11 23 L11 20" />
		<path d="M21 23 L21 20" />
	{/if}
</svg>
