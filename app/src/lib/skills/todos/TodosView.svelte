<script lang="ts">
import { SPARKS, type TodoStatus, type Todos } from './store.svelte'
import { STATUS_LABEL } from './tools'

/**
 * The todo list, hand-operable, in two shapes.
 *
 * The same store the model's tools edit — voice and mouse are the same
 * operations on the same data. The list is the compact shape; the board lays
 * the three statuses out as columns and cards move by drag or by the arrows.
 */
const { todos }: { todos: Todos } = $props()

let newTodo = $state('')

/** Card id in flight during a drag, so columns know what is being dropped. */
let dragging = $state<string | null>(null)

const COLUMNS: { status: TodoStatus; label: string }[] = [
	{ status: 'open', label: 'Offen' },
	{ status: 'doing', label: 'In Arbeit' },
	{ status: 'done', label: 'Erledigt' }
]

function addTodo(event: SubmitEvent) {
	event.preventDefault()
	if (newTodo.trim() === '') return
	todos.create(newTodo)
	newTodo = ''
}

function drop(status: TodoStatus) {
	if (dragging) todos.update(dragging, { status })
	dragging = null
}

/** One step left or right through the columns, for mouse-less moves. */
function shift(id: string, by: -1 | 1) {
	const todo = todos.byId(id)
	if (!todo) return
	const at = COLUMNS.findIndex((c) => c.status === todo.status)
	const next = COLUMNS[at + by]
	if (next) todos.update(id, { status: next.status })
}
const done = $derived(todos.visible.filter((t) => t.status === 'done').length)
const pct = $derived(
	todos.visible.length === 0 ? 0 : Math.round((done / todos.visible.length) * 100)
)
</script>

{#snippet glyph(status: TodoStatus)}
	<!-- The status as a shape, not just a word: dashed ring = offen, half-filled
	     ring = in Arbeit, filled check = erledigt. -->
	{#if status === 'open'}
		<svg viewBox="0 0 16 16" class="size-3 shrink-0" fill="none">
			<circle
				cx="8"
				cy="8"
				r="6"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-dasharray="2.6 2.4"
			/>
		</svg>
	{:else if status === 'doing'}
		<svg viewBox="0 0 16 16" class="size-3 shrink-0">
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path d="M8 2 a 6 6 0 0 1 0 12 Z" fill="currentColor" />
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" class="size-3 shrink-0">
			<circle cx="8" cy="8" r="7" fill="currentColor" />
			<path
				d="M4.8 8.4 L7 10.6 L11.2 5.8"
				fill="none"
				stroke="var(--color-surface-card)"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-sm">Aufgaben</h2>

		{#if todos.visible.length > 0}
			<span
				class="flex items-center gap-2 rounded-full border border-border bg-surface-card px-3 py-1 text-xs opacity-80"
			>
				<span class="text-status-success">{@render glyph('done')}</span>
				{done}
				von {todos.visible.length}
				<span class="h-1 w-16 overflow-hidden rounded-full bg-primary/10">
					<span
						class="block h-full rounded-full bg-status-success transition-[width]"
						style="width: {pct}%"
					></span>
				</span>
				{pct}%
			</span>
		{/if}
		<span class="flex-1"></span>

		<!-- Which spark and shape are on screen. Read-only on purpose: switching
		     is a conversation move — "zeig mir das Board", "zeig die Team-Liste" —
		     handled by the todo_show tool, never by a button. -->
		<span class="rounded-full border border-border px-2.5 py-0.5 text-xs opacity-50">
			{SPARKS.find((s) => s.id === todos.active)?.name}
			·
			{todos.view === 'board' ? 'Board' : 'Liste'}
		</span>
	</div>

	<form onsubmit={addTodo}>
		<input
			bind:value={newTodo}
			placeholder="Aufgabe hinzufügen…"
			class="w-full rounded-full border border-border bg-input px-4 py-2 text-sm outline-none focus:border-primary-soft"
		>
	</form>

	{#if todos.view === 'list'}
		<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
			{#each todos.visible as todo (todo.id)}
				<li
					class="group flex items-center gap-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm shadow-xs transition-shadow hover:shadow-sm"
				>
					<input
						type="checkbox"
						checked={todo.status === 'done'}
						onchange={() => todos.toggle(todo.id)}
						class="size-3.5 shrink-0 accent-primary"
					>
					<span
						class="flex-1 leading-snug"
						class:line-through={todo.status === 'done'}
						class:opacity-40={todo.status === 'done'}
					>
						{todo.title}
					</span>
					<!-- The status as a badge, and the badge as the control: a click is
					     one step around open → doing → done. -->
					<button
						type="button"
						onclick={() => todos.cycle(todo.id)}
						title="Status weiterschalten"
						class="shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] transition-colors {todo.status ===
						'doing'
							? 'border-status-working/40 bg-status-working/10 text-status-working'
							: todo.status === 'done'
								? 'border-status-success/30 text-status-success'
								: 'border-border opacity-60'}"
					>
						{STATUS_LABEL[todo.status]}
					</button>
					<button
						type="button"
						onclick={() => todos.remove(todo.id)}
						class="shrink-0 opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
						aria-label="Löschen"
					>
						×
					</button>
				</li>
			{:else}
				<li class="pt-6 text-center text-xs opacity-40">
					Noch nichts. Sag zum Beispiel „setz Milch kaufen auf die Liste“.
				</li>
			{/each}
		</ul>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-3 gap-3">
			{#each COLUMNS as column (column.status)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-surface-card/50 p-2 transition-colors {dragging
						? 'border-dashed'
						: ''}"
					ondragover={(e) => e.preventDefault()}
					ondrop={() => drop(column.status)}
				>
					<div class="flex items-baseline justify-between px-1">
						<h3 class="text-xs opacity-60">{column.label}</h3>
						<span class="text-xs opacity-30">
							{todos.visible.filter((t) => t.status === column.status).length}
						</span>
					</div>

					<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
						{#each todos.visible.filter((t) => t.status === column.status) as todo (todo.id)}
							<li
								draggable="true"
								ondragstart={() => {
									dragging = todo.id
								}}
								ondragend={() => {
									dragging = null
								}}
								class="group cursor-grab rounded-xl border border-border bg-surface-card px-3 py-2 text-sm leading-snug shadow-xs transition-shadow hover:shadow-sm active:cursor-grabbing"
								class:opacity-40={todo.status === 'done'}
							>
								<div class="flex items-start gap-2">
									<span class="flex-1" class:line-through={todo.status === 'done'}>
										{todo.title}
									</span>
									<button
										type="button"
										onclick={() => todos.remove(todo.id)}
										class="shrink-0 opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
										aria-label="Löschen"
									>
										×
									</button>
								</div>
								<!-- Arrows for mouse-less moves; drag works too. -->
								<div
									class="flex justify-between pt-1 opacity-0 transition-opacity group-hover:opacity-40"
								>
									<button
										type="button"
										onclick={() => shift(todo.id, -1)}
										disabled={column.status === 'open'}
										class="px-1 disabled:invisible"
										aria-label="Nach links"
									>
										‹
									</button>
									<button
										type="button"
										onclick={() => shift(todo.id, 1)}
										disabled={column.status === 'done'}
										class="px-1 disabled:invisible"
										aria-label="Nach rechts"
									>
										›
									</button>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
</div>
