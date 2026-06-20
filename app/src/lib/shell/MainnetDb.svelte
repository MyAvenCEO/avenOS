<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { type DataValue, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'

// Mainnet "DB" tab: a left "select schema" rail + the selected schema shown two ways via a
// Schema/Data toggle — its JSON Schema definition, or the table of its value instances (columns
// derived from the schema properties + any extra keys present). Folds the old "Schemas" tab in.
// Read-only view over the generic /api/data store. board 0053/0055.
type Table = {
	id: string
	name: string
	jsonSchema: unknown
	columns: string[]
	rows: DataValue<Record<string, unknown>>[]
}

let selectedId = $state<string | null>(null)
// Which face of the selected schema to show: its definition or its data instances.
let view = $state<'data' | 'schema'>('data')

function columnsFor(jsonSchema: unknown, rows: DataValue<Record<string, unknown>>[]): string[] {
	const fromSchema = Object.keys(
		(jsonSchema as { properties?: Record<string, unknown> } | null)?.properties ?? {}
	)
	const seen = new Set(fromSchema)
	for (const r of rows) for (const k of Object.keys(r.data ?? {})) seen.add(k)
	return [...seen]
}

function cell(value: unknown): string {
	if (value === undefined || value === null) return '—'
	if (typeof value === 'boolean') return value ? '✓' : '✗'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

// Tables — schemas + their values, live via TanStack Query (key under ['data'] so the SSE
// 'data' event invalidates it). No manual reload. board 0055.
const tablesQuery = createQuery(() => ({
	queryKey: ['data', 'tables'],
	queryFn: async (): Promise<Table[]> => {
		const schemas = await listSchemas()
		return Promise.all(
			schemas.map(async (s) => {
				const rows = await listValues<Record<string, unknown>>(s.id)
				return {
					id: s.id,
					name: s.name,
					jsonSchema: s.jsonSchema,
					columns: columnsFor(s.jsonSchema, rows),
					rows
				}
			})
		)
	}
}))
const tables = $derived<Table[]>(tablesQuery.data ?? [])
const loading = $derived(tablesQuery.isPending)
const err = $derived(tablesQuery.error ? (tablesQuery.error as Error).message : null)
const selected = $derived(tables.find((tbl) => tbl.id === selectedId) ?? null)

// Auto-select the first table once they load.
$effect(() => {
	if (!selectedId && tables.length > 0) selectedId = tables[0].id
})
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: select schema -->
	<aside class="border-border hidden w-48 shrink-0 flex-col border-r pt-3 sm:flex">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			{t('mainnet.schemas.select')}
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto px-2">
			{#if !loading && tables.length === 0}
				<p class="text-muted-foreground px-2 py-2 text-[11px] leading-relaxed">
					{t('mainnet.db.empty')}
				</p>
			{/if}
			{#each tables as tbl (tbl.id)}
				<button
					type="button"
					class="mb-0.5 flex w-full items-center justify-between gap-2 rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {tbl.id ===
					selectedId
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (selectedId = tbl.id)}
				>
					<span class="truncate">{tbl.name}</span>
					<span class="shrink-0 text-[11px] tabular-nums opacity-60">{tbl.rows.length}</span>
				</button>
			{/each}
		</div>
	</aside>

	<!-- Right: the selected schema's table -->
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
		{#if err}
			<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
		{/if}
		{#if selected}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center justify-between gap-2">
					<h2 class="text-foreground text-base font-semibold">{selected.name}</h2>
					<div
						class="border-border inline-flex shrink-0 overflow-hidden rounded-[var(--radius)] border text-[12px]"
					>
						<button
							type="button"
							class="px-3 py-1 transition-colors {view === 'schema'
								? 'bg-primary/10 text-foreground font-medium'
								: 'text-muted-foreground hover:bg-card'}"
							onclick={() => (view = 'schema')}
						>
							{t('mainnet.db.tabSchema')}
						</button>
						<button
							type="button"
							class="border-border border-l px-3 py-1 transition-colors {view === 'data'
								? 'bg-primary/10 text-foreground font-medium'
								: 'text-muted-foreground hover:bg-card'}"
							onclick={() => (view = 'data')}
						>
							{t('mainnet.db.tabData')}
							<span class="ml-1 tabular-nums opacity-60">{selected.rows.length}</span>
						</button>
					</div>
				</div>

				{#if view === 'schema'}
					<pre
						class="border-border bg-card text-foreground min-h-0 overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
					><code>{JSON.stringify(selected.jsonSchema, null, 2)}</code></pre>
				{:else if selected.rows.length === 0}
					<p
						class="border-border text-muted-foreground rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-[13px]"
					>
						{t('mainnet.db.emptyTable')}
					</p>
				{:else}
					<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
						<table class="w-full border-collapse text-left text-[13px]">
							<thead>
								<tr class="border-border bg-card border-b">
									{#each selected.columns as col (col)}
										<th
											class="text-muted-foreground px-3 py-2 font-bold tracking-wider whitespace-nowrap uppercase"
										>
											{col}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each selected.rows as row (row.id)}
									<tr class="border-border/60 border-b last:border-0">
										{#each selected.columns as col (col)}
											<td class="text-foreground px-3 py-2 align-top">{cell(row.data?.[col])}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
