<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import type { JazzRow } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'
	import GalleryPdfThumb from '$lib/gallery/GalleryPdfThumb.svelte'
	import {
		coerceByteCount,
		coerceEpochMs,
		formatBytes,
		imageDataUrl,
	} from '$lib/gallery/file-preview'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const decodedSparkId = $derived(decodeURIComponent(sparkParam))

	const sparksStore = jazzStore('sparks')
	const filesStore = jazzStore('files')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const sparkMeta = $derived(
		sparksStore.rows.find((s) => idsMatch(s.spark_id, decodedSparkId)),
	)
	const sparksResolved = $derived(sparksStore.loaded)
	const canonicalSparkId = $derived(sparkMeta?.spark_id ?? decodedSparkId)

	const rows = $derived(
		[...filesStore.rows]
			.filter((r) => idsMatch(r.spark_id, canonicalSparkId))
			.sort(
				(a, b) => coerceEpochMs(b.created_at_ms) - coerceEpochMs(a.created_at_ms),
			),
	)

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	let brokenIds = $state<Set<string>>(new Set())

	function markBroken(id: string): void {
		brokenIds = new Set(brokenIds).add(id)
	}
</script>

<svelte:head>
	<title>Gallery · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">Gallery</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Files attached to intents or talk messages in this spark. Images and PDFs show a thumbnail (first
			page for PDFs).
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your database.</p>
	{:else if !decodedSparkId}
		<p class="text-muted-foreground text-sm">Missing spark id.</p>
	{:else}
		{#if filesStore.error}
			<p
				class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug"
				role="alert"
			>
				{filesStore.error}
			</p>
		{/if}

		{#if !sparksResolved && !filesStore.error}
			<p class="text-muted-foreground text-xs">Loading spark…</p>
		{:else if sparksResolved && !sparkMeta && !filesStore.error}
			<p class="text-muted-foreground text-sm">
				No spark matches this id in your ledger —
				<button type="button" class="underline" onclick={() => goto('/sparks')}>back to sparks</button>.
			</p>
		{/if}

		{#if sparkMeta}
			{#if !filesStore.loaded && !filesStore.error}
				<p class="text-muted-foreground text-sm">Loading files…</p>
			{:else if rows.length === 0}
				<p class="text-muted-foreground rounded-xl border border-border/60 px-4 py-8 text-center text-sm">
					No files for this spark yet. Attach a PDF or image from Intents or Talk.
				</p>
			{:else}
				<ul
					class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
					aria-label="Files in this spark"
				>
					{#each rows as row (row.id)}
						<li
							class="border-input bg-card/40 flex flex-col overflow-hidden rounded-xl border shadow-sm"
						>
							<div
								class="bg-muted/30 relative aspect-square w-full overflow-hidden border-b border-border/50"
							>
								{#if row.mime_type.trim().toLowerCase() === 'application/pdf'}
									<GalleryPdfThumb contentB64={row.content ?? ''} />
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
										<div
											class="text-muted-foreground flex h-full w-full items-center justify-center p-4 text-center text-xs"
										>
											No preview
										</div>
									{/if}
								{/if}
							</div>
							<div class="flex min-w-0 flex-col gap-0.5 p-3">
								<p class="truncate text-sm font-medium leading-snug" title={row.filename}>
									{row.filename || 'Untitled'}
								</p>
								<p class="text-muted-foreground truncate text-[11px] leading-snug">
									{row.mime_type}
									<span class="mx-1 opacity-50">·</span>
									{formatBytes(coerceByteCount(row.size_bytes))}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</div>
