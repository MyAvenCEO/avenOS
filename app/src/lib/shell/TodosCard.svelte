<script lang="ts">
import {
	createValue,
	type DataValue,
	deleteValue,
	ensureSchema,
	listValues,
	updateValue
} from '$lib/data/client'
import { t } from '$lib/i18n'

// Example consumer of the generic schema-driven data store (board 0053): a todos schema
// + schema-validated CRUD. The schema is seeded on first load; every write is validated
// server-side against it. Swapping in any other JSON Schema would give a different card.
type Todo = { title: string; done: boolean }

const TODOS_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1 },
		done: { type: 'boolean' }
	},
	required: ['title'],
	additionalProperties: false
}

let schemaId = $state<string | null>(null)
let items = $state<DataValue<Todo>[]>([])
let newTitle = $state('')
let busy = $state(false)
let error = $state<string | null>(null)
let started = false

async function init(): Promise<void> {
	try {
		schemaId = await ensureSchema('todos', TODOS_SCHEMA)
		items = await listValues<Todo>(schemaId)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
}

$effect(() => {
	if (started) return
	started = true
	void init()
})

async function add(): Promise<void> {
	const title = newTitle.trim()
	if (!title || !schemaId || busy) return
	busy = true
	error = null
	try {
		const created = await createValue<Todo>(schemaId, { title, done: false })
		items = [...items, created]
		newTitle = ''
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}

async function toggle(item: DataValue<Todo>): Promise<void> {
	const next = { ...item.data, done: !item.data.done }
	items = items.map((x) => (x.id === item.id ? { ...x, data: next } : x))
	try {
		await updateValue<Todo>(item.id, next)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
		items = items.map((x) => (x.id === item.id ? { ...x, data: item.data } : x)) // revert
	}
}

async function remove(item: DataValue<Todo>): Promise<void> {
	const prev = items
	items = items.filter((x) => x.id !== item.id)
	try {
		await deleteValue(item.id)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
		items = prev // revert
	}
}
</script>

<div class="shrink-0 px-4 pb-2">
	<div class="border-border bg-card mx-auto w-full max-w-2xl rounded-[var(--radius-lg)] border">
		<div class="border-border flex items-center justify-between border-b px-3 py-1.5">
			<span class="text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
				{t('mainnet.todos.title')}
			</span>
			{#if items.length > 0}
				<span class="text-muted-foreground text-[11px] tabular-nums">
					{items.filter((i) => i.data.done).length}/{items.length}
				</span>
			{/if}
		</div>

		<div class="max-h-40 overflow-y-auto px-2 py-1.5">
			{#if items.length === 0}
				<p class="text-muted-foreground px-1 py-1 text-[12px]">{t('mainnet.todos.empty')}</p>
			{/if}
			{#each items as item (item.id)}
				<div class="group flex items-center gap-2 rounded-[var(--radius)] px-1 py-1">
					<input
						type="checkbox"
						class="size-3.5 shrink-0 accent-[var(--color-primary)]"
						checked={item.data.done}
						onchange={() => void toggle(item)}
					>
					<span
						class="min-w-0 flex-1 truncate text-[13px] {item.data.done ? 'text-muted-foreground line-through' : ''}"
					>
						{item.data.title}
					</span>
					<button
						type="button"
						class="text-muted-foreground hover:text-destructive shrink-0 px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
						aria-label={t('common.dismiss')}
						onclick={() => void remove(item)}
					>
						×
					</button>
				</div>
			{/each}
		</div>

		<form
			class="border-border flex items-center gap-2 border-t px-2 py-1.5"
			onsubmit={(e) => {
				e.preventDefault()
				void add()
			}}
		>
			<input
				type="text"
				class="min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:opacity-40"
				placeholder={t('mainnet.todos.placeholder')}
				bind:value={newTitle}
				disabled={busy || !schemaId}
			>
			<button
				type="submit"
				class="border-border hover:bg-background shrink-0 rounded-[var(--radius)] border px-2.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
				disabled={busy || !schemaId || newTitle.trim() === ''}
			>
				{t('mainnet.todos.add')}
			</button>
		</form>

		{#if error}
			<p class="text-destructive px-3 pb-1.5 text-[11px]">{error}</p>
		{/if}
	</div>
</div>
