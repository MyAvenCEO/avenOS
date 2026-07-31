<!--
	The HUD's line icons.

	Drawn rather than typed: an emoji renders as a different picture on every
	platform and carries a colour the design never chose. These are single
	strokes on a 24-grid, inheriting the text colour, so they sit at the same
	weight as the label beside them.
-->
<script lang="ts" module>
export type IconName =
	| 'citizens'
	| 'settled'
	| 'permaculture'
	| 'crop'
	| 'reserve'
	| 'works'
	| 'living'
	| 'density'
	| 'sun'
	| 'dusk'
	| 'moon'
</script>

<script lang="ts">
let {
	name,
	class: klass = 'h-4 w-4',
	style
}: { name: IconName; class?: string; style?: string } = $props()
</script>

<svg
	viewBox="0 0 24 24"
	class={klass}
	{style}
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'citizens'}
		<!-- two figures: the people counted -->
		<circle cx="9" cy="8" r="3" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M16 5.5a3 3 0 0 1 0 5.9" />
		<path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
	{:else if name === 'settled'}
		<!-- a dome on its ground line: built land -->
		<path d="M3 19h18" />
		<path d="M5 19a7 7 0 0 1 14 0" />
		<path d="M12 12v7M6.6 15.2h10.8" />
	{:else if name === 'permaculture'}
		<!-- a leaf over a furrow: the growing land -->
		<path d="M20 4c0 7-4.5 11-10 11H6c0-6 4-11 10-11Z" />
		<path d="M6 20c1.5-4 4.5-7 9-9" />
	{:else if name === 'crop'}
		<!-- stalks in a row: the industrial crop a works runs on -->
		<path d="M6 20.5V9M12 20.5V6M18 20.5V9" />
		<path d="M6 9c-1.7 0-3-1.4-3-3.1 1.7 0 3 1.4 3 3.1ZM6 9c1.7 0 3-1.4 3-3.1-1.7 0-3 1.4-3 3.1Z" />
		<path
			d="M12 6c-1.7 0-3-1.4-3-3.1 1.7 0 3 1.4 3 3.1ZM12 6c1.7 0 3-1.4 3-3.1-1.7 0-3 1.4-3 3.1Z"
		/>
		<path
			d="M18 9c-1.7 0-3-1.4-3-3.1 1.7 0 3 1.4 3 3.1ZM18 9c1.7 0 3-1.4 3-3.1-1.7 0-3 1.4-3 3.1Z"
		/>
	{:else if name === 'reserve'}
		<!-- a tree left standing: land nobody has touched -->
		<path d="M12 21v-4" />
		<path d="M12 3 6.4 12h11.2L12 3Z" />
		<path d="M12 8.5 8.2 17h7.6L12 8.5Z" />
	{:else if name === 'works'}
		<!-- a dome with a stack: the works -->
		<path d="M3 20h18" />
		<path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
		<path d="M17.5 12.5V6h2.5v6.5" />
	{:else if name === 'living'}
		<!-- a dome with a door: where people live -->
		<path d="M3 20h18" />
		<path d="M5 20a7 7 0 0 1 14 0" />
		<path d="M10.2 20v-4a1.8 1.8 0 0 1 3.6 0v4" />
	{:else if name === 'density'}
		<!-- a hex with a full grid: people per area -->
		<path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6Z" />
		<circle cx="9.2" cy="10.4" r="1" fill="currentColor" stroke="none" />
		<circle cx="14.8" cy="10.4" r="1" fill="currentColor" stroke="none" />
		<circle cx="9.2" cy="14.4" r="1" fill="currentColor" stroke="none" />
		<circle cx="14.8" cy="14.4" r="1" fill="currentColor" stroke="none" />
		<circle cx="12" cy="12.4" r="1" fill="currentColor" stroke="none" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
		/>
	{:else if name === 'dusk'}
		<!-- half lit: the hours either side of the day -->
		<circle cx="12" cy="12" r="4" />
		<path d="M12 8a4 4 0 0 0 0 8Z" fill="currentColor" stroke="none" />
		<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
	{:else}
		<path d="M19 14.5A8 8 0 0 1 9.5 5a7 7 0 1 0 9.5 9.5Z" />
	{/if}
</svg>
