<script lang="ts">
let {
	size = 14,
	filled = true
}: {
	size?: number
	filled?: boolean
} = $props()
</script>

<svg
	class="avencity-heart-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={filled ? 0 : 2}
	stroke-linejoin="round"
	aria-hidden="true"
	role="presentation"
>
	<path
		d="M12 21s-7.5-4.9-10-9.4C.6 9 1.4 5.6 4.3 4.4 6.5 3.5 9 4.2 10.4 6c.6.7.9 1.2 1.6 1.2S13 6.7 13.6 6C15 4.2 17.5 3.5 19.7 4.4c2.9 1.2 3.7 4.6 2.3 7.2C19.5 16.1 12 21 12 21z"
	/>
</svg>

<style>
.avencity-heart-icon {
	display: block;
	flex-shrink: 0;
}
</style>
