<script lang="ts">
import type { UiEvent } from '@avenos/aven-vibes'
import { createTodosShell } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import { createTodos, deleteTodo, listTodos, type Todo, updateTodos } from '$lib/data/client'
import { t } from '$lib/i18n'

// The unified todos vibe: the aven-vibes todos vibe (JSON view/style + QuickJS) with its
// CRUD wired to the betterauth /api/data store. Single source of truth for the todos UI —
// reused in both the Vibes tab and the chat stream. board 0054.
let { containerName = 'aven-vibes-todos' }: { containerName?: string } = $props()

const shell = createTodosShell()
const queryClient = useQueryClient()

let err = $state<string | null>(null)

// Todos load from the predication path (/api/data/todos → executeTodos → v_task). board 0087.
// Keyed under ['data'] so the SSE 'data' event invalidates it — edits from the chat tool or
// here refetch with no manual reload. board 0055.
const valuesQuery = createQuery(() => ({
	queryKey: ['data', 'todos'],
	queryFn: listTodos
}))
const rows = $derived<Todo[]>(valuesQuery.data ?? [])

const source = $derived({
	title: t('mainnet.todos.title'),
	items: rows.map((r) => ({ id: r.id, text: r.title, done: r.done === true })),
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
		if (event.send === 'ADD_ITEM') {
			const title = String(event.payload?.text ?? '').trim()
			if (title) await createTodos([{ title }])
		} else if (event.send === 'TOGGLE_ITEM') {
			const row = rows.find((r) => r.id === String(event.payload?.id ?? ''))
			if (row) await updateTodos([{ id: row.id, done: !row.done }])
		} else if (event.send === 'DELETE_ITEM') {
			const id = String(event.payload?.id ?? '')
			if (id) await deleteTodo(id)
		} else if (event.send === 'CLEAR_DONE') {
			for (const row of rows.filter((r) => r.done === true)) await deleteTodo(row.id)
		}
		// SET_DRAFT is DOM-local — no host action.
	},
	onSuccess: () => queryClient.invalidateQueries({ queryKey: ['data'] }),
	onError: (e: unknown) => {
		err = e instanceof Error ? e.message : String(e)
	}
}))

function handleEvent(event: UiEvent): void {
	if (mutation.isPending) return
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
