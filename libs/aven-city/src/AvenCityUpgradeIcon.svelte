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
	{:else if variant === 'gathering-dome'}
		<path d="M3 22 Q16 4 29 22 Z" />
		<path d="M3 22 L29 22" />
		<path d="M16 4 L16 22" />
		<path d="M7 22 L7 16" />
		<path d="M25 22 L25 16" />
		<path d="M11 22 L11 19" />
		<path d="M21 22 L21 19" />
	{:else if variant === 'village-dome'}
		<path d="M2 22 Q16 3 30 22 Z" />
		<path d="M2 22 L30 22" />
		<path d="M8 22 L8 17" />
		<path d="M24 22 L24 17" />
		<path d="M13 22 L13 18" />
		<path d="M19 22 L19 18" />
		<rect x="14" y="14" width="4" height="4" rx="0.5" />
	{:else if variant === 'settlement-dome'}
		<path d="M2 22 Q16 2 30 22 Z" />
		<path d="M2 22 L30 22" />
		<path d="M6 22 L6 15" />
		<path d="M26 22 L26 15" />
		<path d="M12 22 L12 17" />
		<path d="M20 22 L20 17" />
		<path d="M16 2 L16 8" />
		<circle cx="16" cy="1.5" r="1" />
		<path d="M10 22 L22 22" />
	{:else if variant === 'grand-lodge'}
		<circle cx="16" cy="14" r="9.5" />
		<path d="M6.5 14 L25.5 14" />
		<path d="M16 4.5 L16 23.5" />
		<path d="M9 8.5 L23 19.5" />
		<path d="M23 8.5 L9 19.5" />
		<path d="M4 23.5 L28 23.5" />
		<path d="M8 23.5 L8 19" />
		<path d="M24 23.5 L24 19" />
		<path d="M12 23.5 L12 20" />
		<path d="M20 23.5 L20 20" />
	{:else if variant === 'apex-citadel'}
		<circle cx="16" cy="13.5" r="10.5" />
		<path d="M5.5 13.5 L26.5 13.5" />
		<path d="M16 3 L16 24" />
		<path d="M8 7.5 L24 19.5" />
		<path d="M24 7.5 L8 19.5" />
		<path d="M3 24 L29 24" />
		<path d="M7 24 L7 18.5" />
		<path d="M25 24 L25 18.5" />
		<path d="M11 24 L11 20" />
		<path d="M21 24 L21 20" />
		<path d="M16 3 L16 6" />
		<circle cx="16" cy="2.2" r="1.1" />
	{/if}
</svg>
