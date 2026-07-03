<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { authClient } from '$lib/auth/auth-client'
import {
	type DataValue,
	listSchemas,
	listValues,
	loadContext,
	loadVibeBundle
} from '$lib/data/client'
import { t } from '$lib/i18n'
import { nav } from '$lib/shell/nav.svelte'
import Composer from '$lib/composer/Composer.svelte'
import VibeCard from '$lib/shell/VibeCard.svelte'

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

// board 0105 — the DB viewer has FIVE sections, each with its own list in the left rail: schemas (predicate
// DEFINITIONS) · values (predication INSTANCES) · bundles (composite types) · operations (the merged
// query|mutation registry) · vibes (the rendering templates, tabbed). Exactly one item is selected at a time.
let selectedBundle = $state<string | null>(null)
let selectedOp = $state<string | null>(null)
// The bundle list (name + summary) and the operation list (name + kind + full spec), via /api/context.
const bundlesQuery = createQuery(() => ({
	queryKey: ['db', 'bundles'],
	queryFn: () => loadContext('types')
}))
const bundleNames = $derived<string[]>((bundlesQuery.data?.items ?? []).map((i) => i.name))
type OpItem = { name: string; kind: string; spec: unknown }
const opsQuery = createQuery(() => ({
	queryKey: ['db', 'ops'],
	queryFn: () => loadContext('data_operations')
}))
const opItems = $derived<OpItem[]>(
	(opsQuery.data?.items ?? []).map((it) => {
		let spec: unknown = null
		try {
			spec = it.gloss ? JSON.parse(it.gloss) : null
		} catch {
			/* leave null */
		}
		return { name: it.name, kind: it.tag ?? 'query', spec }
	})
)
const selectedOpItem = $derived<OpItem | null>(opItems.find((o) => o.name === selectedOp) ?? null)
// A selected bundle's full TypeSpec (traits + view) — the `type` context provider returns the projection.
const bundleDetailQuery = createQuery(() => ({
	queryKey: ['db', 'bundle', selectedBundle],
	enabled: selectedBundle !== null,
	queryFn: () => (selectedBundle ? loadContext('type', selectedBundle) : null)
}))
type BundleSpec = {
	type?: string
	parts?: { pred?: string; kind?: string; field?: string }[]
	project?: Record<string, { pred?: string; place?: string; notNull?: string; children?: boolean }>
}
const bundleSpec = $derived.by<BundleSpec | null>(() => {
	const txt = bundleDetailQuery.data?.text
	if (!txt) return null
	try {
		return (JSON.parse(txt).projection ?? null) as BundleSpec | null
	} catch {
		return null
	}
})

// board 0105 — the VIBES section folds the old Vibes tab into the DB viewer: each vibe.* row is ONE entry
// (its view+style+logic together), shown in a tabbed detail — the live UI (rendered through the engine via
// VibeCard, with a readable summary aside), plus the raw View / Function / Style / State JSON. The whole
// viewer-as-a-vibe is the follow-on (0106).
let selectedVibe = $state<string | null>(null)
type VibeTab = 'ui' | 'view' | 'function' | 'style' | 'state'
let vibeTab = $state<VibeTab>('ui')
// board 0106 — bundle + operation detail read either as the structured summary or the raw JSON, as two tabs.
type DetailTab = 'readable' | 'raw'
let detailTab = $state<DetailTab>('readable')
// board 0110 — the viewer is STANDARDIZED: the left rail is a pure CATEGORY selector; the main area is a
// 50/50 split (item list | selected-item detail), the same shape across every category.
type Category =
	| 'schemas'
	| 'values'
	| 'bundles'
	| 'operations'
	| 'vibes'
	| 'skills'
	| 'actors'
	| 'runs'
