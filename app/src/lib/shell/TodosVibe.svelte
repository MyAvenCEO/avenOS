<script lang="ts">
import type { UiEvent } from '@avenos/aven-vibes'
import { createTodosShell } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import {
	createTodos,
	deleteTodo,
	listTodos,
	loadVibeBundle,
	type Todo,
	type TodoFilter,
	updateTodos
} from '$lib/data/client'
import { t } from '$lib/i18n'

// The interactive todos list vibe: the aven-vibes todos vibe (JSON view/style + QuickJS) with its CRUD
// wired to the betterauth /api/data store. Single source of truth for the live list UI — reused in the
// chat stream, the Skills preview, and the flow-step view. board 0054.
// board 0095: the view/style/logic LOAD from the DB `vibe.*` registry (config-as-data) and override the
// file defaults — the app renders the vibe from the DB through the engine. The file shell supplies the
// interface/source defaults + renders instantly while the DB bundle resolves (it is identical).
// board 0111: the created/edited/deleted "what changed" summaries render through VibeCard from their own
// vibe.* rows (schema todos-created/-edited/-deleted); this component only owns the live `all` list.
// board 0107 — an optional universal filter {field,value,op}; the vibe's OWN fetch applies it, so the
// rendered list is the SAME filtered subset the chat query returned (one data path, SSOT).
let {
	containerName = 'aven-vibes-todos',
	filter
}: { containerName?: string; filter?: TodoFilter } = $props()

const base = createTodosShell()
const vibeQuery = createQuery(() => ({
	queryKey: ['vibe', 'todos'],
	queryFn: () => loadVibeBundle('todos')
}))
const shell = $derived(
	vibeQuery.data
		? {
				...base,
				view: vibeQuery.data.view as typeof base.view,
				style: vibeQuery.data.style as typeof base.style,
				logic: vibeQuery.data.logic
			}
		: base
)
const queryClient = useQueryClient()

let err = $state<string | null>(null)

// Todos load from the predication path (/api/data/todos → executeTodos → v_task). board 0087.
// Keyed under ['data'] so the SSE 'data' event invalidates it — edits from the chat tool or
// here refetch with no manual reload. board 0055.
const valuesQuery = createQuery(() => ({
	queryKey: ['data', 'todos', filter ?? null],
	queryFn: () => listTodos(filter)
}))
const rows = $derived<Todo[]>(valuesQuery.data ?? [])

// Human relative due. A DATE-ONLY due ("YYYY-MM-DD") is a whole-DAY deadline — compare by calendar day so
// "today" reads "today" (NOT "13 hours overdue" — the old bug of parsing a bare date as UTC midnight). A
// due WITH a time keeps hour/minute precision. board 0105.
function relDue(iso: string | null | undefined): string {
	if (!iso) return ''
	const s = iso.trim()
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		// day-granular: compare local calendar days.
		const [y, m, d] = s.split('-').map(Number)
		const dueDay = new Date(y, m - 1, d)
		const today = new Date()
		today.setHours(0, 0, 0, 0)
		const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000)
		if (days === 0) return 'today'
		if (days === 1) return 'tomorrow'
		if (days === -1) return 'yesterday'
		return days < 0 ? `${-days} days overdue` : `in ${days} days`
	}
	const d = new Date(s)
	if (Number.isNaN(d.getTime())) return ''
	const ms = d.getTime() - Date.now()
	const past = ms < 0
	const abs = Math.abs(ms)
	const day = Math.floor(abs / 86_400_000)
	const hr = Math.floor(abs / 3_600_000)
	const min = Math.floor(abs / 60_000)
	let unit: string
	if (day >= 1) unit = `${day} day${day === 1 ? '' : 's'}`
	else if (hr >= 1) unit = `${hr} hour${hr === 1 ? '' : 's'}`
	else unit = `${Math.max(1, min)} min`
	return past ? `${unit} overdue` : `in ${unit}`
}

const source = $derived({
	title: t('mainnet.todos.title'),
	items: rows.map((r) => ({
		id: r.id,
		text: r.title,
		done: r.done === true,
		// due/priority predications → inline brand chips (board 0087); due as a relative label
		due: relDue(r.due),
		priority: r.priority ?? '',
		// board 0112 — Planner: goal chip + sub-task nesting flow into the vibe source.
		goal: r.goal ?? '',
		parent: r.parent ?? ''
	})),
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
