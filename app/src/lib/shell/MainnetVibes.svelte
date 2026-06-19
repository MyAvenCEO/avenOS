<script lang="ts">
import type { UiEvent } from '@avenos/aven-vibes'
import { createTodosShell } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import {
	createValue,
	type DataValue,
	deleteValue,
	ensureSchema,
	listValues,
	updateValue
} from '$lib/data/client'
import { t } from '$lib/i18n'

// Mainnet "Vibes" view: the todos vibe (from @avenos/aven-vibes) rendered via the JSON
// view/style engine + QuickJS sandbox, its CRUD wired to the betterauth /api/data store.
// This dynamic vibe is the single source of truth for the todos UI (the hardcoded chat
// card was removed). board 0054.
type Todo = { title: string; done: boolean }

const TODOS_SCHEMA = {
	type: 'object',
	properties: { title: { type: 'string', minLength: 1 }, done: { type: 'boolean' } },
	required: ['title'],
	additionalProperties: false
}

const shell = createTodosShell()

// Available vibes for the left "select vibe" rail. Generic — add more vibes here as the
// aven-vibes lib grows; today the todos vibe is the only viewer. board 0054.
const VIBES: { id: string; label: string }[] = [{ id: 'todos', label: t('mainnet.todos.title') }]
let selectedVibe = $state('todos')

let schemaId = $state<string | null>(null)
let rows = $state<DataValue<Todo>[]>([])
let busy = $state(false)
let err = $state<string | null>(null)
let started = false

// The vibe's source: title + items ([{id,text,done}]) + labels. Re-derives on any data
// change, which remounts the view with the live list.
const source = $derived({
	title: t('mainnet.todos.title'),
	items: rows.map((r) => ({ id: r.id, text: r.data.title, done: r.data.done === true })),
	labels: {
		listEyebrow: t('identities.todos.listEyebrow'),
		openLabel: t('identities.todos.openLabel'),
		newSection: t('identities.todos.newSection'),
		entriesSection: t('identities.todos.entriesSection'),
		addPlaceholder: t('mainnet.todos.placeholder'),
		addButton: t('mainnet.todos.add'),
		clearDone: t('identities.todos.clearDone'),
		toggleAria: t('identities.todos.toggleDone'),
		deleteAria: t('common.delete'),
		emptyList: t('mainnet.todos.empty')
	}
})

async function refresh(): Promise<void> {
	if (schemaId) rows = await listValues<Todo>(schemaId)
}

async function init(): Promise<void> {
	try {
		schemaId = await ensureSchema('todos', TODOS_SCHEMA)
		await refresh()
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	}
}

$effect(() => {
	if (started) return
	started = true
	void init()
})

async function handleEvent(event: UiEvent): Promise<void> {
	if (!schemaId || busy) return
	busy = true
	err = null
	try {
		if (event.send === 'ADD_ITEM') {
			const title = String(event.payload?.text ?? '').trim()
			if (title) await createValue<Todo>(schemaId, { title, done: false })
		} else if (event.send === 'TOGGLE_ITEM') {
			const row = rows.find((r) => r.id === String(event.payload?.id ?? ''))
			if (row) await updateValue<Todo>(row.id, { ...row.data, done: !row.data.done })
		} else if (event.send === 'DELETE_ITEM') {
			const id = String(event.payload?.id ?? '')
			if (id) await deleteValue(id)
		} else if (event.send === 'CLEAR_DONE') {
			for (const row of rows.filter((r) => r.data.done === true)) await deleteValue(row.id)
		}
		// SET_DRAFT is DOM-local — no host action.
		await refresh()
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: select vibe viewer -->
	<aside class="border-border hidden w-48 shrink-0 flex-col border-r pt-3 sm:flex">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			{t('mainnet.vibes.select')}
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto px-2">
			{#each VIBES as v (v.id)}
				<button
					type="button"
					class="mb-0.5 block w-full truncate rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {v.id ===
					selectedVibe
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (selectedVibe = v.id)}
				>
					{v.label}
				</button>
			{/each}
		</div>
	</aside>

	<!-- Right: the selected vibe -->
	<div class="flex min-h-0 flex-1 flex-col gap-2 p-4">
		{#if err}
			<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
		{/if}
		{#if selectedVibe === 'todos'}
			<div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
				<AvenVibeView
					{shell}
					{source}
					onEvent={handleEvent}
					containerName="aven-vibes-mainnet-todos"
					desktopHint={t('mainnet.auth.loading')}
				/>
			</div>
		{/if}
	</div>
</div>
