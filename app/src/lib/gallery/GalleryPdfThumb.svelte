<script lang="ts">
	import { browser } from '$app/environment'
	import { createPdfObjectUrlFromBase64, renderPdfFirstPageDataUrl } from '$lib/gallery/pdf-thumbnail'

	let { contentB64 }: { contentB64: string | null | undefined } = $props()

	type Status = 'loading' | 'raster' | 'native' | 'err'
	let status = $state<Status>('loading')
	let dataUrl = $state<string | null>(null)
	let nativeBlobUrl = $state<string | null>(null)

	$effect(() => {
		if (!browser) return
		void contentB64

		let cancelled = false
		/** Blob URL we own; revoked on cleanup or when superseded. */
		let heldBlob: string | null = null

		status = 'loading'
		dataUrl = null
		nativeBlobUrl = null

		const b64 = typeof contentB64 === 'string' ? contentB64 : ''

		void (async () => {
			const raster = await renderPdfFirstPageDataUrl(b64)
			if (cancelled) return
			if (raster) {
				dataUrl = raster
				status = 'raster'
				return
			}
			const u = createPdfObjectUrlFromBase64(b64)
			if (cancelled) {
				if (u) URL.revokeObjectURL(u)
				return
			}
			if (u) {
				heldBlob = u
				nativeBlobUrl = u
				status = 'native'
			} else {
				status = 'err'
			}
		})()

		return () => {
			cancelled = true
			if (heldBlob) {
				URL.revokeObjectURL(heldBlob)
				heldBlob = null
			}
			nativeBlobUrl = null
		}
	})
</script>

{#if status === 'raster' && dataUrl}
	<img src={dataUrl} alt="" class="h-full w-full object-cover object-top" loading="lazy" decoding="async" />
{:else if status === 'native' && nativeBlobUrl}
	<iframe
		title=""
		src="{nativeBlobUrl}#page=1"
		class="bg-muted/20 pointer-events-none h-full min-h-[120px] w-full border-0"
		loading="lazy"
	></iframe>
{:else if status === 'loading'}
	<div
		class="bg-muted/50 flex h-full w-full animate-pulse items-center justify-center"
		aria-hidden="true"
	>
		<span class="text-muted-foreground font-mono text-[10px] font-bold tracking-wider uppercase">PDF…</span>
	</div>
{:else}
	<div class="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 p-4">
		<span
			class="bg-background/80 text-foreground rounded px-2 py-1 font-mono text-[10px] font-bold tracking-wider uppercase"
		>
			PDF
		</span>
		<span class="text-center text-[11px] leading-snug opacity-80">Preview unavailable</span>
	</div>
{/if}
