<script lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { onDestroy } from 'svelte'

/**
 * The inline artifact preview: one locally stored file (for now the invoice
 * PDFs), rendered as a blob iframe in an in-page overlay — NEVER a separate
 * window. The bytes come from `artifact_read_base64`; the CSP's frame-src
 * already allows blob:.
 */

let { fileName, title, onclose }: { fileName: string; title: string; onclose: () => void } =
	$props()

let blobUrl = $state<string | null>(null)
let failure = $state<string | null>(null)

$effect(() => {
	let stale = false
	failure = null
	invoke<string>('artifact_read_base64', { fileName })
		.then((encoded) => {
			if (stale) return
			const raw = atob(encoded)
			const bytes = new Uint8Array(raw.length)
			for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
			blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
		})
		.catch((cause) => {
			if (!stale) failure = cause instanceof Error ? cause.message : String(cause)
		})
	return () => {
		stale = true
	}
})

function close() {
	// The object URL is ours to sweep up — revoke before handing back.
	if (blobUrl) URL.revokeObjectURL(blobUrl)
	blobUrl = null
	onclose()
}

onDestroy(() => {
	if (blobUrl) URL.revokeObjectURL(blobUrl)
})
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 sm:p-8">
	<div
		class="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-[0_8px_32px_rgba(30,41,59,0.25)]"
	>
		<div class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
			<h3 class="truncate text-sm font-medium">{title}</h3>
			<button
				type="button"
				onclick={close}
				class="rounded-full border border-border px-3 py-1 text-xs opacity-70 transition-opacity hover:opacity-100"
			>
				Schließen
			</button>
		</div>
		{#if failure}
			<p class="px-4 py-6 text-xs text-error-strong">{failure}</p>
		{:else if blobUrl}
			<iframe src={blobUrl} title="Rechnung" class="min-h-0 w-full flex-1"></iframe>
		{:else}
			<p class="px-4 py-6 text-xs opacity-50">Vorschau wird geladen …</p>
		{/if}
	</div>
</div>
