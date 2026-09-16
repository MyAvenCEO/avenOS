<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactLibraryPreview from './ArtifactLibraryPreview.svelte'
import { type Collection, categories, cellValue, collections, type LibraryPage, type LibraryRow, rowArtifactId } from './library'

let collection = $state<Collection>('documents')
let category = $state('all')
let search = $state('')
let sort = $state('date')
let direction = $state<'asc' | 'desc'>('desc')
let page = $state.raw<LibraryPage | null>(null)
let selected = $state<LibraryRow | null>(null)
let selectedArtifactId = $state<string | null>(null)
let loading = $state(false)
let failure = $state('')
let filterPending = $state(false)
let cursors = $state<(string | undefined)[]>([undefined])
let pageIndex = $state(0)
let requestRevision = 0
let storeEpoch: string | undefined
let searchTimer: ReturnType<typeof setTimeout>
const pageSize = 50

const definition = $derived(collections.find((item) => item.key === collection) ?? collections[0])
const rows = $derived(page?.items ?? [])
const hasCategories = $derived(collection === 'documents' || collection === 'invoices')

async function load(reset = false) {
	clearTimeout(searchTimer)
	filterPending = false
	if (reset) {
		cursors = [undefined]
		pageIndex = 0
		selected = null
		selectedArtifactId = null
	}
	page = null
	const revision = ++requestRevision
	loading = true
	failure = ''
	try {
		if (!isTauri()) {
			page = { storeEpoch: 'browser', snapshotSequence: 0, items: [], nextAfter: null }
			return
		}
		const query = {
			collection, category, search: search.trim(), sort, direction,
			limit: pageSize, after: cursors[pageIndex]
		}
		const result = await invoke<LibraryPage>('artifact_library', { query })
		if (revision !== requestRevision) return
		if (storeEpoch && storeEpoch !== result.storeEpoch) {
			selected = null
			selectedArtifactId = null
		}
		storeEpoch = result.storeEpoch
		page = result
	} catch (error) {
		if (revision === requestRevision)
			failure = error instanceof Error ? error.message : String(error)
	} finally {
		if (revision === requestRevision) loading = false
	}
}

function chooseCollection(next: Collection) {
	if (next === collection) return
	collection = next
	category = 'all'
	search = ''
	sort = 'date'
	direction = 'desc'
	void load(true)
}

function filterSearch() {
	clearTimeout(searchTimer)
	filterPending = true
	requestRevision++
	searchTimer = setTimeout(() => void load(true), 250)
}

function sortBy(key: string) {
	direction = sort === key && direction === 'asc' ? 'desc' : 'asc'
	sort = key
	void load(true)
}

function choose(row: LibraryRow, artifactId = rowArtifactId(row)) {
	selected = row
	selectedArtifactId = artifactId
}

function next() {
	if (!page?.nextAfter) return
	cursors = [...cursors.slice(0, pageIndex + 1), page.nextAfter]
	pageIndex++
	void load()
}

