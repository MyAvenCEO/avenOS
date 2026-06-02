<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import {
		asrState,
		downloadFraction,
		listLocalModels,
		type LocalModel,
	} from '$lib/asr/model-download-store'
	import { formatBytes, formatBytesPair } from '$lib/asr/format'

	const tauri = $derived(browser && isTauriRuntime())
	let local = $state<LocalModel[]>([])

	// Re-scan the on-disk listing whenever readiness flips (e.g. a download
	// finishes), so freshly fetched weights show up without a manual refresh.
	$effect(() => {
		if (!tauri) {
			local = []
			return
		}
		void $asrState.status
		let cancelled = false
		void listLocalModels().then((m) => {
			if (!cancelled) local = m
		})
		return () => {
			cancelled = true
		}
	})

	const activeOnDisk = $derived(local.find((m) => m.isActive))
	const others = $derived(local.filter((m) => !m.isActive))
	const fraction = $derived(downloadFraction($asrState))
	const statusKey = $derived($asrState.status)
</script>

<svelte:head>
	<title>{t('models.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('models.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">{t('models.subtitle')}</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('models.needsDesktop')}</p>
	{:else}
		<!-- Voice model — live status + download progress. -->
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<h2 class="truncate text-sm font-semibold tracking-tight">{$asrState.model}</h2>
						<span
							class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
							>{t('models.active')}</span
						>
					</div>
					{#if activeOnDisk}
						<p class="text-muted-foreground mt-0.5 font-mono text-[11px]">
							{formatBytes(activeOnDisk.sizeBytes)}
							{t('models.onDisk')}
						</p>
					{/if}
				</div>
				<span
					class="shrink-0 text-xs font-medium {statusKey === 'ready'
						? 'text-status-success'
						: statusKey === 'error'
							? 'text-status-error'
							: 'text-muted-foreground'}"
				>
					{t(`models.status.${statusKey}`)}
				</span>
			</div>

			{#if statusKey === 'downloading' || statusKey === 'idle'}
				<div class="space-y-1.5">
					<div class="flex justify-end">
						<span class="font-mono text-[10px] tabular-nums text-muted-foreground"
							>{formatBytesPair($asrState.receivedBytes, $asrState.totalBytes)}</span
						>
					</div>
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						{#if fraction == null}
							<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
						{:else}
							<div
								class="h-full rounded-full bg-primary transition-[width] duration-300"
								style={`width: ${Math.round(fraction * 100)}%`}
							></div>
						{/if}
					</div>
				</div>
			{/if}

			{#if statusKey === 'error' && $asrState.error}
				<p class="text-status-error select-text text-[11px] leading-snug">{$asrState.error}</p>
			{/if}
		</section>

		<!-- Any other model directories present in the on-device cache. -->
		{#if others.length > 0}
			<section class="space-y-2">
				<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">
					{t('models.title')}
				</h2>
				<ul class="divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/30 divide-y">
					{#each others as m (m.id)}
						<li class="flex items-center justify-between gap-3 px-4 py-3">
							<span class="truncate font-mono text-[12px] select-text">{m.id}</span>
							<span class="text-muted-foreground shrink-0 font-mono text-[11px]"
								>{formatBytes(m.sizeBytes)}</span
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if local.length === 0 && statusKey !== 'downloading'}
			<p class="text-muted-foreground text-sm">{t('models.empty')}</p>
		{/if}
	{/if}
</div>
