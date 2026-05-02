<script lang="ts">
import { assertLoaded } from 'jazz-tools'
import { AccountCoState } from 'jazz-tools/svelte'
import { AvenOSAccount, Todo } from '$lib/schema'

const me = new AccountCoState(AvenOSAccount, {
	resolve: {
		profile: true,
		root: { todos: { $each: true } }
	}
})

let newTitle = $state('')

function addTodo() {
	const title = newTitle.trim()
	if (!title) return
	const acc = me.current
	if (!acc?.$isLoaded) return
	const todos = acc.root.todos
	assertLoaded(todos)
	const owner = todos.$jazz.owner
	todos.$jazz.push(Todo.create({ title, done: false }, { owner }))
	newTitle = ''
}

function toggleTodo(todo: {
	done: boolean
	$jazz: { set: (key: 'done', value: boolean) => void }
}) {
	todo.$jazz.set('done', !todo.done)
}

function removeTodo(index: number) {
	const acc = me.current
	if (!acc?.$isLoaded) return
	acc.root.todos.$jazz.splice(index, 1)
}
</script>

<div class="wrap">
	<header class="header">
		<h1>Todos</h1>
		{#if me.current?.$isLoaded}
			<p class="meta">
				Signed in as
				<strong>{me.current.profile.name}</strong>
				<button type="button" class="linkish" onclick={() => void me.logOut()}>Sign out</button>
			</p>
			<label class="profile">
				Display name
				<input
					type="text"
					value={me.current.profile.name}
					oninput={(e) => {
						const acc = me.current;
						if (!acc?.$isLoaded) return;
						acc.profile.$jazz.set('name', e.currentTarget.value);
					}}
				>
			</label>
		{:else}
			<p class="meta muted">Loading account…</p>
		{/if}
	</header>

	{#if me.current?.$isLoaded}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				addTodo();
			}}
			class="add"
		>
			<input bind:value={newTitle} placeholder="New todo" autocomplete="off">
			<button type="submit">Add</button>
		</form>

		<ul class="list">
			{#each me.current.root.todos as todo, i (todo.$jazz.id)}
				<li class="row">
					<label class="tick">
						<input type="checkbox" checked={todo.done} onchange={() => toggleTodo(todo)}>
						<span class:done={todo.done}>{todo.title}</span>
					</label>
					<button type="button" class="danger" onclick={() => removeTodo(i)}>Remove</button>
				</li>
			{:else}
				<li class="empty muted">No todos yet.</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
.wrap {
	max-width: 36rem;
	margin: 0 auto;
	padding: 2rem 1.25rem 4rem;
	font-family:
		system-ui,
		-apple-system,
		Segoe UI,
		Roboto,
		sans-serif;
	line-height: 1.5;
	color: #0f172a;
}
.header h1 {
	font-size: 1.75rem;
	font-weight: 650;
	margin: 0 0 0.5rem;
	letter-spacing: -0.02em;
}
.meta {
	margin: 0 0 1rem;
	font-size: 0.9rem;
}
.meta strong {
	font-weight: 600;
}
.muted {
	color: #64748b;
}
.linkish {
	margin-left: 0.5rem;
	border: none;
	background: none;
	color: #2563eb;
	cursor: pointer;
	font: inherit;
	text-decoration: underline;
	padding: 0;
}
.profile {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	font-size: 0.85rem;
	color: #475569;
	margin-bottom: 1.5rem;
}
.profile input {
	padding: 0.5rem 0.65rem;
	border: 1px solid #cbd5e1;
	border-radius: 0.375rem;
	font: inherit;
}
.add {
	display: flex;
	gap: 0.5rem;
	margin-bottom: 1.25rem;
}
.add input {
	flex: 1;
	padding: 0.55rem 0.65rem;
	border: 1px solid #cbd5e1;
	border-radius: 0.375rem;
	font: inherit;
}
.add button,
.row button {
	padding: 0.55rem 0.85rem;
	border-radius: 0.375rem;
	font: inherit;
	font-weight: 500;
	cursor: pointer;
	border: 1px solid #1e293b;
	background: #1e293b;
	color: #fff;
}
.list {
	list-style: none;
	padding: 0;
	margin: 0;
	border: 1px solid #e2e8f0;
	border-radius: 0.5rem;
	overflow: hidden;
}
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.65rem 0.85rem;
	border-bottom: 1px solid #e2e8f0;
	background: #fff;
}
.row:last-child {
	border-bottom: none;
}
.tick {
	display: flex;
	align-items: flex-start;
	gap: 0.5rem;
	cursor: pointer;
	flex: 1;
	min-width: 0;
}
.tick span {
	word-break: break-word;
}
.done {
	text-decoration: line-through;
	color: #94a3b8;
}
.danger {
	border-color: #b91c1c;
	background: #fff;
	color: #b91c1c;
	flex-shrink: 0;
}
.empty {
	padding: 1rem 0.85rem;
	margin: 0;
}
</style>
