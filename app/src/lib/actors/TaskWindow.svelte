<script lang="ts">
import type { Task, TaskCommand } from '@avenos/productivity/tasks'
import { untrack } from 'svelte'
import type { TaskActor } from './todo.svelte'

const { actor, board = false }: { actor: TaskActor; board?: boolean } = $props()
let title = $state('')
let submittedTitle: string | null = null
const de = typeof navigator !== 'undefined' && navigator.language.startsWith('de')
const copy = de
	? {
			title: 'Aufgaben',
			me: 'Für mich',
			team: 'Team-Aufgaben',
			archive: 'Archiv',
			refresh: 'Aktualisieren',
			placeholder: 'Neue Aufgabe …',
			add: 'Hinzufügen',
			empty: 'Hier ist noch nichts offen.',
			hint: 'Füge eine Aufgabe hinzu oder beschreibe sie Aven.',
			loading: 'Aufgaben werden geladen …',
			more: 'Weitere laden',
			open: 'Offen',
			doing: 'In Arbeit',
			done: 'Erledigt',
			archiveTask: 'Archivieren',
			restore: 'Wiederherstellen',
			retry: 'Dieselbe Änderung erneut senden',
			details: 'Details',
			emptyArchive: 'Keine archivierten Aufgaben.',
			partial: 'Ein Teil der Aufgaben ist geladen.',
			saved: 'Im Workspace gespeichert',
			saving: 'Wird gespeichert …',
			uncertain:
				'Prüfe den gespeicherten Stand. Erneutes Senden verwendet dieselbe Änderung und legt nichts doppelt an.'
		}
	: {
			title: 'Tasks',
			me: 'For me',
			team: 'Team tasks',
			archive: 'Archive',
			refresh: 'Refresh',
			placeholder: 'New task…',
			add: 'Add',
			empty: 'Nothing open here yet.',
			hint: 'Add a task or describe it to Aven.',
			loading: 'Loading tasks…',
			more: 'Load more',
			open: 'Open',
			doing: 'In progress',
			done: 'Done',
			archiveTask: 'Archive',
			restore: 'Restore',
			retry: 'Retry this same change',
			details: 'Details',
			emptyArchive: 'No archived tasks.',
			partial: 'Part of the task list is loaded.',
			saved: 'Saved in this workspace',
			saving: 'Saving…',
			uncertain:
				'Check the saved state. Retrying uses this same change without creating a duplicate.'
		}
const viewState = $derived(actor.state)
const blocked = $derived(viewState.pending || viewState.loading || actor.canRetry)
const columns = ['open', 'doing', 'done'] as const
const statusLabel = (status: Task['status']) => copy[status]
function due(task: Task) {
	const value = task.due
	if (!value) return ''
	if (value.kind === 'date')
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
			new Date(`${value.date}T12:00:00Z`)
		)
	const format = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: value.timezone
	})
	return value.kind === 'time'
		? `${format.format(new Date(value.at))} · ${value.timezone}`
		: `${format.format(new Date(value.start))} – ${format.format(new Date(value.end))} · ${value.timezone}`
}
function change(task: Task, status: Task['status']) {
	return actor.change({
		operation: 'update',
		tasks: [{ id: task.id, revision: task.revision }],
		patch: { status }
	})
}
async function add() {
	if (!title.trim() || blocked) return
	submittedTitle = title
	const command: TaskCommand = {
		operation: 'create',
		tasks: [
			{ title: title.trim(), group: viewState.active, tags: [], due: null, responsible: null }
		]
	}
	await actor.change(command)
	clearSubmittedTitle()
}
function clearSubmittedTitle() {
	if (!viewState.error && !actor.canRetry) {
		if (title === submittedTitle) title = ''
		submittedTitle = null
	}
}
async function retry() {
	await actor.retry()
	clearSubmittedTitle()
}
$effect(() => {
	// reset() replaces this cache when the workspace changes. A mounted window
	// must load that workspace too, not wait for another click or remount.
	void actor.state
	untrack(() => {
		title = ''
		submittedTitle = null
		void actor.refresh()
	})
})
</script>

