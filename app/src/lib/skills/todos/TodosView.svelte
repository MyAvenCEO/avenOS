<script lang="ts">
import { SPARKS, type TodoStatus, type Todos } from './store.svelte'
import { STATUS_LABEL } from './tools'

/**
 * The todo list, hand-operable, in two shapes.
 *
 * Styled to the reference cards, deliberately more literally than the rest of
 * the app: white cards with soft diffuse shadows on a whisper-gray canvas,
 * vivid status colors (amber in progress, green complete), near-black type on
 * the system sans. The status colors are hardcoded here rather than drawn
 * from the brand tokens because matching the reference is the point.
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

/** Pill colors per status, sampled from the reference. */
const PILL: Record<TodoStatus, string> = {
	open: 'bg-[#f2f3f5] text-[#8b8f98]',
	doing: 'bg-[#fdf3e7] text-[#e28800]',
	done: 'bg-[#e9f9ef] text-[#17a34a]'
}

const done = $derived(todos.visible.filter((t) => t.status === 'done').length)
const pct = $derived(
	todos.visible.length === 0 ? 0 : Math.round((done / todos.visible.length) * 100)
)

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
</script>

{#snippet glyph(status: TodoStatus)}
	<!-- The status as a shape, not just a word: dashed ring = offen, half-filled
	     ring = in Arbeit, filled check = erledigt. -->
	{#if status === 'open'}
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none">
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
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0">
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path d="M8 2 a 6 6 0 0 1 0 12 Z" fill="currentColor" />
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0">
			<circle cx="8" cy="8" r="7" fill="currentColor" />
			<path
				d="M4.8 8.4 L7 10.6 L11.2 5.8"
				fill="none"
				stroke="#fff"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet check(todo: { id: string; status: TodoStatus })}
	<!-- The reference checklist's control: a ring that fills near-black with a
	     white check when done. -->
	<button
		type="button"
		onclick={() => todos.toggle(todo.id)}
		aria-label={todo.status === 'done' ? 'Wieder öffnen' : 'Abhaken'}
		class="flex size-5 shrink-0 items-center justify-center rounded-full transition-colors {todo.status ===
		'done'
			? 'bg-[#1f2937]'
			: 'border-[1.5px] border-[#d6d9de] hover:border-[#9aa0a9]'}"
	>
		{#if todo.status === 'done'}
			<svg viewBox="0 0 16 16" class="size-3" fill="none">
				<path
					d="M4 8.4 L6.8 11 L12 5.4"
					stroke="#fff"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
	</button>
{/snippet}

<div
	class="flex min-h-0 flex-1 flex-col gap-4 rounded-3xl bg-[#f7f7f8] p-4 font-[-apple-system,BlinkMacSystemFont,'Inter','Segoe_UI',sans-serif] text-[#1a1d23] sm:p-5"
>
	<div class="flex items-center justify-between gap-3">
		<h2 class="font-semibold text-[15px]">Aufgaben</h2>

		{#if todos.visible.length > 0}
			<!-- The reference card's progress grammar: check, count, bar, percent. -->
			<span
				class="flex items-center gap-2.5 rounded-full bg-white px-3.5 py-1.5 text-[13px] shadow-[0_1px_3px_rgba(0,0,0,0.07)]"
			>
				<svg viewBox="0 0 16 16" class="size-4 text-[#b3b8c0]" fill="none">
					<circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M5.4 8.2 L7.2 10 L10.8 6.2"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span class="font-medium">{done} von {todos.visible.length}</span>
				<span class="h-1.5 w-24 overflow-hidden rounded-full bg-[#e9eaec]">
					<span
						class="block h-full rounded-full bg-[#22c55e] transition-[width]"
						style="width: {pct}%"
					></span>
				</span>
				<span class="text-[#8b8f98]">{pct}%</span>
			</span>
		{/if}
		<span class="flex-1"></span>

		<!-- Which spark and shape are on screen. Read-only on purpose: switching
		     is a conversation move — "zeig mir das Board", "zeig die Team-Liste" —
		     handled by the todo_show tool, never by a button. -->
		<span
			class="rounded-full bg-white px-3 py-1.5 text-[#8b8f98] text-xs shadow-[0_1px_3px_rgba(0,0,0,0.07)]"
		>
			{SPARKS.find((s) => s.id === todos.active)?.name}
			·
			{todos.view === 'board' ? 'Board' : 'Liste'}
		</span>
	</div>

	<form onsubmit={addTodo}>
		<input
			bind:value={newTodo}
			placeholder="Aufgabe hinzufügen…"
			class="w-full rounded-xl border border-black/5 bg-white px-4 py-2.5 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)] outline-none transition-shadow placeholder:text-[#b3b8c0] focus:shadow-[0_1px_3px_rgba(0,0,0,0.07),0_0_0_3px_rgba(31,41,55,0.06)]"
		>
	</form>

	{#if todos.view === 'list'}
		<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
			{#each todos.visible as todo (todo.id)}
				<li
					class="group flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.06)]"
				>
					{@render check(todo)}
					<span
						class="flex-1 font-medium leading-snug"
						class:line-through={todo.status === 'done'}
						class:text-[#b3b8c0]={todo.status === 'done'}
					>
						{todo.title}
					</span>
					<!-- The status as a badge, and the badge as the control: a click is
					     one step around open → doing → done. -->
					<button
						type="button"
						onclick={() => todos.cycle(todo.id)}
						title="Status weiterschalten"
						class="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-transform active:scale-95 {PILL[
							todo.status
						]}"
					>
						{@render glyph(todo.status)}
						{STATUS_LABEL[todo.status]}
					</button>
					<button
						type="button"
						onclick={() => todos.remove(todo.id)}
						class="shrink-0 text-[#b3b8c0] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#1a1d23]"
						aria-label="Löschen"
					>
						×
					</button>
				</li>
			{:else}
				<li class="pt-8 text-center text-[#b3b8c0] text-[13px]">
					Noch nichts. Sag zum Beispiel „setz Milch kaufen auf die Liste“.
				</li>
			{/each}
		</ul>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-3 gap-3">
			{#each COLUMNS as column (column.status)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex min-h-0 flex-col gap-2.5 rounded-2xl bg-[#eff0f2] p-2.5 transition-colors {dragging
						? 'bg-[#e9ebee]'
						: ''}"
					ondragover={(e) => e.preventDefault()}
					ondrop={() => drop(column.status)}
				>
					<div class="flex items-center gap-2 px-1.5 pt-0.5">
						<span
							class={column.status === 'open'
								? 'text-[#8b8f98]'
								: column.status === 'doing'
									? 'text-[#e28800]'
									: 'text-[#22c55e]'}
						>
							{@render glyph(column.status)}
						</span>
						<h3 class="font-medium text-[#5c616b] text-[13px]">{column.label}</h3>
						<span class="ml-auto text-[#b3b8c0] text-xs">
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
								class="group cursor-grab rounded-xl border border-black/5 bg-white px-3.5 py-3 font-medium text-sm leading-snug shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.06)] active:cursor-grabbing"
								class:text-[#b3b8c0]={todo.status === 'done'}
							>
								<div class="flex items-start gap-2">
									<span class="flex-1" class:line-through={todo.status === 'done'}>
										{todo.title}
									</span>
									<button
										type="button"
										onclick={() => todos.remove(todo.id)}
										class="shrink-0 text-[#b3b8c0] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#1a1d23]"
										aria-label="Löschen"
									>
										×
									</button>
								</div>
								<!-- Arrows for mouse-less moves; drag works too. -->
								<div
									class="flex justify-between pt-1.5 text-[#b3b8c0] opacity-0 transition-opacity group-hover:opacity-100"
								>
									<button
										type="button"
										onclick={() => shift(todo.id, -1)}
										disabled={column.status === 'open'}
										class="px-1 hover:text-[#1a1d23] disabled:invisible"
										aria-label="Nach links"
									>
										‹
									</button>
									<button
										type="button"
										onclick={() => shift(todo.id, 1)}
										disabled={column.status === 'done'}
										class="px-1 hover:text-[#1a1d23] disabled:invisible"
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
