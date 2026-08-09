import type { ToolSpec } from '$lib/chat/redpill'
import type { Todos } from './store.svelte'

/**
 * The todo list, described to the model and wired to the store.
 *
 * The descriptions are written for a model that is being spoken to, not typed
 * at: it will be handed "streich Milch kaufen", never an id, so every tool that
 * addresses an existing item accepts the title as well and the store does the
 * matching. Insisting on ids would mean the model had to call `todo_list`
 * before it could do anything, which is a round trip the user hears as a pause.
 */

export const TODO_TOOLS: ToolSpec[] = [
	{
		name: 'todo_create',
		description: 'Legt eine neue Aufgabe an. Nutze das, sobald jemand etwas erledigen möchte.',
		parameters: {
			type: 'object',
			properties: {
				title: {
					type: 'string',
					description: 'Worum es geht, kurz und in der Sprache des Nutzers.'
				}
			},
			required: ['title']
		}
	},
	{
		name: 'todo_list',
		description:
			'Gibt alle Aufgaben mit Status zurück. Nutze das, bevor du über die Liste sprichst — rate nie.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'todo_update',
		description:
			'Ändert eine Aufgabe: Titel, oder erledigt ja/nein. Die Aufgabe wird über ihren Titel gefunden.',
		parameters: {
			type: 'object',
			properties: {
				todo: { type: 'string', description: 'Titel (oder id) der gemeinten Aufgabe.' },
				title: { type: 'string', description: 'Neuer Titel, falls er sich ändern soll.' },
				done: { type: 'boolean', description: 'true = erledigt, false = wieder offen.' }
			},
			required: ['todo']
		}
	},
	{
		name: 'todo_delete',
		description: 'Löscht eine Aufgabe endgültig. Für "erledigt" nutze todo_update mit done=true.',
		parameters: {
			type: 'object',
			properties: {
				todo: { type: 'string', description: 'Titel (oder id) der gemeinten Aufgabe.' }
			},
			required: ['todo']
		}
	}
]

/**
 * Run one tool call against the store.
 *
 * Always answers with something the model can read back, including when the
 * item was not found — a silent failure would have it cheerfully confirm a
 * deletion that never happened.
 */
export function runTodoTool(todos: Todos, name: string, rawArgs: string): string {
	let args: Record<string, unknown> = {}
	try {
		args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
	} catch {
		return JSON.stringify({ ok: false, error: `konnte die Argumente nicht lesen: ${rawArgs}` })
	}

	const target = typeof args.todo === 'string' ? args.todo : ''

	switch (name) {
		case 'todo_create': {
			const title = typeof args.title === 'string' ? args.title.trim() : ''
			if (title === '') return JSON.stringify({ ok: false, error: 'kein Titel angegeben' })
			return JSON.stringify({ ok: true, created: todos.create(title) })
		}

		case 'todo_list':
			return JSON.stringify({ ok: true, todos: todos.items })

		case 'todo_update': {
			const changes: { title?: string; done?: boolean } = {}
			if (typeof args.title === 'string') changes.title = args.title
			if (typeof args.done === 'boolean') changes.done = args.done
			const updated = todos.update(target, changes)
			return updated
				? JSON.stringify({ ok: true, updated })
				: JSON.stringify({ ok: false, error: `keine Aufgabe gefunden für "${target}"` })
		}

		case 'todo_delete': {
			const removed = todos.remove(target)
			return removed
				? JSON.stringify({ ok: true, deleted: removed })
				: JSON.stringify({ ok: false, error: `keine Aufgabe gefunden für "${target}"` })
		}

		default:
			return JSON.stringify({ ok: false, error: `unbekanntes Werkzeug ${name}` })
	}
}
