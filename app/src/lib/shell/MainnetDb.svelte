<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { authClient } from '$lib/auth/auth-client'
import { type DataValue, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { nav } from '$lib/shell/nav.svelte'

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

// One positional place (x1…x5) of a predication data type, surfaced from the compiled schema.
type Place = {
	pos: string
	role: string
	means: string
	kind: string
	example: string
	required: boolean
	nullable: boolean
	ref: string | null // the x-ref target ('user' / '*' / a type) when this place holds a reference
}
type SchemaMeta = {
	isPredication: boolean
	gismu: string | null
	gloss: string
	title: string
	places: Place[]
}

function kindLabel(p: Record<string, unknown>): string {
	if (typeof p['x-ref'] === 'string') {
		const ref = p['x-ref'] as string
		return ref === '*' ? 'ref → any' : `ref → ${ref}`
	}
	const type = Array.isArray(p.type) ? (p.type as string[]).find((x) => x !== 'null') : p.type
	// date/date-time value places carry a YYYY-MM-DD pattern (no ajv-formats, see compile.ts)
	if (type === 'string' && typeof p.pattern === 'string' && p.pattern.includes('\\d{4}')) return 'date'
	return (type as string) ?? 'value'
}

// x1–x5 predications ARE the universal data-type model — a "data type" reads as its gismu + the
// per-place role/meaning/example baked into the compiled schema (compile.ts). Pure read, no todos
// special-casing: any schema with a `predicate` discriminator or `x-gismu` renders this way.
function schemaMeta(jsonSchema: unknown): SchemaMeta {
	const s = (jsonSchema ?? {}) as Record<string, unknown>
	const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>
	const required = Array.isArray(s.required) ? (s.required as string[]) : []
	const gismu = typeof s['x-gismu'] === 'string' ? (s['x-gismu'] as string) : null
	const places: Place[] = Object.entries(props)
		.filter(([k]) => k !== 'predicate')
		.map(([pos, p]) => ({
			pos,
			role: typeof p.title === 'string' ? p.title : pos,
			means: typeof p.description === 'string' ? p.description : '',
			kind: kindLabel(p),
			example: Array.isArray(p.examples) && p.examples.length ? String(p.examples[0]) : '',
			required: required.includes(pos),
			nullable: Array.isArray(p.type) && (p.type as string[]).includes('null'),
			ref: typeof p['x-ref'] === 'string' ? (p['x-ref'] as string) : null
		}))
	return {
		isPredication: !!props.predicate || gismu !== null,
		gismu,
		gloss: typeof s.description === 'string' ? s.description : '',
		title: typeof s.title === 'string' ? s.title : '',
		places
	}
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

// Who is signed in — so a `user` reference resolves to "you", not a raw id.
const sessionStore = authClient.useSession()
const me = $derived(
	$sessionStore.data?.user as { id?: string; name?: string; email?: string } | undefined
)

// Resolve a reference id → a human label. A predication's id IS its data_value row id, so a ref to
// another row (e.g. valid.x1 → a task) resolves to THAT row's first value place (the task's title).
// Built across ALL tables so any ref can be resolved. board 0088.
const refMap = $derived.by(() => {
	const m = new Map<string, { label: string; schemaId: string; rowId: string }>()
	for (const tbl of tables) {
		const labelPos = schemaMeta(tbl.jsonSchema).places.find((p) => !p.ref)?.pos
		if (!labelPos) continue
		for (const row of tbl.rows) {
			const v = (row.data as Record<string, unknown> | undefined)?.[labelPos]
			if (typeof v === 'string') m.set(row.id, { label: v, schemaId: tbl.id, rowId: row.id })
		}
	}
	return m
})

// The entity shown in the detail aside (also highlights its row). Clicking a row, or a resolved
// row-ref, sets it; the aside lists every predication that mentions that entity. board 0088.
let focusRow = $state<string | null>(null)
/** Focus the entity a row belongs to: prefer the row's ref to a known entity (a `due` row → its
 *  task), else the row itself (a `task` row → the task). So clicking any predication opens the todo. */
function openDetail(row: DataValue<Record<string, unknown>>): void {
	const data = (row.data ?? {}) as Record<string, unknown>
	const link = selected
		? schemaMeta(selected.jsonSchema).places.find(
				(p) => p.ref && refMap.has(String(data[p.pos] ?? ''))
			)
		: undefined
	focusRow = link ? String(data[link.pos]) : row.id
}
function gotoRef(target: { schemaId: string; rowId: string }): void {
	selectedId = target.schemaId
	view = 'data'
	focusRow = target.rowId
}
// Scroll the focused row into view when it changes (e.g. after a ref jump).
$effect(() => {
	const id = focusRow
	if (!id) return
	document
		.querySelector(`[data-row-id="${id}"]`)
		?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

// Every predication that mentions `focusId` in ANY place (incl. its own primary row), as short
// "predicate sentences": the predicate (+ gismu) and its places as resolved role/value pairs.
type SentencePart = { role: string; value: string; ref: Resolved | null }
type Sentence = { id: string; predicate: string; gismu: string | null; parts: SentencePart[] }
function relatedPredications(focusId: string): Sentence[] {
	const out: Sentence[] = []
	for (const tbl of tables) {
		const meta = schemaMeta(tbl.jsonSchema)
		for (const row of tbl.rows) {
			const data = (row.data ?? {}) as Record<string, unknown>
			const mentions =
				row.id === focusId || meta.places.some((p) => String(data[p.pos] ?? '') === focusId)
			if (!mentions) continue
			// ref places carry their resolved target (clickable → jump to that DB instance); value places plain.
			const parts: SentencePart[] = meta.places.map((p) =>
				p.ref
					? { role: p.role, value: '', ref: resolveRef(data[p.pos]) }
					: { role: p.role, value: data[p.pos] == null ? '—' : String(data[p.pos]), ref: null }
			)
			out.push({ id: row.id, predicate: meta.title || tbl.name, gismu: meta.gismu, parts })
		}
	}
	return out
}
const focusLabel = $derived(focusRow ? (refMap.get(focusRow)?.label ?? focusRow) : null)

type DataCol = { key: string; label: string; ref: string | null }
/** Columns for the Data table: place roles as headers (refs flagged), the redundant `predicate` dropped. */
function dataColumns(table: Table): DataCol[] {
	const byPos = new Map(schemaMeta(table.jsonSchema).places.map((p) => [p.pos, p]))
	return table.columns
		.filter((key) => key !== 'predicate')
		.map((key) => {
			const p = byPos.get(key)
			return { key, label: p ? p.role : key, ref: p?.ref ?? null }
		})
}

type RefTarget = { schemaId: string; rowId: string }
type Resolved =
	| { label: string; kind: 'you' | 'id' }
	| { label: string; kind: 'row'; target: RefTarget }
/** A ref cell → the signed-in user ("you"), the referenced row (clickable), or a shortened id. */
function resolveRef(id: unknown): Resolved {
	const s = id == null ? '' : String(id)
	if (!s) return { label: '—', kind: 'id' }
	if (me?.id && s === me.id) return { label: me.name || me.email || 'you', kind: 'you' }
	const hit = refMap.get(s)
	if (hit) return { label: hit.label, kind: 'row', target: { schemaId: hit.schemaId, rowId: hit.rowId } }
	return { label: s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s, kind: 'id' }
}

// Auto-select the first table once they load.
$effect(() => {
	if (!selectedId && tables.length > 0) selectedId = tables[0].id
})

// Deep link from a flow schema badge: select the requested schema by name + show its definition.
$effect(() => {
	if (!nav.dbSchema || tables.length === 0) return
	const match = tables.find((tbl) => tbl.name === nav.dbSchema)
	if (match) {
		selectedId = match.id
		view = 'schema'
	}
	nav.dbSchema = null
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
					{@const m = schemaMeta(selected.jsonSchema)}
					{#if m.isPredication}
						<div class="flex min-h-0 flex-col gap-3">
							<!-- the data type as a Lojban predicate: name ≡ gismu, then its whole-predicate gloss -->
							<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-foreground font-mono text-sm font-semibold"
										>{m.title || selected.name}</span
									>
									{#if m.gismu}
										<span
											class="bg-primary/10 text-foreground rounded-full px-2 py-0.5 font-mono text-[11px]"
											title={t('mainnet.db.gismuTitle')}>≡ {m.gismu}</span
										>
									{/if}
									<span class="text-muted-foreground text-[11px] tracking-wider uppercase opacity-70"
										>{m.places.length}-place predicate</span
									>
								</div>
								{#if m.gloss}
									<p class="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">{m.gloss}</p>
								{/if}
							</div>
							<!-- the positional places x1…x5: role · meaning · kind · example -->
							<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
								<table class="w-full border-collapse text-left text-[13px]">
									<thead>
										<tr class="border-border bg-card border-b">
											{#each ['place', 'role', 'meaning', 'kind', 'example'] as h (h)}
												<th
													class="text-muted-foreground px-3 py-2 font-bold tracking-wider whitespace-nowrap uppercase"
													>{t(`mainnet.db.place.${h}`)}</th
												>
											{/each}
										</tr>
									</thead>
									<tbody>
										{#each m.places as pl (pl.pos)}
											<tr class="border-border/60 border-b last:border-0">
												<td class="text-foreground px-3 py-2 align-top font-mono whitespace-nowrap">
													{pl.pos}
													{#if !pl.required || pl.nullable}
														<span class="text-muted-foreground ml-1 text-[10px] opacity-70"
															>{[!pl.required ? 'opt' : '', pl.nullable ? 'null' : '']
																.filter(Boolean)
																.join('·')}</span
														>
													{/if}
												</td>
												<td class="text-foreground px-3 py-2 align-top font-medium">{pl.role}</td>
												<td class="text-muted-foreground px-3 py-2 align-top">{pl.means || '—'}</td>
												<td class="text-foreground px-3 py-2 align-top font-mono text-[12px]">{pl.kind}</td>
												<td class="text-muted-foreground px-3 py-2 align-top font-mono text-[12px]"
													>{pl.example || '—'}</td
												>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<details class="text-[12px]">
								<summary class="text-muted-foreground hover:text-foreground cursor-pointer select-none"
									>{t('mainnet.db.rawSchema')}</summary
								>
								<pre
									class="border-border bg-card text-foreground mt-2 overflow-auto rounded-[var(--radius-lg)] border p-4 leading-relaxed"><code
										>{JSON.stringify(selected.jsonSchema, null, 2)}</code
									></pre>
							</details>
						</div>
					{:else}
						<pre
							class="border-border bg-card text-foreground min-h-0 overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
						><code>{JSON.stringify(selected.jsonSchema, null, 2)}</code></pre>
					{/if}
				{:else if selected.rows.length === 0}
					<p
						class="border-border text-muted-foreground rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-[13px]"
					>
						{t('mainnet.db.emptyTable')}
					</p>
				{:else}
					{@const cols = dataColumns(selected)}
					<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
						<table class="w-full border-collapse text-left text-[13px]">
							<thead>
								<tr class="border-border bg-card border-b">
									{#each cols as c (c.key)}
										<th
											class="text-muted-foreground px-3 py-2 font-bold tracking-wider whitespace-nowrap uppercase"
										>
											{c.label}
											{#if c.ref}<span class="ml-0.5 normal-case opacity-50">↪</span>{/if}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each selected.rows as row (row.id)}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
									<tr
										data-row-id={row.id}
										onclick={() => openDetail(row)}
										class="border-border/60 hover:bg-card/60 cursor-pointer border-b transition-colors last:border-0 {focusRow ===
										row.id
											? 'bg-primary/10'
											: ''}"
									>
										{#each cols as c (c.key)}
											<td class="text-foreground px-3 py-2 align-top">
												{#if c.ref}
													{@const r = resolveRef(row.data?.[c.key])}
													{#if r.kind === 'you'}
														<span
															class="bg-primary/10 text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium"
															>◆ {r.label}</span
														>
													{:else if r.kind === 'row'}
														<button
															type="button"
															class="border-border text-foreground hover:bg-primary/10 hover:border-primary/40 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors"
															title={`Go to ${r.label}`}
															onclick={(e) => {
																e.stopPropagation()
																gotoRef(r.target)
															}}>↪ {r.label}</button
														>
													{:else}
														<span
															class="text-muted-foreground font-mono text-[12px]"
															title={String(row.data?.[c.key] ?? '')}>{r.label}</span
														>
													{/if}
												{:else}
													{cell(row.data?.[c.key])}
												{/if}
											</td>
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

	<!-- Right: detail aside — every predication attached to the clicked entity, as short sentences -->
	{#if focusRow}
		{@const sentences = relatedPredications(focusRow)}
		<aside class="border-border hidden w-80 shrink-0 flex-col border-l md:flex">
			<div class="border-border flex items-start justify-between gap-2 border-b px-3 py-2.5">
				<div class="min-w-0">
					<p class="text-muted-foreground text-[10px] font-bold tracking-[0.14em] uppercase">
						{t('mainnet.db.detail')}
					</p>
					<p class="text-foreground truncate text-[14px] font-semibold">{focusLabel}</p>
				</div>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground shrink-0 text-lg leading-none"
					aria-label={t('mainnet.db.close')}
					onclick={() => (focusRow = null)}>×</button
				>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				<p class="text-muted-foreground mb-2 text-[11px]">
					{sentences.length}
					{t('mainnet.db.attached')}
				</p>
				<ul class="flex flex-col gap-2">
					{#each sentences as s (s.id)}
						<li class="border-border bg-card rounded-[var(--radius)] border px-3 py-2">
							<div class="mb-1 flex items-center gap-1.5">
								<span class="text-foreground font-mono text-[13px] font-semibold">{s.predicate}</span>
								{#if s.gismu}
									<span class="text-muted-foreground font-mono text-[10px]">≡ {s.gismu}</span>
								{/if}
							</div>
							<div class="flex flex-wrap gap-x-2.5 gap-y-1 text-[12px]">
								{#each s.parts as part (part.role)}
									<span class="inline-flex items-center gap-1">
										<span class="text-muted-foreground uppercase opacity-60">{part.role}</span>
										{#if part.ref}
											{#if part.ref.kind === 'row'}
												{@const target = part.ref.target}
												<button
													type="button"
													class="text-foreground hover:text-primary cursor-pointer underline decoration-dotted underline-offset-2"
													title={`Go to ${part.ref.label}`}
													onclick={() => gotoRef(target)}>{part.ref.label}</button
												>
											{:else if part.ref.kind === 'you'}
												<span class="text-foreground italic">{part.ref.label}</span>
											{:else}
												<span class="text-muted-foreground font-mono">{part.ref.label}</span>
											{/if}
										{:else}
											<span class="text-foreground">{part.value}</span>
										{/if}
									</span>
								{/each}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</aside>
	{/if}
</div>
