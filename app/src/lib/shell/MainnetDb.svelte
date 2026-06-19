<script lang="ts">
import { type DataValue, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'

// Mainnet "DB" tab: a left "select schema" rail (same shape as Vibes/Schemas) + a table of
// the selected schema's values on the right (columns derived from the schema's properties +
// any extra keys present in the data). Read-only view over the generic /api/data store. board 0053.
type Table = {
	id: string
	name: string
	columns: string[]
	rows: DataValue<Record<string, unknown>>[]
}

let tables = $state<Table[]>([])
let selectedId = $state<string | null>(null)
let err = $state<string | null>(null)
let loading = $state(true)
let started = false

const selected = $derived(tables.find((tbl) => tbl.id === selectedId) ?? null)

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

async function load(): Promise<void> {
	try {
		const schemas = await listSchemas()
		tables = await Promise.all(
			schemas.map(async (s) => {
				const rows = await listValues<Record<string, unknown>>(s.id)
				return { id: s.id, name: s.name, columns: columnsFor(s.jsonSchema, rows), rows }
			})
		)
		if (tables.length > 0 && !selectedId) selectedId = tables[0].id
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		loading = false
	}
}

$effect(() => {
	if (started) return
	started = true
	void load()
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
				<div class="mb-2 flex items-baseline justify-between gap-2">
					<h2 class="text-foreground text-base font-semibold">{selected.name}</h2>
					<span class="text-muted-foreground text-[11px] tabular-nums">
						{selected.rows.length}
						{t('mainnet.db.rows')}
					</span>
				</div>

				{#if selected.rows.length === 0}
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