const CATEGORIES: { id: Category; label: string }[] = [
	{ id: 'schemas', label: 'Schemas' },
	{ id: 'values', label: 'Values' },
	{ id: 'bundles', label: 'Bundles' },
	{ id: 'operations', label: 'Operations' },
	{ id: 'vibes', label: 'Vibes' },
	{ id: 'skills', label: 'Skills' },
	{ id: 'actors', label: 'Actors' },
	{ id: 'runs', label: 'Runs' }
]
let category = $state<Category>('values')
let selectedSkill = $state<string | null>(null)
let selectedActor = $state<string | null>(null)
let selectedRun = $state<string | null>(null)
const VIBE_TABS: { id: VibeTab; label: string }[] = [
	{ id: 'ui', label: 'UI' },
	{ id: 'view', label: 'View' },
	{ id: 'function', label: 'Function' },
	{ id: 'style', label: 'Style' },
	{ id: 'state', label: 'State' }
]
// The list of vibe names = the vibe_view registry rows (each is one vibe).
const vibeListQuery = createQuery(() => ({
	queryKey: ['vibe-list'],
	queryFn: () => loadContext('vibe_view')
}))
const vibeNames = $derived<string[]>((vibeListQuery.data?.items ?? []).map((i) => i.name))
// The selected vibe's bundle (view/style/logic) for the raw tabs.
const vibeBundleQuery = createQuery(() => ({
	queryKey: ['vibe', selectedVibe],
	enabled: selectedVibe !== null,
	queryFn: () => (selectedVibe ? loadVibeBundle(selectedVibe) : null)
}))
// board 0110 — SKILLS / ACTORS / RUNS via the ONE generic context endpoint (config-as-data).
type CtxItem = { name: string; gloss?: string; tag?: string }
const skillsQuery = createQuery(() => ({ queryKey: ['db', 'skills'], queryFn: () => loadContext('skills') }))
const actorsQuery = createQuery(() => ({ queryKey: ['db', 'actors'], queryFn: () => loadContext('actors') }))
const runsQuery = createQuery(() => ({ queryKey: ['db', 'runs'], queryFn: () => loadContext('runs') }))
const skillItems = $derived<CtxItem[]>((skillsQuery.data?.items ?? []) as CtxItem[])
const actorItems = $derived<CtxItem[]>((actorsQuery.data?.items ?? []) as CtxItem[])
const runItems = $derived<CtxItem[]>((runsQuery.data?.items ?? []) as CtxItem[])
const selectedSkillItem = $derived<CtxItem | null>(
	skillItems.find((x) => x.name === selectedSkill) ?? null
)
const selectedActorItem = $derived<CtxItem | null>(
	actorItems.find((x) => x.name === selectedActor) ?? null
)
const selectedRunItem = $derived<CtxItem | null>(runItems.find((x) => x.name === selectedRun) ?? null)
// Representative sample `source` per vibe — drives the live UI render + the State tab (never a live run).
const VIBE_SAMPLE: Record<string, Record<string, unknown>> = {
	todos: {
		title: 'Todos',
		items: [
			{ id: '1', text: 'Buy milk', done: false, due: 'in 3 days', priority: 'high' },
			{ id: '2', text: 'Old task', done: true }
		]
	},
	'bundle-created': {
		request: 'track books I read with a rating',
		spec: {
			type: 'book',
			parts: [
				{ pred: 'book', kind: 'primary', field: 'title' },
				{ pred: 'rated', kind: 'replace', field: 'rating' }
			],
			project: { title: { pred: 'book', place: 'x2' }, rating: { pred: 'rated', place: 'x3' } }
		},
		mintedPredicates: ['rated']
	},
	ontology: {
		predicates: [
			{ name: 'owned_by', gloss: 'x1 is owned by x2' },
			{ name: 'task', gloss: 'x1 does deed x2' }
		]
	},
	'ontology-created': {
		created: [
			{
				predicate: 'eats',
				gismu: 'citka',
				gloss: 'x1 eats/ingests x2',
				places: [
					{ pos: 'x1', role: 'eater', kind: 'ref' },
					{ pos: 'x2', role: 'food', kind: 'value' }
				]
			}
		],
		reused: ['owned_by']
	},
	'query-result': {
		request: 'who owns more than 3 companies?',
		rows: [{ key: 'alice', n: 4 }],
		spec: {}
	},
	'mutation-result': {
		request: 'transfer Acme from Alice to Bob',
		ops: [
			{ op: 'delete', predicate: 'owned_by', affected: 1 },
			{ op: 'insert', predicate: 'owned_by', affected: 1 }
		]
	},
	'todos-created': { items: [{ title: 'Buy milk', due: 'in 3 days', priority: 'high' }] },
	'todos-edited': {
		diffs: [{ title: 'Buy milk', changes: [{ field: 'done', from: 'false', to: 'true' }] }]
	},
	'todos-deleted': { items: [{ title: 'Old task' }] }
}
const vibeSample = $derived<Record<string, unknown>>(
	selectedVibe ? (VIBE_SAMPLE[selectedVibe] ?? {}) : {}
)
// Exactly-one-selected: each picker clears the others. board 0105.
function clearSel(): void {
	selectedId = null
	selectedBundle = null
	selectedOp = null
	selectedVibe = null
	selectedSkill = null
	selectedActor = null
	selectedRun = null
	focusRow = null
}
function pickSchema(id: string, face: 'schema' | 'data'): void {
	clearSel()
	selectedId = id
	view = face
	category = face === 'schema' ? 'schemas' : 'values'
}
function pickBundle(name: string): void {
	clearSel()
	selectedBundle = name
	detailTab = 'readable'
	category = 'bundles'
}
function pickOp(name: string): void {
	clearSel()
	selectedOp = name
	detailTab = 'readable'
	category = 'operations'
}
function selectVibe(name: string): void {
	clearSel()
	selectedVibe = name
	vibeTab = 'ui'
	category = 'vibes'
}
function pickSkill(name: string): void {
	clearSel()
	selectedSkill = name
	category = 'skills'
}
function pickActor(name: string): void {
	clearSel()
	selectedActor = name
	category = 'actors'
}
function pickRun(name: string): void {
	clearSel()
	selectedRun = name
	category = 'runs'
}
// board 0110 — the rail selects a CATEGORY; auto-pick its first item so the detail pane always shows something.
function setCategory(cat: Category): void {
	clearSel()
	category = cat
	if (cat === 'schemas') {
		if (tables.length) pickSchema(tables[0].id, 'schema')
	} else if (cat === 'values') {
		if (tables.length) pickSchema(tables[0].id, 'data')
	} else if (cat === 'bundles') {
		if (bundleNames.length) pickBundle(bundleNames[0])
	} else if (cat === 'operations') {
		if (opItems.length) pickOp(opItems[0].name)
	} else if (cat === 'vibes') {
		if (vibeNames.length) selectVibe(vibeNames[0])
	} else if (cat === 'skills') {
		if (skillItems.length) pickSkill(skillItems[0].name)
	} else if (cat === 'actors') {
		if (actorItems.length) pickActor(actorItems[0].name)
	} else if (cat === 'runs') {
		if (runItems.length) pickRun(runItems[0].name)
	}
	category = cat
}
// board 0110 — one shared class for every item-list button (used across all categories).
const listBtn = (active: boolean): string =>
	`mb-0.5 flex w-full items-center justify-between gap-2 rounded-[var(--radius)] px-2.5 py-1.5 text-left transition-colors ${active ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-card'}`
