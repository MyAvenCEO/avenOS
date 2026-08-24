<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { base64ToBytes, loadPdf, renderPageToCanvas } from './pdf'

/**
 * The shelf's right pane: ONE artifact, every page rendered as our own
 * pdf.js canvases stacked under a plain scroll — no iframe, no native PDF
 * chrome, no toolbar. The bytes come from `artifact_read_base64`.
 */

let { fileName }: { fileName: string } = $props()

let pages = $state<HTMLDivElement | null>(null)
let width = $state(0)
let failure = $state<string | null>(null)
let loading = $state(true)

$effect(() => {
	const name = fileName
	const host = pages
	// Page width follows the pane — a resize re-renders at the new width.
	const pageWidth = Math.floor(width)
	if (!host || pageWidth <= 0 || !isTauri()) return
	let stale = false
	loading = true
	failure = null
	;(async () => {
		try {
			const encoded = await invoke<string>('artifact_read_base64', { fileName: name })
			if (stale) return
			const doc = await loadPdf(base64ToBytes(encoded))
			try {
				if (stale) return
				host.replaceChildren()
				for (let number = 1; number <= doc.numPages; number++) {
					const page = await doc.getPage(number)
					if (stale) return
					const canvas = document.createElement('canvas')
					canvas.className = 'block w-full rounded-xl shadow-[0_1px_3px_rgba(30,41,59,0.12)]'
					host.appendChild(canvas)
					await renderPageToCanvas(page, canvas, pageWidth)
				}
				if (!stale) loading = false
			} finally {
				void doc.loadingTask.destroy()
			}
		} catch (cause) {
			if (stale) return
			failure = cause instanceof Error ? cause.message : String(cause)
			loading = false
		}
	})()
	return () => {
		stale = true
	}
})
</script>

<div class="min-h-0 flex-1 overflow-y-auto p-4">
	{#if !isTauri()}
		<p class="text-foreground/40 text-xs">Die Vorschau gibt es nur in der App.</p>
	{:else if failure}
		<p class="text-error-strong text-xs">{failure}</p>
	{:else if loading}
		<p class="text-foreground/40 text-xs">Vorschau wird geladen …</p>
	{/if}
	<div bind:this={pages} bind:clientWidth={width} class="flex flex-col gap-3"></div>
</div>
