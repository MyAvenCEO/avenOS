<script lang="ts">
import type { ToolPreview } from '@avenos/chat-engine/tool-call'

let { preview }: { preview: Extract<ToolPreview, { kind: 'tasks' }> } = $props()
const action = $derived(
	preview.operation === 'create'
		? 'angelegt'
		: preview.operation === 'update'
			? 'aktualisiert'
			: preview.tasks.every((task) => task.archived)
				? 'archiviert'
				: 'wiederhergestellt'
)
const statuses = { open: 'Offen', doing: 'In Arbeit', done: 'Erledigt' }
const due = (value: NonNullable<(typeof preview.tasks)[number]['due']>) => {
	// An all-day value is not a UTC appointment: retain its calendar day in every browser timezone.
	if (value.kind === 'date')
		return new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeZone: 'UTC' }).format(
			new Date(`${value.date}T12:00:00Z`)
		)
	const format = new Intl.DateTimeFormat('de', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: value.timezone
	})
	return `${value.kind === 'time' ? format.format(new Date(value.at)) : `${format.format(new Date(value.start))} – ${format.format(new Date(value.end))}`} (${value.timezone})`
}
</script>

<article aria-label="Aufgabenergebnis" class:trial={preview.mode === 'trial'}>
	<header>
		<strong>{preview.count} {preview.count === 1 ? 'Aufgabe' : 'Aufgaben'} {action}</strong>
		<span>{preview.mode === 'trial' ? 'Test · nicht gespeichert' : 'Gespeichert'}</span>
	</header>
	<ul>
		{#each preview.tasks as task}
			<li>
				<span class="mark" aria-hidden="true"
					>{task.archived ? '▣' : task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : '○'}</span
				>
				<div>
					<strong>{task.title}</strong>
					<p>
						{task.archived ? 'Archiviert' : statuses[task.status]}
						· {task.group === 'team' ? 'Team' : 'Meine Aufgaben'}
						{task.responsible ? ` · ${task.responsible}` : ''}
					</p>
					{#if task.due}
						<p>Fällig: {due(task.due)}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	{#if preview.count > preview.tasks.length}
		<p class="note">{preview.count - preview.tasks.length} weitere Aufgaben im Werkzeugbeleg.</p>
	{/if}
	<p class="note">
		Stand nach diesem Aufruf{preview.mode === 'trial' ? ' · echte Aufgaben unverändert' : ''}.
	</p>
</article>

<style>
article {
	border: 1px solid var(--color-border);
	border-radius: 14px;
	padding: 12px 14px;
	background: var(--color-surface-raised);
	font-size: 13px;
	overflow-wrap: anywhere;
	min-width: 0;
}
.trial {
	border-style: dashed;
}
header {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	align-items: baseline;
	justify-content: space-between;
}
header span,
p {
	font-size: 11px;
	color: var(--color-muted-foreground);
}
ul {
	padding: 0;
	margin: 10px 0;
	list-style: none;
	display: grid;
	gap: 10px;
}
li {
	display: flex;
	gap: 10px;
	align-items: baseline;
}
li div {
	min-width: 0;
}
.mark {
	flex: 0 0 14px;
}
p {
	margin: 2px 0;
}
.note {
	margin-top: 8px;
}
</style>
