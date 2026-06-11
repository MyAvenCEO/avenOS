<script lang="ts">
import { onMount } from 'svelte'
import { browser } from '$app/environment'
import { t } from '$lib/i18n'
import VirtualList from '$lib/ingestor/VirtualList.svelte'

type Konto = {
	konto: string
	funktion: string
	bezeichnung: string
}

let accounts = $state<Konto[]>([])
let loaded = $state(false)
let loadError = $state<string | null>(null)

let query = $state('')
let klasse = $state<string>('all')

// Shared column template so the header and every row line up.
const GRID = 'grid-template-columns: 80px 92px minmax(200px,1fr)'

const classes = $derived(Array.from(new Set(accounts.map((a) => a.konto[0]))).sort())

const filtered = $derived.by<Konto[]>(() => {
	const q = query.trim().toLowerCase()
	return accounts.filter((a) => {
		if (klasse !== 'all' && a.konto[0] !== klasse) return false
		if (!q) return true
		return a.konto.startsWith(q) || a.bezeichnung.toLowerCase().includes(q)
	})
})

async function load(): Promise<void> {
	try {
		const res = await fetch('/skills/bookkeeping/konten.json', { cache: 'no-store' })
		if (!res.ok) throw new Error(`konten.json ${res.status}`)
		const data = (await res.json()) as Konto[]
		accounts = Array.isArray(data) ? data : []
	} catch (e) {
		loadError = e instanceof Error ? e.message : String(e)
	} finally {
		loaded = true
	}
}

onMount(() => {
	if (browser) void load()
})
</script>

<svelte:head>
	<title>{t('bookkeeping.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-4 pb-4 sm:px-6 md:px-8">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('bookkeeping.title')}</h1>
			{#if loaded && !loadError}
				<span class="text-muted-foreground text-xs tabular-nums">
					{t('bookkeeping.count', { shown: filtered.length, total: accounts.length })}
				</span>
			{/if}
		</div>
		<p class="text-muted-foreground text-sm leading-relaxed">{t('bookkeeping.subtitle')}</p>
	</header>

	{#if !loaded}
		<p class="text-muted-foreground text-sm">{t('bookkeeping.loading')}</p>
	{:else if loadError}
		<p
			class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug"
			role="alert"
		>
			{loadError}
		</p>
	{:else}
		<!-- controls -->
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="search"
				bind:value={query}
				placeholder={t('bookkeeping.searchPlaceholder')}
				aria-label={t('bookkeeping.searchPlaceholder')}
				class="border-input bg-card/40 focus:border-border focus:ring-ring/30 min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 sm:max-w-xs"
			>
			<div
				class="flex flex-wrap items-center gap-1"
				role="group"
				aria-label={t('bookkeeping.classFilter')}
			>
				<button
					type="button"
					onclick={() => (klasse = 'all')}
					class="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors {klasse === 'all'
						? 'bg-accent text-accent-foreground border-border'
						: 'border-input text-muted-foreground hover:bg-accent/50'}"
				>
					{t('bookkeeping.allClasses')}
				</button>
				{#each classes as c (c)}
					<button
						type="button"
						onclick={() => (klasse = c)}
						title={t(`bookkeeping.class.${c}`)}
						class="w-7 rounded-md border py-1 text-[11px] font-medium tabular-nums transition-colors {klasse === c
							? 'bg-accent text-accent-foreground border-border'
							: 'border-input text-muted-foreground hover:bg-accent/50'}"
					>
						{c}
					</button>
				{/each}
			</div>
		</div>

		{#if filtered.length === 0}
			<div
				class="border-input text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
			>
				{t('bookkeeping.noResults')}
			</div>
		{:else}
			<div class="border-input flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
				<!-- Header (stays put; the body below scrolls) -->
				<div
					class="bg-muted/50 text-muted-foreground border-border/60 grid shrink-0 gap-0 border-b text-[11px] font-medium [&>span]:truncate [&>span]:px-3 [&>span]:py-2"
					style={GRID}
				>
					<span>{t('bookkeeping.col.konto')}</span>
					<span>{t('bookkeeping.col.funktion')}</span>
					<span>{t('bookkeeping.col.bezeichnung')}</span>
				</div>

				<VirtualList items={filtered} itemHeight={33}>
					{#snippet row(a: Konto)}
						<div
							class="border-border/40 hover:bg-muted/30 grid items-center border-b text-[12px] [&>span]:truncate [&>span]:px-3 [&>span]:py-1.5"
							style={GRID}
						>
							<span class="font-mono font-medium tabular-nums">{a.konto}</span>
							<span>
								{#if a.funktion}
									<span
										class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px] tracking-tight"
										title={t('bookkeeping.funktionHint')}
										>{a.funktion}</span
									>
								{/if}
							</span>
							<span class="text-foreground/90">{a.bezeichnung}</span>
						</div>
					{/snippet}
				</VirtualList>
			</div>
		{/if}
	{/if}
</div>