onMount(() => {
	void load()
	return () => { clearTimeout(searchTimer); requestRevision++ }
})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<header class="flex shrink-0 items-center justify-between gap-3 px-1">
		<div><h1 class="text-xl font-semibold">Artefakte</h1><p class="text-xs text-foreground/60">Dokumente und extrahierte Angaben</p></div>
		<button type="button" class="rounded-lg border border-border px-3 py-1.5 text-xs" disabled={loading} onclick={() => void load(true)}>Aktualisieren</button>
	</header>
	<nav class="flex shrink-0 gap-1 overflow-x-auto border-border border-b pb-2" aria-label="Sammlungen">
		{#each collections as item}
			<button type="button" aria-current={collection === item.key ? 'page' : undefined}
				class="shrink-0 rounded-lg px-3 py-1.5 text-sm {collection === item.key ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-sunken'}"
				onclick={() => chooseCollection(item.key)}>{item.label}</button>
		{/each}
	</nav>
	<div class="flex shrink-0 items-center gap-3">
		<input type="search" aria-label="Sammlung durchsuchen" bind:value={search} oninput={filterSearch}
			placeholder="Diese Sammlung durchsuchen …" class="min-w-0 w-full max-w-lg rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
		{#if filterPending}<span class="shrink-0 text-xs text-foreground/50" role="status">Filter wird angewendet …</span>{/if}
	</div>
	{#if hasCategories}
		<div class="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Kategorien">
			{#each categories.filter(([key]) => collection !== 'invoices' || ['all', 'invoice', 'credit-note', 'receipt'].includes(key)) as [key, label]}
				<button type="button" aria-pressed={category === key}
					class="rounded-full border border-border px-2.5 py-1 text-xs {category === key ? 'bg-primary text-primary-foreground' : ''}"
					onclick={() => { category = key; void load(true) }}>{label}</button>
			{/each}
		</div>
	{/if}
	{#if collection !== 'documents'}
		<p class="shrink-0 px-1 text-xs text-foreground/60">Aktuelle extrahierte Angaben je Dokument. „Regeln erfüllt“ bedeutet keine menschliche Freigabe. Fehlende Werte: —</p>
	{/if}
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
		<section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised" aria-label={definition.label} aria-busy={loading}>
			{#if failure}
				<div class="flex items-center gap-3 p-3 text-error-ink text-xs" role="alert">
					<span>{failure}</span><button type="button" class="underline" onclick={() => void load(true)}>Erneut laden</button>
				</div>
			{/if}
			{#if loading && !rows.length}<p class="p-4 text-sm" role="status">Sammlung wird geladen …</p>{/if}
			{#if !loading && !failure && !rows.length}
				<div class="p-10 text-center text-sm"><strong>Keine passenden Einträge</strong><p class="mt-2 text-xs text-foreground/60">{search || category !== 'all' ? 'Ändere die Suche oder Kategorie.' : 'Verarbeitete Dokumente erscheinen hier.'}</p></div>
			{/if}
			<div class="min-h-0 flex-1 overflow-auto">
				<table class="w-full text-left text-xs" style="border-collapse: collapse" aria-label={definition.label}>
					<thead class="sticky top-0 bg-surface-raised"><tr>
						{#each definition.columns as col}
							<th class="whitespace-nowrap border-border border-b px-3 py-2" aria-sort={sort === col.key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
								<button type="button" onclick={() => sortBy(col.key)}>{col.label}{sort === col.key ? direction === 'asc' ? ' ↑' : ' ↓' : ''}</button>
							</th>
						{/each}
						<th class="border-border border-b px-3 py-2">Prüfung</th>
						{#if collection !== 'documents'}<th class="border-border border-b px-3 py-2">Quelle</th>{/if}
					</tr></thead>
					<tbody>
						{#each rows as row (row.key)}
							<tr class="hover:bg-surface-sunken {selected?.key === row.key ? 'bg-surface-sunken' : ''}">
								{#each definition.columns as col, index}
									<td class="max-w-64 truncate border-border/40 border-b px-3 py-2.5 {col.money ? 'text-right tabular-nums' : ''}" title={cellValue(row, col)}>
										{#if index === 0}<button type="button" class="font-medium underline decoration-border" onclick={() => choose(row)}>{cellValue(row, col)}</button>
										{:else}{cellValue(row, col)}{/if}
									</td>
								{/each}
								<td class="whitespace-nowrap border-border/40 border-b px-3 py-2.5">{row.status === 'checked' ? 'Regeln erfüllt' : row.status === 'review' ? 'Prüfung offen' : 'Ungeprüft'}</td>
								{#if collection !== 'documents'}
									<td class="max-w-40 truncate border-border/40 border-b px-3 py-2.5"><button type="button" class="underline" title={row.name} onclick={() => choose(row, row.source.artifactId)}>{row.name}</button></td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<footer class="flex shrink-0 items-center justify-between gap-3 border-border border-t p-3 text-xs">
				<span>{rows.length ? `${pageIndex * pageSize + 1}–${pageIndex * pageSize + rows.length}` : '0'} Einträge{page?.nextAfter ? ' · weitere verfügbar' : ''}</span>
				<div class="flex gap-2">
					<button type="button" class="rounded border border-border px-2 py-1" disabled={pageIndex === 0 || loading || filterPending} onclick={() => { pageIndex--; void load() }}>← Zurück</button>
					<button type="button" class="rounded border border-border px-2 py-1" disabled={!page?.nextAfter || loading || filterPending} onclick={next}>Weiter →</button>
				</div>
			</footer>
		</section>
		{#if selected && selectedArtifactId}
			<aside class="flex min-h-0 min-w-0 lg:w-[48%]" aria-label="Dokumentvorschau">
				{#key `${selected.key}:${selectedArtifactId}`}
					<ArtifactLibraryPreview row={selected} initialArtifactId={selectedArtifactId} onclose={() => { selected = null; selectedArtifactId = null }} />
				{/key}
			</aside>
		{/if}
	</div>
</div>
