import type { ToolSpec } from '$lib/chat/redpill'
import type { Todos } from './store.svelte'

/**
 * The todo list, described to the model and wired to the store.
 *
 * Two decisions shape all of this.
 *
 * Everything addresses todos by **id**, never by title. Titles came from a
 * speech recognizer and were matched by substring in both directions, so "Sport"
 * could tick off "Sport machen" or, just as happily, the wrong item — and did.
 * An id has to be read from a `todo_list` result, which means the model has
 * looked at the list before changing it. When it guesses one anyway, the error
 * says so plainly and hands back the list so it can retry immediately.
 *
 * Everything is **batched**. Five todos is one call, not five; ticking off three
 * is one call, not three. Asked for five tasks the model previously burned five
 * rounds, and clearing a finished list ran out of rounds entirely and answered
 * with a narration of the deletes it had failed to make.
 */

const IDS = {
	type: 'array',
	items: { type: 'string' },
	description: 'Eine oder mehrere ids, exakt so wie todo_list sie geliefert hat.'
}

export const TODO_TOOLS: ToolSpec[] = [
	{
		name: 'todo_list',
		description:
			'Gibt alle Aufgaben mit id und Status zurück. Rufe das auf, bevor du über die Liste ' +
			'sprichst, und immer bevor du etwas änderst oder löschst — du brauchst die ids.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'todo_create',
		description:
			'Legt eine oder mehrere neue Aufgaben an. Mehrere Aufgaben immer in einem einzigen ' +
			'Aufruf, nicht nacheinander.',
		parameters: {
			type: 'object',
			properties: {
				titles: {
					type: 'array',
					items: { type: 'string' },
					description: 'Die Titel, kurz und in der Sprache des Nutzers.'
				}
			},
			required: ['titles']
		}
	},
	{
		name: 'todo_update',
		description:
			'Ändert eine oder mehrere Aufgaben — erledigt ja/nein, oder den Titel. Alle gemeinten ' +
			'Aufgaben in einem Aufruf. Das ist der Normalfall: „habe ich schon", „brauche ich ' +
			'nicht mehr", „ist erledigt", „hab ich gemacht" heißen alle done=true, nicht löschen.',
		parameters: {
			type: 'object',
			properties: {
				ids: IDS,
				done: { type: 'boolean', description: 'true = erledigt, false = wieder offen.' },
				title: { type: 'string', description: 'Neuer Titel. Nur sinnvoll bei genau einer id.' }
			},
			required: ['ids']
		}
	},
	{
		name: 'todo_delete',
		description:
			'Löscht eine oder mehrere Aufgaben unwiderruflich. Nur wenn jemand ausdrücklich ' +
			'löschen, entfernen oder streichen sagt. Etwas erledigt zu haben ist kein Grund zu ' +
			'löschen — dafür ist todo_update mit done=true da. Im Zweifel abhaken, nicht löschen.',
		parameters: {
			type: 'object',
			properties: { ids: IDS },
			required: ['ids']
		}
	},
	{
		name: 'todo_clear_done',
		description:
			'Löscht alle bereits erledigten Aufgaben auf einmal. Dafür brauchst du keine ids und ' +
			'kein vorheriges todo_list.',
		parameters: { type: 'object', properties: {} }
	}
]

/** Accepts a list, a single string, or nothing — models are inconsistent here. */
function idList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
	return typeof value === 'string' && value !== '' ? [value] : []
}

/**
 * Hand the list back along with the complaint.
 *
 * A bare "you need ids" costs a whole extra round while the model calls
 * `todo_list` to learn what it could have been told right here.
 */
function missingIds(todos: Todos): string {
	return JSON.stringify({
		ok: false,
		error: 'keine gültigen ids übergeben — nimm die ids aus dieser Liste',
		todos: todos.items
	})
}