<section
	class="task-window"
	aria-label={copy.title}
	aria-busy={viewState.loading || viewState.pending}
>
	<header>
		<div>
			<h2>{copy.title}</h2>
			{#if viewState.pending || viewState.loaded}
				<p>{viewState.pending ? copy.saving : copy.saved}</p>
			{/if}
		</div>
		<button
			type="button"
			disabled={viewState.pending || viewState.loading}
			onclick={() => actor.reload()}
		>
			{copy.refresh}
		</button>
	</header>
	<nav aria-label={de ? 'Aufgabenbereich' : 'Task group'}>
		<button
			class:chosen={viewState.active === 'me'}
			disabled={viewState.pending || actor.canRetry}
			onclick={() => actor.show('me', viewState.archived)}
		>
			{copy.me}
		</button>
		<button
			class:chosen={viewState.active === 'team'}
			disabled={viewState.pending || actor.canRetry}
			onclick={() => actor.show('team', viewState.archived)}
		>
			{copy.team}
		</button>
		<label class="archive"
			><input
				type="checkbox"
				checked={viewState.archived}
				disabled={viewState.pending || actor.canRetry}
				onchange={(event) => actor.show(viewState.active, event.currentTarget.checked)}
			>{copy.archive}</label
		>
	</nav>
	{#if viewState.error}
		<div class="task-error" role="alert">
			<p>{viewState.error}</p>
			{#if actor.canRetry}
				<p>{copy.uncertain}</p>
				<button disabled={viewState.pending} onclick={retry}>{copy.retry}</button>
			{/if}
		</div>
	{/if}
	{#if !viewState.archived}
		<form onsubmit={(event) => { event.preventDefault(); void add() }}>
			<input
				aria-label={copy.placeholder}
				placeholder={copy.placeholder}
				maxlength="500"
				bind:value={title}
				disabled={viewState.pending || actor.canRetry}
			>
			<button disabled={blocked || !title.trim()}>{copy.add}</button>
		</form>
	{/if}
	{#if !viewState.loaded && viewState.loading}
		<p role="status">{copy.loading}</p>
	{/if}
	{#if viewState.loaded && viewState.tasks.length === 0}
		<div class="empty">
			<h3>{viewState.archived ? copy.emptyArchive : copy.empty}</h3>
			{#if !viewState.archived}
				<p>{copy.hint}</p>
			{/if}
		</div>
	{:else if board && !viewState.archived}
		<div class="task-board">
			{#each columns as column}
				<section aria-label={statusLabel(column)}>
					<h3>
						{statusLabel(column)}
						<small>{viewState.tasks.filter(task => task.status === column).length}</small>
					</h3>
					{#each viewState.tasks.filter(task => task.status === column) as task (task.id)}
						<article>
							<p class="task-title">{task.title}</p>
							{#if task.due}
								<p class="meta">{due(task)}</p>
							{/if}
							<select
								aria-label={`${task.title}: ${de ? 'Status' : 'status'}`}
								disabled={blocked}
								value={task.status}
								onchange={(event) => change(task, event.currentTarget.value as Task['status'])}
							>
								{#each columns as option}
									<option value={option}>{statusLabel(option)}</option>
								{/each}
							</select>
						</article>
					{/each}
				</section>
			{/each}
		</div>
	{:else}
		<ul class="task-list">
			{#each viewState.tasks as task (task.id)}
				<li>
					{#if !viewState.archived}
						<input
							type="checkbox"
							aria-label={`${copy.done}: ${task.title}`}
							checked={task.status === 'done'}
							disabled={blocked}
							onchange={(event) => change(task, event.currentTarget.checked ? 'done' : 'open')}
						>
					{/if}
					<div class="task-content">
						<p class:finished={task.status === 'done'} class="task-title">{task.title}</p>
						{#if task.due || task.responsible}
							<p class="meta">{[due(task), task.responsible].filter(Boolean).join(' · ')}</p>
						{/if}
						<details>
							<summary>{copy.details}</summary>
							<p class="meta">
								{statusLabel(task.status)}{task.tags.length ? ` · ${task.tags.join(', ')}` : ''}
							</p>
							<button
								disabled={blocked}
								onclick={() => actor.change({ operation: 'archive', tasks: [{ id: task.id, revision: task.revision }], archived: !viewState.archived })}
							>
								{viewState.archived ? copy.restore : copy.archiveTask}
							</button>
						</details>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	{#if viewState.next}
		<footer>
			<span>{copy.partial}</span
			><button disabled={blocked} onclick={() => actor.refresh(true)}>{copy.more}</button>
		</footer>
	{/if}
</section>

<style>
.task-window {
	padding: clamp(1rem, 3vw, 2rem);
	width: 100%;
	min-width: 0;
	overflow: auto;
}
header,
nav,
form,
footer {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex-wrap: wrap;
}
header {
	justify-content: space-between;
	margin-bottom: 1.25rem;
}
h2 {
	font-size: 1.5rem;
	font-weight: 600;
}
h3 {
	font-weight: 600;
}
header p,
.meta,
footer,
.empty p {
	color: var(--color-muted-foreground);
	font-size: 0.85rem;
}
button,
select {
	border: 1px solid var(--color-border, #deded6);
	border-radius: 0.7rem;
	padding: 0.45rem 0.7rem;
	font-size: 0.85rem;
}
button:disabled,
select:disabled {
	opacity: 0.5;
}
button:not(:disabled),
summary {
	cursor: pointer;
}
button.chosen {
	background: var(--color-primary, #1e293b);
	color: var(--color-primary-foreground, white);
}
nav {
	margin-bottom: 1.1rem;
}
.archive {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.85rem;
}
form {
	flex-wrap: nowrap;
	margin-bottom: 1.2rem;
}
form input {
	flex: 1;
	min-width: 0;
	padding: 0.65rem 0.85rem;
	border: 1px solid var(--color-border, #deded6);
	border-radius: 0.7rem;
}
.task-list {
	list-style: none;
	padding: 0;
}
li {
	display: flex;
	align-items: flex-start;
	gap: 0.85rem;
	padding: 1rem 0;
	border-bottom: 1px solid var(--color-border, #deded6);
}
li > input {
	margin-top: 0.3rem;
	width: 1.05rem;
	height: 1.05rem;
}
.task-content {
	min-width: 0;
	flex: 1;
}
.task-title {
	overflow-wrap: anywhere;
}
.finished {
	text-decoration: line-through;
	color: var(--color-muted-foreground);
}
details {
	margin-top: 0.35rem;
	font-size: 0.8rem;
}
details > p {
	margin: 0.5rem 0;
}
.empty {
	padding: 2.5rem 1rem;
	text-align: center;
}
.empty p {
	margin-top: 0.5rem;
}
.task-error {
	padding: 0.8rem;
	border: 1px solid var(--color-error, #c65138);
	border-radius: 0.8rem;
	margin-bottom: 1rem;
	font-size: 0.9rem;
	overflow-wrap: anywhere;
}
.task-error p + p,
.task-error button {
	margin-top: 0.6rem;
}
.task-board {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.85rem;
}
.task-board h3 {
	display: flex;
	justify-content: space-between;
	margin-bottom: 0.8rem;
	font-size: 0.9rem;
}
.task-board article {
	border: 1px solid var(--color-border, #deded6);
	border-radius: 0.8rem;
	padding: 0.85rem;
	margin-bottom: 0.7rem;
}
.task-board select {
	margin-top: 0.7rem;
	max-width: 100%;
}
footer {
	margin-top: 1rem;
	justify-content: space-between;
}
@media (max-width: 620px) {
	.task-board {
		grid-template-columns: 1fr;
	}
}
</style>
