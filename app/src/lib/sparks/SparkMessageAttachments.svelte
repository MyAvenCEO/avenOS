<script lang="ts">
	import type { FilesRow } from '@avenos/jazz-schema'
	import GalleryPdfThumb from '$lib/gallery/GalleryPdfThumb.svelte'
	import {
		fileDownloadDataUrl,
		formatBytes,
		imageDataUrl,
		isPdfMime,
	} from '$lib/gallery/file-preview'

	type Props = {
		files: FilesRow[]
		/** Message bubble uses primary colors — lighten attachment chrome. */
		inverted?: boolean
	}

	let { files, inverted = false }: Props = $props()

	let brokenIds = $state<Set<string>>(new Set())

	function markBroken(id: string): void {
		brokenIds = new Set(brokenIds).add(id)
	}

	const shellClass = $derived(
		inverted
			? 'border-primary-foreground/25 bg-primary-foreground/10'
			: 'border-border/50 bg-background/40',
	)
	const metaClass = $derived(
		inverted ? 'text-primary-foreground/80' : 'text-muted-foreground',
	)
	const titleClass = $derived(inverted ? 'text-primary-foreground' : 'text-foreground')
</script>

<div class="flex max-w-[min(100%,18rem)] flex-col gap-2" aria-label="Attachments">
	{#each files as row (row.id)}
		{@const downloadHref = fileDownloadDataUrl(row)}
		<div class="overflow-hidden rounded-xl border {shellClass}">
			<div
				class="bg-muted/30 relative aspect-[4/3] w-full overflow-hidden border-b {inverted
					? 'border-primary-foreground/20'
					: 'border-border/40'}"
			>
				{#if isPdfMime(row.mime_type)}
					<GalleryPdfThumb contentB64={row.content_b64 ?? ''} />
				{:else}
					{@const src = imageDataUrl(row)}
					{#if src && !brokenIds.has(row.id)}
						<img
							src={src}
							alt=""
							class="h-full w-full object-cover"
							loading="lazy"
							decoding="async"
							onerror={() => markBroken(row.id)}
						/>
					{:else}
						<div class="{metaClass} flex h-full w-full items-center justify-center p-4 text-center text-xs">
							No preview
						</div>
					{/if}
				{/if}
			</div>
			<div class="flex min-w-0 flex-col gap-0.5 p-2.5">
				{#if downloadHref}
					<a
						href={downloadHref}
						download={row.filename || 'download'}
						class="{titleClass} truncate text-sm font-medium leading-snug underline decoration-current/30 underline-offset-2 hover:decoration-current/70"
						title={row.filename}
					>
						{row.filename || 'Untitled'}
					</a>
				{:else}
					<p class="{titleClass} truncate text-sm font-medium leading-snug" title={row.filename}>
						{row.filename || 'Untitled'}
					</p>
				{/if}
				<p class="{metaClass} truncate text-[11px] leading-snug">
					{row.mime_type}
					<span class="mx-1 opacity-50">·</span>
					{formatBytes(row.size_bytes)}
				</p>
			</div>
		</div>
	{/each}
</div>
