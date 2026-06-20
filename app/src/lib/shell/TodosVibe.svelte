<script lang="ts">
import type { UiEvent } from '@avenos/aven-vibes'
import { createTodosShell } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import {
	createValue,
	type DataValue,
	deleteValue,
	ensureSchema,
	listValues,
	updateValue
} from '$lib/data/client'
import { t } from '$lib/i18n'
import { POLL_MS, qk } from '$lib/query/client'

// The unified todos vibe: the aven-vibes todos vibe (JSON view/style + QuickJS) with its
// CRUD wired to the betterauth /api/data store. Single source of truth for the todos UI —
// reused in both the Vibes tab and the chat stream. board 0054.
let { containerName = 'aven-vibes-todos' }: { containerName?: string } = $props()

type Todo = { title: string; done: boolean }

const TODOS_SCHEMA = {
	type: 'object',
	properties: { title: { type: 'string', minLength: 1 }, done: { type: 'boolean' } },
	required: ['title'],
	additionalProperties: false
}

const shell = createTodosShell()
const queryClient = useQueryClient()

let schemaId = $state<string | null>(null)
let err = $state<string | null>(null)
let schemaStarted = false

// Resolve the todos schema id once; the values query stays disabled until it's known.
$effect(() => {
	if (schemaStarted) return
	schemaStarted = true
	void (async () => {
		try {
			schemaId = await ensureSchema('todos', TODOS_SCHEMA)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	})()
})

// Todos rows — live via TanStack Query, keyed on the schema id. The SSE 'data' event invalidates
// ['data'] so edits from anywhere (chat tool calls, other devices) refetch with no manual reload.
// board 0055.
const valuesQuery = createQuery(() => ({
	queryKey: schemaId ? qk.values(schemaId) : ['data', 'values', 'pending'],
	queryFn: () => listValues<Todo>(schemaId as string),
	enabled: !!schemaId,
	refetchInterval: POLL_MS.data
}))
const rows = $derived<DataValue<Todo>[]>(valuesQuery.data ?? [])

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

// All todo edits run through one mutation that invalidates ['data'] on success (the SSE 'data'
// event covers other clients; this makes the local edit snap instantly). board 0055.
const mutation = createMutation(() => ({
	mutationFn: async (event: UiEvent) => {
		const sid = schemaId
		if (!sid) return
		if (event.send === 'ADD_ITEM') {
			const title = String(event.payload?.text ?? '').trim()
			if (title) await createValue<Todo>(sid, { title, done: false })
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
	},
	onSuccess: () => queryClient.invalidateQueries({ queryKey: ['data'] }),
	onError: (e: unknown) => {
		err = e instanceof Error ? e.message : String(e)
	}
}))

function handleEvent(event: UiEvent): void {
	if (!schemaId || mutation.isPending) return
	err = null
	mutation.mutate(event)
}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2">
	{#if err}
		<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
	{/if}
	<div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
		<AvenVibeView
			{shell}
			{source}
			onEvent={handleEvent}
			{containerName}
			desktopHint={t('mainnet.auth.loading')}
		/>
	</div>
</div>
