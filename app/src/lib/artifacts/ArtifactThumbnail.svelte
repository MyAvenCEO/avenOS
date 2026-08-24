<script lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { base64ToBytes, loadPdf, renderPageToCanvas } from './pdf'

/**
 * A tile's small first-page preview, rendered lazily on mount via the same
 * pdf.js module as the viewer — one look at the document before opening it.
 */

let { fileName }: { fileName: string } = $props()

let canvas = $state<HTMLCanvasElement | null>(null)
let width = $state(0)
let failed = $state(false)

$effect(() => {
	const name = fileName
	const target = canvas
	const tileWidth = Math.floor(width)
	if (!target || tileWidth <= 0) return
	let stale = false
	;(async () => {
		try {
			const encoded = await invoke<string>('artifact_read_base64', { fileName: name })
			if (stale) return
			const doc = await loadPdf(base64ToBytes(encoded))
			try {
				const page = await doc.getPage(1)
				if (!stale) await renderPageToCanvas(page, target, tileWidth)
			} finally {
				void doc.loadingTask.destroy()
			}
		} catch {
			if (!stale) failed = true
		}
	})()
	return () => {
		stale = true
	}
})
</script>

<!-- Fills whatever frame the tile gives it; the tile clips the overflow. -->
<div bind:clientWidth={width} class="h-full w-full overflow-hidden bg-white">
	{#if failed}
		<div class="flex h-full items-center justify-center font-mono text-foreground/30 text-xs">
			PDF
		</div>
	{:else}
		<canvas bind:this={canvas} class="block w-full"></canvas>
	{/if}
</div>
