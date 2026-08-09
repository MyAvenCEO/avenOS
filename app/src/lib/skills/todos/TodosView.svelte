<script lang="ts">
import type { Todos } from './store.svelte'

/**
 * The todo list, hand-operable.
 *
 * The same store the model's tools edit — voice and mouse are the same
 * operations on the same data, so a spoken todo and a typed one are
 * indistinguishable.
 */
const { todos }: { todos: Todos } = $props()

let newTodo = $state('')

function addTodo(event: SubmitEvent) {
	event.preventDefault()
	if (newTodo.trim() === '') return
	todos.create(newTodo)
	newTodo = ''
}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<div class="flex items-baseline justify-between">
		<h2 class="text-sm">Aufgaben</h2>
		<span class="text-xs opacity-40">
			{todos.open.length}
			offen{todos.items.length > todos.open.length
				? ` · ${todos.items.length - todos.open.length} erledigt`
				: ''}
		</span>
	</div>

	<form onsubmit={addTodo}>
		<input
			bind:value={newTodo}
			placeholder="Aufgabe hinzufügen…"
			class="w-full rounded-full border border-border bg-input px-4 py-2 text-sm outline-none focus:border-primary-soft"
		>
	</form>

	<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
		{#each todos.items as todo (todo.id)}
			<li
				class="group flex items-center gap-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm"
			>
				<input
					type="checkbox"
					checked={todo.done}
					onchange={() => todos.toggle(todo.id)}
					class="size-3.5 shrink-0 accent-primary"
				>
				<span
					class="flex-1 leading-snug"
					class:line-through={todo.done}
					class:opacity-40={todo.done}
				>
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
			</li>
		{:else}
			<li class="pt-6 text-center text-xs opacity-40">
				Noch nichts. Sag zum Beispiel „setz Milch kaufen auf die Liste“.
			</li>
		{/each}
	</ul>
</div>
