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

function removeTodo(id: string) {
	const acc = me.current
	if (!acc?.$isLoaded) return
	const idx = acc.root.todos.findIndex((t) => t?.$jazz.id === id)
	if (idx >= 0) acc.root.todos.$jazz.splice(idx, 1)
}

// Mock workers for the UI concept
const workers = [
	{ name: 'Calendar', task: 'Resolving conflicts', status: 'Active', score: '0.94' },
	{ name: 'Finance', task: 'Q3 Variance Analysis', status: 'Standby', score: '0.98' },
	{ name: 'Health', task: 'Sleep monitoring', status: 'Active', score: '0.82' },
	{ name: 'Projects', task: 'Maia City Tick 47', status: 'Ready', score: '-' }
]
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="min-h-screen bg-background p-6 sm:p-8 pb-10">
	<!-- Top Bar -->
	<header class="mx-auto max-w-2xl flex items-center justify-between mb-6">
		<div class="flex flex-col">
			<span class="text-xs font-bold opacity-30 uppercase tracking-widest mb-1">Aven Maia</span>
			<div class="flex items-center gap-2">
				{#if me.current?.$isLoaded}
					<input
						type="text"
						class="border-none bg-transparent p-0 text-3xl font-medium tracking-tighter outline-none focus:ring-0"
						value={me.current.profile.name}
						oninput={(e) => {
							const acc = me.current
							if (!acc?.$isLoaded) return
							acc.profile.$jazz.set('name', e.currentTarget.value)
						}}
						size={me.current.profile.name?.length || 5}
					/>
				{:else}
					<span class="text-3xl font-medium tracking-tighter opacity-20">Loading...</span>
				{/if}
			</div>
		</div>
		<button 
			class="size-10 flex items-center justify-center rounded-full border border-border bg-white/10 hover:bg-white/30 transition-all"
			onclick={() => void me.logOut()}
			aria-label="Log out"
		>
			<svg class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
			</svg>
		</button>
	</header>

	<main class="mx-auto max-w-2xl space-y-10">
		<!-- Main Intent Input -->
		<section class="tech-pill py-2.5 px-4 justify-between">
			<div class="flex items-center gap-3 flex-1">
				<div class="size-9 shrink-0 rounded-full border border-border flex items-center justify-center bg-white/20">
					<svg class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
					</svg>
				</div>
				<form 
					class="flex-1"
					onsubmit={(e) => { e.preventDefault(); addTodo(); }}
				>
					<input
						bind:value={newTitle}
						placeholder="Add new intent..."
						class="w-full bg-transparent border-none p-0 text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0"
					>
				</form>
			</div>
			<div class="flex items-center gap-3 pl-3 border-l border-border">
				<div class="flex flex-col items-end">
					<span class="text-[8px] font-bold uppercase opacity-30">Maia</span>
					<span class="text-xs font-bold uppercase tracking-tighter">Ready</span>
				</div>
			</div>
		</section>

		<!-- Intentions List (Now Middle) -->
		<section>
			<div class="flex items-center gap-2 mb-6">
				<span class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">My Intents</span>
			</div>
			<div class="space-y-0">
				{#if me.current?.$isLoaded}
					{#each me.current.root.todos as todo (todo.$jazz.id)}
						{#if todo}
							<div class="tech-row group">
								<div class="flex items-center gap-8">
									<span class="font-mono text-[10px] opacity-20">0{me.current.root.todos.indexOf(todo) + 1}</span>
									<span class="text-lg font-medium tracking-tight {todo.done ? 'opacity-20 line-through' : ''}">
										{todo.title}
									</span>
								</div>
								<div class="flex items-center gap-4">
									<button 
										type="button"
										onclick={() => toggleTodo(todo)}
										class="px-3 py-1 rounded-full border border-border text-[10px] font-bold uppercase transition-all {todo.done ? 'bg-foreground text-background' : 'hover:bg-foreground hover:text-background'}"
										aria-label={todo.done ? 'Mark intent as open' : 'Mark intent as done'}
										aria-pressed={todo.done}
									>
										{todo.done ? 'Done' : 'Open'}
									</button>
									<button 
										onclick={() => removeTodo(todo.$jazz.id)}
										class="opacity-0 group-hover:opacity-100 transition-all p-1 hover:text-error"
										aria-label="Delete"
									>
										<svg class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>
							</div>
						{/if}
					{/each}
				{:else}
					{#each [1, 2, 3] as _}
						<div class="tech-row animate-pulse">
							<div class="h-6 w-48 bg-black/5 rounded"></div>
							<div class="h-6 w-12 bg-black/5 rounded-full"></div>
						</div>
					{/each}
				{/if}
			</div>
		</section>

		<!-- Worker Grid (Now Bottom) -->
		<section>
			<div class="flex items-center gap-2 mb-6">
				<span class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">Active Workers</span>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{#each workers as worker}
					<div class="tech-card flex flex-col justify-between min-h-[140px]">
						<div class="flex justify-between items-start">
							<div class="flex flex-col">
								<span class="tech-label">{worker.name} Worker</span>
								<span class="text-sm font-bold tracking-tight">{worker.task}</span>
							</div>
							<div class="flex items-center gap-2">
								<span class="text-[10px] font-bold opacity-40">{worker.status}</span>
								<div class="worker-status-dot {worker.status === 'Active' ? 'bg-foreground animate-pulse' : 'bg-foreground/20'}"></div>
							</div>
						</div>
						<div class="flex justify-between items-end">
							<div class="flex flex-col">
								<span class="tech-label">Score</span>
								<span class="tech-value text-sm">{worker.score}</span>
							</div>
							<svg class="size-4 opacity-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</main>
</div>

<style>
:global(body) {
	background-color: #E8EDE1;
}
</style>
