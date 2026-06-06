<script lang="ts" generics="T">
import type { Snippet } from 'svelte'

let {
	items,
	row,
	itemHeight,
	estimate = 48,
	overscan = 8,
	class: klass = ''
}: {
	items: T[]
	row: Snippet<[T, number]>
	/** Fixed row height (px) — fast path; omit for dynamic measurement. */
	itemHeight?: number
	/** Initial guess for dynamic rows before they're measured. */
	estimate?: number
	overscan?: number
	class?: string
} = $props()

let viewport = $state<HTMLElement | null>(null)
let rowsEl = $state<HTMLElement | null>(null)
let scrollTop = $state(0)
let viewportH = $state(600)

// Measured heights (dynamic mode only).
let heights = $state<number[]>([])
$effect(() => {
	if (itemHeight === undefined && heights.length !== items.length) {
		heights = new Array(items.length).fill(estimate)
	}
})

// Prefix-sum offsets: offsets[i] = top of item i, offsets[n] = total height.
const offsets = $derived.by(() => {
	const n = items.length
	const o = new Float64Array(n + 1)
	if (itemHeight !== undefined) {
		for (let i = 0; i <= n; i++) o[i] = i * itemHeight
	} else {
		for (let i = 0; i < n; i++) o[i + 1] = o[i] + (heights[i] || estimate)
	}
	return o
})
const total = $derived(items.length ? offsets[items.length] : 0)

function firstAtOrBefore(top: number): number {
	let lo = 0
	let hi = items.length - 1
	let ans = 0
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (offsets[mid] <= top) {
			ans = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return ans
}

const start = $derived(Math.max(0, firstAtOrBefore(scrollTop) - overscan))
const end = $derived(Math.min(items.length, firstAtOrBefore(scrollTop + viewportH) + overscan + 1))
const padTop = $derived(items.length ? offsets[start] : 0)
const padBottom = $derived(items.length ? total - offsets[end] : 0)
const visible = $derived(items.slice(start, end).map((d, i) => ({ d, index: start + i })))

function onScroll(): void {
	if (viewport) scrollTop = viewport.scrollTop
}

// Track viewport height.
$effect(() => {
	if (!viewport) return
	const ro = new ResizeObserver(() => {
		if (viewport) viewportH = viewport.clientHeight
	})
	ro.observe(viewport)
	viewportH = viewport.clientHeight
	return () => ro.disconnect()
})

// Measure rendered rows (dynamic mode) and feed real heights back in.
$effect(() => {
	if (itemHeight !== undefined || !rowsEl) return
	void visible
	const children = rowsEl.children
	for (let i = 0; i < children.length; i++) {
		const idx = start + i
		const h = (children[i] as HTMLElement).offsetHeight
		if (h && Math.abs((heights[idx] || estimate) - h) > 0.5) heights[idx] = h
	}
})
</script>

<div bind:this={viewport} onscroll={onScroll} class="min-h-0 flex-1 overflow-auto {klass}">
	<div style="height:{padTop}px"></div>
	<div bind:this={rowsEl}>
		{#each visible as v (v.index)}
			{@render row(v.d, v.index)}
		{/each}
	</div>
	<div style="height:{padBottom}px"></div>
</div>