/**
 * The same result, in plain German, for the model's eyes.
 *
 * The raw JSON goes to the activity card; what goes back on the wire must not.
 * Feeding results back as JSON filled the history with braces and quotes, and
 * the model — whose chat template has no real tool lane — started continuing
 * the pattern instead of answering: replies degenerated into streams of `}`
 * with shreds of its own instructions mixed in. Prose with the same facts
 * (ids included, so addressing still works) carries no pattern to fall into.
 */
export function describeResult(resultJson: string): string {
	let result: Record<string, unknown>
	try {
		result = JSON.parse(resultJson)
	} catch {
		return resultJson
	}

	const line = (t: { id?: string; title?: string; done?: boolean }) =>
		`${t.id} ${t.title} (${t.done ? 'erledigt' : 'offen'})`
	const parts: string[] = []

	if (result.ok === false && typeof result.error === 'string') {
		parts.push(`Fehler: ${result.error}`)
	}
	const GROUPS = [
		['todos', 'Liste'],
		['created', 'neu angelegt'],
		['updated', 'geändert'],
		['deleted', 'gelöscht']
	] as const
	for (const [key, label] of GROUPS) {
		const items = result[key]
		if (!Array.isArray(items)) continue
		parts.push(
			items.length === 0
				? `${label}: nichts`
				: `${label} (${items.length}): ${items.map(line).join('; ')}`
		)
	}
	if (Array.isArray(result.unbekannteIds) && result.unbekannteIds.length > 0) {
		parts.push(`unbekannte ids: ${result.unbekannteIds.join(', ')}`)
	}
	return parts.join('. ') || resultJson
}

/**
 * Run one tool call against the store.
 *
 * Always answers with something the model can read back, including on failure —
 * a silent no-op would have it cheerfully confirm a deletion that never
 * happened, which is precisely what it used to do.
 */
export function runTodoTool(todos: Todos, name: string, rawArgs: string): string {
	let args: Record<string, unknown> = {}
	try {
		args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
	} catch {
		return JSON.stringify({ ok: false, error: `konnte die Argumente nicht lesen: ${rawArgs}` })
	}

	switch (name) {
		case 'todo_list':
			return JSON.stringify({ ok: true, todos: todos.items })

		case 'todo_create': {
			const titles = (Array.isArray(args.titles) ? args.titles : [args.titles])
				.filter((t): t is string => typeof t === 'string')
				.map((t) => t.trim())
				.filter((t) => t !== '')
			if (titles.length === 0) return JSON.stringify({ ok: false, error: 'keine Titel angegeben' })
			return JSON.stringify({ ok: true, created: titles.map((t) => todos.create(t)) })
		}

		case 'todo_update': {
			const ids = idList(args.ids)
			if (ids.length === 0) return missingIds(todos)

			const changes: { title?: string; done?: boolean } = {}
			if (typeof args.title === 'string') changes.title = args.title
			if (typeof args.done === 'boolean') changes.done = args.done

			const unknown = ids.filter((id) => !todos.byId(id))
			const updated = ids.map((id) => todos.update(id, changes)).filter((t) => t !== undefined)
			return JSON.stringify({ ok: updated.length > 0, updated, unbekannteIds: unknown })
		}

		case 'todo_delete': {
			const ids = idList(args.ids)
			if (ids.length === 0) return missingIds(todos)

			// Resolved before removing, so the reply can name what actually went.
			const targets = ids.map((id) => todos.byId(id)).filter((t) => t !== undefined)
			const unknown = ids.filter((id) => !targets.some((t) => t.id === id))
			const deleted = targets.map((t) => todos.remove(t.id)).filter((t) => t !== undefined)
			return JSON.stringify({ ok: deleted.length > 0, deleted, unbekannteIds: unknown })
		}

		case 'todo_clear_done':
			return JSON.stringify({ ok: true, deleted: todos.clearDone() })

		default:
			return JSON.stringify({ ok: false, error: `unbekanntes Werkzeug ${name}` })
	}
}
