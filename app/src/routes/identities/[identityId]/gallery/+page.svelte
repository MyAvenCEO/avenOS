<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { jazzTable, type JazzRow } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'
	import GalleryPdfThumb from '$lib/gallery/GalleryPdfThumb.svelte'
	import {
		coerceEpochMs,
		fileTypeLabel,
		imageDataUrl,
	} from '$lib/gallery/file-preview'

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))

	const identitiesStore = jazzStore('identities')
	const filesStore = jazzStore('files')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const identityMeta = $derived(
		identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId)),
	)
	const sparksResolved = $derived(identitiesStore.loaded)
	const canonicalSparkId = $derived(identityMeta?.owner ?? decodedIdentityId)

	const rows = $derived(
		[...filesStore.rows]
			.filter((r) => idsMatch(r.owner, canonicalSparkId))
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

	let pendingDeleteId = $state<string | null>(null)
	let deletingId = $state<string | null>(null)
	let deleteError = $state<string | null>(null)

	function requestDelete(id: string): void {
		deleteError = null
		pendingDeleteId = id
	}

	function cancelDelete(): void {
		if (deletingId) return
		pendingDeleteId = null
	}

	async function confirmDelete(id: string): Promise<void> {
		if (deletingId) return
		deletingId = id
		deleteError = null
		try {
			await jazzTable('files').delete(id)
			pendingDeleteId = null
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e)
		} finally {
			deletingId = null
		}
	}
</script>

<svelte:head>
	<title>{t('identities.gallery.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">{t('identities.gallery.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('identities.gallery.subtitle')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.gallery.unlockToLoad')}</p>
	{:else if !decodedIdentityId}
		<p class="text-muted-foreground text-sm">{t('identities.gallery.missingSparkId')}</p>
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
			<p class="text-muted-foreground text-xs">{t('common.loadingSpark')}</p>
		{:else if sparksResolved && !identityMeta && !filesStore.error}
			<p class="text-muted-foreground text-sm">
				{t('identities.gallery.notInLedger')}
				<button type="button" class="underline" onclick={() => goto('/identities')}>{t('identities.gallery.backToSparks')}</button>.
			</p>
		{/if}

		{#if identityMeta}
			{#if !filesStore.loaded && !filesStore.error}
				<p class="text-muted-foreground text-sm">{t('common.loadingFiles')}</p>
			{:else if rows.length === 0}
				<p class="text-muted-foreground rounded-xl border border-border/60 px-4 py-8 text-center text-sm">
					{t('identities.gallery.noFilesYet')}
				</p>
			{:else}
				<ul
					class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
					aria-label={t('identities.gallery.filesInSpark')}
				>
					{#each rows as row (row.id)}
						<li
							class="border-input bg-card/40 group relative flex flex-col overflow-hidden rounded-xl border shadow-sm"
						>
							<button
								type="button"
								class="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-background/90 text-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-destructive hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
								aria-label={t('identities.gallery.deleteFile')}
								title={t('identities.gallery.deleteFile')}
								onclick={() => requestDelete(row.id)}
							>
								<svg
									class="size-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 0v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"
									/>
								</svg>
							</button>
							<div
								class="bg-muted/30 relative aspect-square w-full overflow-hidden border-b border-border/50"
							>
								{#if pendingDeleteId === row.id}
									<div
										class="bg-background/95 absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-3 text-center backdrop-blur-sm"
									>
										<p class="text-foreground text-xs font-medium leading-snug">
											{t('identities.gallery.confirmDelete')}
										</p>
										<div class="flex gap-2">
											<button
												type="button"
												class="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
												disabled={deletingId === row.id}
												onclick={() => void confirmDelete(row.id)}
											>
												{deletingId === row.id
													? t('identities.gallery.deleting')
													: t('identities.gallery.confirmDeleteYes')}
											</button>
											<button
												type="button"
												class="border-input rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent/10 disabled:opacity-60"
												disabled={deletingId === row.id}
												onclick={cancelDelete}
											>
												{t('identities.gallery.confirmDeleteNo')}
											</button>
										</div>
										{#if deleteError}
											<p class="text-destructive text-[10px] leading-snug">
												{t('identities.gallery.deleteFailed')}
											</p>
										{/if}
									</div>
								{/if}
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
											class="text-muted-foreground flex h-full w-full items-center justify-center p-4 text-center"
										>
											<span
												class="bg-background/80 text-foreground rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider"
											>
												{fileTypeLabel(row)}
											</span>
										</div>
									{/if}
								{/if}
							</div>
							<div class="flex min-w-0 flex-col gap-0.5 p-3">
								<p
									class="text-muted-foreground truncate font-mono text-[11px] leading-snug"
									title={row.id}
								>
									{row.id}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</div>
