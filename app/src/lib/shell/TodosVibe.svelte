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
	updateTodos
} from '$lib/data/client'
import { t } from '$lib/i18n'

// The unified todos vibe: the aven-vibes todos vibe (JSON view/style + QuickJS) with its
// CRUD wired to the betterauth /api/data store. Single source of truth for the todos UI —
// reused in both the Vibes tab and the chat stream. board 0054.
// board 0095: the view/style/logic now LOAD from the DB `vibe.*` registry (config-as-data) and override
// the file defaults — the app renders the vibe from the DB through the engine. The file shell supplies
// the interface/source defaults + renders instantly while the DB bundle resolves (it is identical).
// board 0099 — the Todos skill is an ACTOR HUB: this one vibe renders 4 modes, one per actor —
// `all` (read: the full interactive list) · `created` (the new tasks) · `edited` (only the updated tasks
// + a before→after diff) · `deleted` (the removed tasks). The create/edit/delete modes are read-only
// summary cards fed by the actor's `data`; `all` is the live interactive list.
type TodoMode = 'all' | 'created' | 'edited' | 'deleted'
type TodoDiff = { id: string; title: string; changes: { field: string; from: string; to: string }[] }
let {
	containerName = 'aven-vibes-todos',
	mode = 'all',
	data
}: {
	containerName?: string
	mode?: TodoMode
	data?: {
		items?: { id?: string; title?: string; done?: boolean; due?: string; priority?: string }[]
		diffs?: TodoDiff[]
	}
} = $props()

const summaryItems = $derived(data?.items ?? [])
const summaryDiffs = $derived(data?.diffs ?? [])
const MODE_LABEL: Record<Exclude<TodoMode, 'all'>, string> = {
	created: 'Neue Aufgaben',
	edited: 'Aktualisierte Aufgaben',
	deleted: 'Gelöschte Aufgaben'
}
const MODE_ACCENT: Record<Exclude<TodoMode, 'all'>, string> = {
	created: 'text-green-700',
	edited: 'text-primary',
	deleted: 'text-destructive'
}

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
	queryKey: ['data', 'todos'],
	queryFn: listTodos
}))
const rows = $derived<Todo[]>(valuesQuery.data ?? [])

// Human relative due: "in 3 days" / "in 5 hours" / "in 20 min" / "2 days overdue".
function relDue(iso: string | null | undefined): string {
	if (!iso) return ''
	const d = new Date(iso)
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
		priority: r.priority ?? ''
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
	{#if mode === 'all'}
		<div class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
			<AvenVibeView
				{shell}
				{source}
				onEvent={handleEvent}
				{containerName}
				desktopHint={t('mainnet.auth.loading')}
			/>
		</div>
	{:else}
		<!-- create / edit / delete actor summary — read-only card showing only what changed -->
		<div
			class="border-border bg-card mx-auto w-full max-w-2xl rounded-[var(--radius-lg)] border p-4"
			data-container={containerName}
		>
			<p class="text-[10px] font-semibold tracking-wide uppercase {MODE_ACCENT[mode]}">
				{MODE_LABEL[mode]} · {summaryItems.length}
			</p>
			<ul class="border-border/60 divide-border/60 mt-2 divide-y">
				{#each summaryItems as it (it.id ?? it.title)}
					<li class="flex items-baseline justify-between gap-3 py-1.5">
						<span
							class="text-foreground text-[13px] {mode === 'deleted' ? 'text-muted-foreground line-through' : ''}"
							>{it.title ?? '—'}</span
						>
						{#if mode === 'edited'}
							{@const d = summaryDiffs.find((x) => x.id === it.id)}
							{#if d}
								<span class="text-muted-foreground text-right text-[11px]">
									{#each d.changes as c (c.field)}
										<span class="whitespace-nowrap"
											>{c.field}: <s>{c.from || '—'}</s> → <b class="text-foreground">{c.to || '—'}</b></span
										>{' '}
									{/each}
								</span>
							{/if}
						{:else if it.due || it.priority}
							<span class="text-muted-foreground text-[11px]">{[it.priority, it.due].filter(Boolean).join(' · ')}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
			{#if summaryItems.length === 0}
				<p class="text-muted-foreground py-2 text-xs">—</p>
			{/if}
		</div>
	{/if}
</div>
