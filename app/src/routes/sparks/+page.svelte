<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import type { JazzRow } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	const sparksStore = jazzStore('sparks')

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked',
	)
	const tauri = $derived(browser && isTauriRuntime())

	// Snapshot is reactive: peer-sync deltas land in `sparksStore.rows` automatically.
	const sparks = $derived(
		[...sparksStore.rows].sort((a, b) => a.name.localeCompare(b.name)),
	)
	const loading = $derived(tauri && unlocked && !sparksStore.loaded && !sparksStore.error)

	function sparkSubtitle(row: JazzRow): string {
		const id = row.spark_id
		return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
	}
</script>

<svelte:head>
	<title>{t('sparks.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('sparks.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('sparks.subtitleLead')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('sparks.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('sparks.unlockToSee')}</p>
	{:else if sparksStore.error}
		<p class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm" role="alert">{sparksStore.error}</p>
	{:else if loading}
		<p class="text-muted-foreground text-sm">{t('common.loadingSparks')}</p>
	{:else if sparks.length === 0}
		<p class="text-muted-foreground text-sm">{t('sparks.noSparksYet')}</p>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2">
			{#each sparks as row (row.spark_id)}
				<li>
					<button
						type="button"
						class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
						onclick={() => goto(`/sparks/${encodeURIComponent(row.spark_id)}/talk`)}
					>
						<span class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90">{t('sparks.sparkLabel')}</span>
						<span class="text-base font-medium tracking-tight group-hover:text-accent-foreground">{row.name || t('common.unnamed')}</span>
						<span class="text-muted-foreground font-mono text-[11px] group-hover:text-accent-foreground/85">{sparkSubtitle(row)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
</div>
