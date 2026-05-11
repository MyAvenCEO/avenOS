<script lang="ts">
import TodoApproveReject from './hitl/TodoApproveReject.svelte'
import TodoChoice from './hitl/TodoChoice.svelte'
import TodoTextReply from './hitl/TodoTextReply.svelte'
import type { HitlTodo } from './types'

let {
	todos,
	onResolve
}: {
	todos: HitlTodo[]
	onResolve: (
		todoId: string,
		payload:
			| { kind: 'text_reply'; text: string }
			| { kind: 'choice'; optionId: string }
			| { kind: 'approve_reject'; approved: boolean }
	) => void
} = $props()

const openTodos = $derived(todos.filter((t) => t.status === 'open'))
</script>

{#if openTodos.length === 0}
	<p class="text-xs opacity-40 py-2">
		Nothing needs your input right now. When something does, it will show up here.
	</p>
{:else}
	<div class="space-y-4">
		{#each openTodos as todo (todo.id)}
			{#if todo.type === 'text_reply'}
				<TodoTextReply
					{todo}
					onSubmit={(text) => onResolve(todo.id, { kind: 'text_reply', text })}
				/>
			{:else if todo.type === 'choice'}
				<TodoChoice
					{todo}
					onPick={(optionId) => onResolve(todo.id, { kind: 'choice', optionId })}
				/>
			{:else if todo.type === 'approve_reject'}
				<TodoApproveReject
					{todo}
					onDecide={(approved) => onResolve(todo.id, { kind: 'approve_reject', approved })}
				/>
			{/if}
		{/each}
	</div>
{/if}
