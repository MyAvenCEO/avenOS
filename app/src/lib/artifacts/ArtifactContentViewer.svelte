<script lang="ts">
import { base64ToBytes, loadPdf, renderPageToCanvas } from './pdf'

let { mediaType, base64 }: { mediaType: string; base64: string } = $props()

const bytes = $derived(base64ToBytes(base64))
const text = $derived.by(() => {
	if (!(mediaType.startsWith('text/') || mediaType.includes('json'))) return null
	const decoded = new TextDecoder().decode(bytes)
	if (!mediaType.includes('json')) return decoded
	try {
		return JSON.stringify(JSON.parse(decoded), null, 2)
	} catch {
		return decoded
	}
})
let imageUrl = $state<string | null>(null)
let pages = $state<HTMLDivElement | null>(null)
let width = $state(0)
let failure = $state<string | null>(null)
let loading = $state(false)

$effect(() => {
	if (!mediaType.startsWith('image/')) return
	const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }))
	imageUrl = url
	return () => {
		URL.revokeObjectURL(url)
		imageUrl = null
	}
})

$effect(() => {
	const host = pages
	const pageWidth = Math.floor(width)
	if (mediaType !== 'application/pdf' || !host || pageWidth <= 0) return
	let stale = false
	loading = true
	failure = null
	;(async () => {
		try {
			const doc = await loadPdf(bytes)
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
			if (!stale) {
				failure = cause instanceof Error ? cause.message : String(cause)
				loading = false
			}
		}
	})()
	return () => {
		stale = true
	}
})
</script>

{#if text !== null}
	<pre
		class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed"
	>{text}</pre>
{:else if imageUrl}
	<div class="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
		<img src={imageUrl} alt="Artifact content" class="max-w-full rounded-xl">
	</div>
{:else if mediaType === 'application/pdf'}
	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if failure}
			<p class="text-error-strong text-xs">{failure}</p>
		{/if}
		{#if loading}
			<p class="text-foreground/40 text-xs">PDF wird gerendert …</p>
		{/if}
		<div bind:this={pages} bind:clientWidth={width} class="flex flex-col gap-3"></div>
	</div>
{:else}
	<div class="p-4 text-foreground/50 text-xs">
		<p>Binärer Inhalt · {mediaType}</p>
		<p class="mt-1 font-mono">{bytes.byteLength.toLocaleString('de-DE')} Bytes</p>
	</div>
{/if}
