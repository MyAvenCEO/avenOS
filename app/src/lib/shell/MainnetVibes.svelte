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
// view/style engine + QuickJS sandbox, but its CRUD wired to the betterauth /api/data
// store (same 'todos' schema the chat's TodosCard uses). board 0054.
type Todo = { title: string; done: boolean }

const TODOS_SCHEMA = {
	type: 'object',
	properties: { title: { type: 'string', minLength: 1 }, done: { type: 'boolean' } },
	required: ['title'],
	additionalProperties: false
}

const shell = createTodosShell()

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

<div class="flex min-h-0 flex-1 flex-col gap-2 p-4">
	{#if err}
		<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
	{/if}
	<div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
		<AvenVibeView
			{shell}
			{source}
			onEvent={handleEvent}
			containerName="aven-vibes-mainnet-todos"
			desktopHint={t('mainnet.auth.loading')}
		/>
	</div>
</div>