const pretty = (v: unknown): string => {
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return String(v)
	}
}
/** A human-readable one-line read of a bundle's view field (place / presence / children). */
function readLabel(r: {
	pred?: string
	place?: string
	notNull?: string
	children?: boolean
}): string {
	if (r.notNull) return `${r.pred}.${r.notNull} present?`
	if (r.children) return `${r.pred}[]`
	return `${r.pred}.${r.place ?? '?'}`
}

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
	if (type === 'string' && typeof p.pattern === 'string' && p.pattern.includes('\\d{4}'))
		return 'date'
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
	selectedBundle = null
	selectedOp = null
	selectedVibe = null
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
	if (hit)
		return { label: hit.label, kind: 'row', target: { schemaId: hit.schemaId, rowId: hit.rowId } }
	return { label: s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s, kind: 'id' }
}

// Auto-select the first item once data loads (unless something is already selected). Default = VALUES.
$effect(() => {
	const nothing =
		!selectedId &&
		!selectedBundle &&
		!selectedOp &&
		!selectedVibe &&
		!selectedSkill &&
		!selectedActor &&
		!selectedRun
	if (nothing && tables.length > 0) pickSchema(tables[0].id, 'data')
})

// Deep link from a flow schema badge: select the requested schema by name + show its definition.
$effect(() => {
	if (!nav.dbSchema || tables.length === 0) return
	const match = tables.find((tbl) => tbl.name === nav.dbSchema)
	if (match) pickSchema(match.id, 'schema')
	nav.dbSchema = null
})
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: five sections, each with its own list. board 0105. -->
	<!-- board 0110 — left rail = pure CATEGORY selector -->
	<aside class="border-border hidden w-36 shrink-0 flex-col border-r pt-3 sm:flex">
		<div class="flex flex-col gap-0.5 px-2">
			{#each CATEGORIES as cat (cat.id)}
				<button
					type="button"
					class="rounded-[var(--radius)] px-3 py-1.5 text-left text-[11px] font-bold tracking-[0.1em] uppercase transition-colors {category ===
					cat.id
						? 'bg-primary/10 text-foreground'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => setCategory(cat.id)}>{cat.label}</button
				>
			{/each}
		</div>
	</aside>

	<!-- board 0110 — main = 50/50 (item list | selected-item detail) -->
	<div class="flex min-h-0 flex-1">
		<!-- left 50%: the current category's item list -->
		<div class="border-border w-1/4 min-w-0 shrink-0 overflow-y-auto border-r px-2 py-3">
			{#if category === 'schemas' || category === 'values'}
				{#if !loading && tables.length === 0}
					<p class="text-muted-foreground px-2 py-2 text-[11px]">{t('mainnet.db.empty')}</p>
				{/if}
				{#each tables as tbl (tbl.id)}
					<button
						type="button"
						class={listBtn(selectedId === tbl.id)}
						onclick={() => pickSchema(tbl.id, category === 'schemas' ? 'schema' : 'data')}>
						<span class="truncate font-mono text-[12px]">{tbl.name}</span>
						{#if category === 'values'}<span class="shrink-0 text-[11px] tabular-nums opacity-60">{tbl.rows.length}</span>{/if}
					</button>
				{/each}
			{:else if category === 'bundles'}
				{#each bundleNames as name (name)}
					<button type="button" class={listBtn(selectedBundle === name)} onclick={() => pickBundle(name)}>
						<span class="truncate font-mono text-[12px]">{name}</span>
					</button>
				{/each}
			{:else if category === 'operations'}
				{#each opItems as op (op.name)}
					<button type="button" class={listBtn(selectedOp === op.name)} onclick={() => pickOp(op.name)}>
						<span class="flex min-w-0 items-center gap-2">
							<span class="shrink-0 rounded-full px-1 py-0.5 text-[8px] font-semibold {op.kind === 'mutation' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}">{op.kind === 'mutation' ? 'M' : 'Q'}</span>
							<span class="truncate font-mono text-[12px]">{op.name}</span>
						</span>
					</button>
				{/each}
			{:else if category === 'vibes'}
				<!-- board 0110 — the website Composer, moved in from the old separate Vibes tab -->
				<button type="button" class={listBtn(selectedVibe === 'website')} onclick={() => selectVibe('website')}>
					<span class="truncate font-mono text-[12px]">website</span>
				</button>
				{#each vibeNames as name (name)}
					<button type="button" class={listBtn(selectedVibe === name)} onclick={() => selectVibe(name)}>
						<span class="truncate font-mono text-[12px]">{name}</span>
					</button>
				{/each}
			{:else if category === 'skills'}
				{#each skillItems as it (it.name)}
					<button type="button" class={listBtn(selectedSkill === it.name)} onclick={() => pickSkill(it.name)}>
						<span class="truncate font-mono text-[12px]">{it.name}</span>
					</button>
				{/each}
			{:else if category === 'actors'}
				{#each actorItems as it (it.name)}
					<button type="button" class={listBtn(selectedActor === it.name)} onclick={() => pickActor(it.name)}>
						<span class="truncate font-mono text-[12px]">{it.name}</span>
						{#if it.tag}<span class="shrink-0 text-[10px] opacity-50">{it.tag}</span>{/if}
					</button>
				{/each}
			{:else if category === 'runs'}
				{#if runItems.length === 0}<p class="text-muted-foreground px-2 py-2 text-[11px]">—</p>{/if}
				{#each runItems as it, i (i)}
					<button type="button" class={listBtn(selectedRun === it.name)} onclick={() => pickRun(it.name)}>
						<span class="truncate text-[12px]">{it.name}</span>
						{#if it.tag}<span class="shrink-0 font-mono text-[10px] opacity-50">{it.tag}</span>{/if}
					</button>
				{/each}
			{/if}
		</div>

		<!-- right 50%: the selected item detail -->
		<div class="w-3/4 min-w-0 min-h-0 overflow-y-auto p-4">
		{#if err}
			<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
		{/if}
		{#if selectedVibe === 'website'}
			<!-- board 0110 — the website Composer, moved into the DB viewer (was the separate Vibes tab) -->
			<div class="min-h-0 flex-1">
				<Composer />
			</div>
		{:else if selectedVibe}
			<!-- board 0105 — a vibe as ONE entity: a tabbed detail. UI = the live card through the engine
			     (VibeCard) + a readable summary aside; the other tabs are the raw View/Function/Style/State. -->
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedVibe}</h2>
				</div>
				<!-- tabs -->
				<div
					class="border-border mb-4 inline-flex shrink-0 self-start overflow-hidden rounded-[var(--radius)] border text-[12px]"
				>
					{#each VIBE_TABS as tabDef (tabDef.id)}
						<button
							type="button"
							class="border-border px-3 py-1 transition-colors not-first:border-l {vibeTab === tabDef.id
								? 'bg-primary/10 text-foreground font-medium'
								: 'text-muted-foreground hover:bg-card'}"
							onclick={() => (vibeTab = tabDef.id)}
						>
							{tabDef.label}
						</button>
					{/each}
				</div>

				{#if vibeTab === 'ui'}
					<!-- live render + readable summary aside -->
					<!-- board 0110 — summary as a WIDE card on top, so the live preview below runs full-width + larger -->
					<div class="flex flex-col gap-4">
						<div class="border-border bg-card w-full rounded-[var(--radius-lg)] border p-4 text-[12px]">
							<p class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase">{t('mainnet.db.vibe.summary')}</p>
							<p class="text-muted-foreground leading-relaxed">{t('mainnet.db.vibe.summaryHint')}</p>
							<dl class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
								<div class="flex gap-2"><dt class="text-muted-foreground">view</dt><dd class="text-foreground font-mono">ViewDef</dd></div>
								<div class="flex gap-2"><dt class="text-muted-foreground">function</dt><dd class="text-foreground font-mono">{(vibeBundleQuery.data?.logic ?? '').length} B</dd></div>
								<div class="flex gap-2"><dt class="text-muted-foreground">style</dt><dd class="text-foreground font-mono">{Object.keys((vibeBundleQuery.data?.style as { selectors?: object })?.selectors ?? {}).length} rules</dd></div>
								<div class="flex gap-2"><dt class="text-muted-foreground">source keys</dt><dd class="text-foreground font-mono">{Object.keys(vibeSample).join(', ') || '—'}</dd></div>
							</dl>
						</div>
						<div class="border-border bg-card min-w-0 rounded-[var(--radius-lg)] border p-4">
							<VibeCard schema={selectedVibe} data={vibeSample} containerName={`db-vibe-${selectedVibe}`} />
						</div>
					</div>
				{:else}
					{@const raw =
						vibeTab === 'view'
							? pretty(vibeBundleQuery.data?.view)
							: vibeTab === 'style'
								? pretty(vibeBundleQuery.data?.style)
								: vibeTab === 'function'
									? (vibeBundleQuery.data?.logic ?? '')
									: pretty(vibeSample)}
					{#if vibeBundleQuery.isPending}
						<p class="text-muted-foreground text-[13px]">…</p>
					{:else}
						<pre
							class="border-border bg-card text-foreground overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
						><code
								>{raw}</code
							></pre>
					{/if}
				{/if}
			</div>
		{:else if selectedBundle}
			<!-- board 0105 — a bundle read as a KIND: its traits (which predicate each plays) + its view
			     (how they read back flat), not raw JSON. Raw TypeSpec stays available on demand. -->
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedBundle}</h2>
				</div>
				{#if bundleDetailQuery.isPending}
					<p class="text-muted-foreground text-[13px]">…</p>
				{:else if bundleSpec}
					<div
						class="border-border mb-4 inline-flex shrink-0 self-start overflow-hidden rounded-[var(--radius)] border text-[12px]"
					>
						{#each [['readable', 'Readable'], ['raw', 'Raw JSON']] as [id, label] (id)}
							<button
								type="button"
								class="border-border px-3 py-1 transition-colors not-first:border-l {detailTab === id
									? 'bg-primary/10 text-foreground font-medium'
									: 'text-muted-foreground hover:bg-card'}"
								onclick={() => (detailTab = id as DetailTab)}>{label}</button
							>
						{/each}
					</div>
					{#if detailTab === 'readable'}
					<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4">
						<p
							class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase"
						>
							Traits
						</p>
						<ul class="divide-border/60 divide-y">
							{#each bundleSpec.parts ?? [] as p (p.pred)}
								<li class="flex items-baseline gap-2.5 py-1.5 text-[12px]">
									<span class="text-foreground font-mono font-medium">{p.pred}</span>
									<span
										class="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
										>{p.kind}</span
									>
									{#if p.field}
										<span class="text-muted-foreground truncate">← {p.field}</span>
									{/if}
								</li>
							{/each}
						</ul>
						<p
							class="text-muted-foreground mt-3 mb-1.5 text-[10px] font-semibold tracking-wide uppercase"
						>
							View
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each Object.entries(bundleSpec.project ?? {}) as [ field, r ] (field)}
								<span class="border-border rounded-full border px-2 py-0.5 text-[11px]">
									<span class="text-foreground font-medium">{field}</span>
									<span class="text-muted-foreground font-mono"> = {readLabel(r)}</span>
								</span>
							{/each}
						</div>
					</div>
					{:else}
					<pre
						class="border-border bg-card text-foreground overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
					><code>{pretty(bundleSpec)}</code></pre>
					{/if}
				{:else}
					<p class="text-muted-foreground text-[13px]">{t('mainnet.db.emptySpecs')}</p>
				{/if}
			</div>
		{:else if selectedOp}
			<!-- board 0105 — an operation read structurally: kind + a readable breakdown of its spec (query
			     filter/join/project, or the mutation's insert/delete/update ops). Raw spec on demand. -->
			{@const s = (selectedOpItem?.spec ?? {}) as Record<string, unknown>}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<span
						class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {selectedOpItem?.kind ===
						'mutation'
							? 'bg-amber-100 text-amber-700'
							: 'bg-sky-100 text-sky-700'}"
						>{selectedOpItem?.kind}</span
					>
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedOp}</h2>
				</div>
					<div
						class="border-border mb-4 inline-flex shrink-0 self-start overflow-hidden rounded-[var(--radius)] border text-[12px]"
					>
						{#each [['readable', 'Readable'], ['raw', 'Raw JSON']] as [id, label] (id)}
							<button
								type="button"
								class="border-border px-3 py-1 transition-colors not-first:border-l {detailTab === id
									? 'bg-primary/10 text-foreground font-medium'
									: 'text-muted-foreground hover:bg-card'}"
								onclick={() => (detailTab = id as DetailTab)}>{label}</button
							>
						{/each}
					</div>
					{#if detailTab === 'readable'}
				<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4 text-[13px]">
					{#if selectedOpItem?.kind === 'query'}
						<dl class="flex flex-col gap-2">
							<div class="flex gap-3">
								<dt class="text-muted-foreground w-20 shrink-0">from</dt>
								<dd class="text-foreground font-mono">{s.from}</dd>
							</div>
							{#if Array.isArray(s.where) && s.where.length}
								<div class="flex gap-3">
									<dt class="text-muted-foreground w-20 shrink-0">where</dt>
									<dd class="text-foreground font-mono">
										{(s.where as { place: string; op: string; value?: unknown; param?: string }[])
											.map((f) => `${f.place} ${f.op} ${f.param ? `:${f.param}` : JSON.stringify(f.value)}`)
											.join('  ·  ')}
									</dd>
								</div>
							{/if}
							{#if Array.isArray(s.join) && s.join.length}
								<div class="flex gap-3">
									<dt class="text-muted-foreground w-20 shrink-0">join</dt>
									<dd class="text-foreground font-mono">
										{(s.join as { predicate: string; kind?: string; on: { place: string; base: string } }[])
											.map((j) => `${j.kind === 'left' ? 'left ' : ''}${j.predicate} (${j.on.place}=${j.on.base})`)
											.join('  ·  ')}
									</dd>
								</div>
							{/if}
							{#if s.group_by}
								<div class="flex gap-3">
									<dt class="text-muted-foreground w-20 shrink-0">group</dt>
									<dd class="text-foreground font-mono">{s.group_by}{s.count ? ' · count' : ''}</dd>
								</div>
							{/if}
							{#if Array.isArray(s.project) && s.project.length}
								<div class="flex gap-3">
									<dt class="text-muted-foreground w-20 shrink-0">project</dt>
									<dd class="text-foreground font-mono">
										{(s.project as unknown[]).map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(', ')}
									</dd>
								</div>
							{/if}
						</dl>
					{:else}
						{@const ops = (s.ops ?? []) as { op: string; predicate: string }[]}
						<ul class="flex flex-col gap-1.5">
							{#each ops as o, i (i)}
								<li class="flex items-center gap-2.5">
									<span
										class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {o.op === 'delete'
											? 'bg-red-100 text-red-700'
											: o.op === 'update'
												? 'bg-amber-100 text-amber-700'
												: 'bg-green-100 text-green-700'}"
										>{o.op}</span
									>
									<span class="text-foreground font-mono">{o.predicate}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
					{:else}
					<pre
						class="border-border bg-card text-foreground overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
					><code>{pretty(s)}</code></pre>
					{/if}
			</div>
		{:else if selectedActor}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedActor}</h2>
					{#if selectedActorItem?.tag}<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">{selectedActorItem.tag}</span>{/if}
				</div>
				<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4 text-[13px]">
					<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">Actor</p>
					<p class="text-foreground">{selectedActorItem?.gloss || '—'}</p>
					<p class="text-muted-foreground mt-3 text-[12px] leading-relaxed">Behavior is resolved by engine name; the config — mailbox · llm · prompt · context — is data (board 0110).</p>
				</div>
			</div>
		{:else if selectedSkill}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedSkill}</h2>
				</div>
				<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4 text-[13px]">
					<p class="text-foreground">{selectedSkillItem?.gloss || '—'}</p>
					<p class="text-muted-foreground mt-3 mb-1.5 text-[10px] font-semibold tracking-wide uppercase">Actors</p>
					<div class="flex flex-wrap gap-1.5">
						{#each actorItems.filter((a) => a.tag === selectedSkill) as a (a.name)}
							<button type="button" class="border-border hover:bg-primary/10 rounded-full border px-2 py-0.5 font-mono text-[11px]" onclick={() => pickActor(a.name)}>{a.name}</button>
						{/each}
					</div>
				</div>
			</div>
		{:else if selectedRun}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<h2 class="text-foreground font-mono text-base font-semibold">{selectedRun}</h2>
					{#if selectedRunItem?.tag}<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[11px]">{selectedRunItem.tag}</span>{/if}
				</div>
				<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4 text-[13px]">
					<p class="text-foreground">status: {selectedRunItem?.gloss || '—'}</p>
				</div>
			</div>
		{:else if selected}
			<div class="mx-auto flex w-full max-w-4xl flex-col">
				<div class="mb-3 flex items-center gap-2">
					<span class="text-muted-foreground text-[11px] tracking-wide uppercase"
						>{view === 'schema' ? t('mainnet.db.tabSchema') : t('mainnet.db.tabData')}</span
					>
					<h2 class="text-foreground font-mono text-base font-semibold">{selected.name}</h2>
					{#if view === 'data'}
						<span class="text-muted-foreground text-[11px] tabular-nums opacity-60"
							>{selected.rows.length}</span
						>
					{/if}
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
											title={t('mainnet.db.gismuTitle')}
											>≡ {m.gismu}</span
										>
									{/if}
									<span
										class="text-muted-foreground text-[11px] tracking-wider uppercase opacity-70"
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
												>
													{t(`mainnet.db.place.${h}`)}
												</th>
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
												<td class="text-foreground px-3 py-2 align-top font-mono text-[12px]">
													{pl.kind}
												</td>
												<td class="text-muted-foreground px-3 py-2 align-top font-mono text-[12px]">
													{pl.example || '—'}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<details class="text-[12px]">
								<summary
									class="text-muted-foreground hover:text-foreground cursor-pointer select-none"
								>
									{t('mainnet.db.rawSchema')}
								</summary>
								<pre
									class="border-border bg-card text-foreground mt-2 overflow-auto rounded-[var(--radius-lg)] border p-4 leading-relaxed"
								><code
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
															>{r.label}</span
														>
													{:else if r.kind === 'row'}
														<button
															type="button"
															class="border-border text-foreground hover:bg-primary/10 hover:border-primary/40 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors"
															title={`Go to ${r.label}`}
															onclick={(e) => {
																e.stopPropagation()
																gotoRef(r.target)
															}}
														>
															{r.label}
														</button>
													{:else}
														<span
															class="text-muted-foreground font-mono text-[12px]"
															title={String(row.data?.[c.key] ?? '')}
															>{r.label}</span
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
					onclick={() => (focusRow = null)}
				>
					×
				</button>
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
								<span class="text-foreground font-mono text-[13px] font-semibold"
									>{s.predicate}</span
								>
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
													onclick={() => gotoRef(target)}
												>
													{part.ref.label}
												</button>
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
