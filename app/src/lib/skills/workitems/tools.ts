import type { ToolSpec } from '$lib/chat/redpill'
import { SPARKS, type WorkItemStatus, type WorkItems } from './store.svelte'

/**
 * The todo list, described to the model and wired to the store.
 *
 * Two decisions shape all of this.
 *
 * Everything addresses store by **id**, never by title. Titles came from a
 * speech recognizer and were matched by substring in both directions, so "Sport"
 * could tick off "Sport machen" or, just as happily, the wrong item — and did.
 * An id has to be read from a `workitem_list` result, which means the model has
 * looked at the list before changing it. When it guesses one anyway, the error
 * says so plainly and hands back the list so it can retry immediately.
 *
 * Everything is **batched**. Five store is one call, not five; ticking off three
 * is one call, not three. Asked for five tasks the model previously burned five
 * rounds, and clearing a finished list ran out of rounds entirely and answered
 * with a narration of the deletes it had failed to make.
 */

/** How a status is written on the wire and read back to the model. */
const STATUS_WIRE: Record<string, WorkItemStatus> = {
	offen: 'open',
	in_arbeit: 'doing',
	erledigt: 'done'
}
export const STATUS_LABEL: Record<WorkItemStatus, string> = {
	open: 'offen',
	doing: 'in Arbeit',
	done: 'erledigt'
}

const SPARK = {
	type: 'string',
	enum: SPARKS.map((s) => s.id),
	description:
		'Der Projekt-Kontext (Spark): "me" für eigene Dinge, "team" für gemeinsame. ' +
		'Ohne Angabe gilt der gerade aktive Spark.'
}

const IDS = {
	type: 'array',
	items: { type: 'string' },
	description: 'Eine oder mehrere ids, exakt so wie workitem_list sie geliefert hat.'
}

export const WORKITEM_TOOLS: ToolSpec[] = [
	{
		name: 'workitem_list',
		description:
			'Gibt alle Aufgaben mit id, Status und Spark zurück — über alle Sparks. Rufe das ' +
			'auf, bevor du über die Liste sprichst, und immer bevor du etwas änderst oder ' +
			'löschst — du brauchst die ids.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'workitem_create',
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
				},
				spark: SPARK
			},
			required: ['titles']
		}
	},
	{
		name: 'workitem_update',
		description:
			'Ändert eine oder mehrere Aufgaben — Status oder Titel. Alle gemeinten Aufgaben in ' +
			'einem Aufruf. Das ist der Normalfall: „habe ich schon", „ist erledigt", „hab ich ' +
			'gemacht" heißen alle status=erledigt, nicht löschen. „Fange ich gerade an", „bin ' +
			'ich dran", „mache ich gerade" heißen status=in_arbeit.',
		parameters: {
			type: 'object',
			properties: {
				ids: IDS,
				status: {
					type: 'string',
					enum: ['offen', 'in_arbeit', 'erledigt'],
					description: 'Neuer Status der Aufgaben.'
				},
				done: {
					type: 'boolean',
					description: 'Kurzform: true = erledigt, false = offen. status geht vor.'
				},
				title: { type: 'string', description: 'Neuer Titel. Nur sinnvoll bei genau einer id.' },
				spark: SPARK
			},
			required: ['ids']
		}
	},
	{
		name: 'workitem_delete',
		description:
			'Löscht eine oder mehrere Aufgaben unwiderruflich. Nur wenn jemand ausdrücklich ' +
			'löschen, entfernen oder streichen sagt. Etwas erledigt zu haben ist kein Grund zu ' +
			'löschen — dafür ist workitem_update mit done=true da. Im Zweifel abhaken, nicht löschen.',
		parameters: {
			type: 'object',
			properties: { ids: IDS },
			required: ['ids']
		}
	},
	{
		name: 'workitem_show',
		description:
			'Wechselt, was der Nutzer sieht: die Ansicht (liste oder board) und/oder den ' +
			'aktiven Spark. „Zeig mir das Board" heißt view=board; „zeig meine Liste" heißt ' +
			'spark=me; „zeig die Team-Aufgaben als Board" heißt beides. Ändert keine Daten.',
		parameters: {
			type: 'object',
			properties: {
				view: {
					type: 'string',
					enum: ['liste', 'board'],
					description: 'Die Form: liste oder board.'
				},
				spark: SPARK
			}
		}
	},
	{
		name: 'workitem_clear_done',
		description:
			'Löscht alle bereits erledigten Aufgaben auf einmal. Dafür brauchst du keine ids und ' +
			'kein vorheriges workitem_list.',
		parameters: { type: 'object', properties: {} }
	}
]

/** A valid spark from the arguments, or the active one. */
function sparkOf(args: Record<string, unknown>, store: WorkItems): string {
	return typeof args.spark === 'string' && SPARKS.some((s) => s.id === args.spark)
		? args.spark
		: store.active
}

/** Accepts a list, a single string, or nothing — models are inconsistent here. */
function idList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
	return typeof value === 'string' && value !== '' ? [value] : []
}

/**
 * Hand the list back along with the complaint.
 *
 * A bare "you need ids" costs a whole extra round while the model calls
 * `workitem_list` to learn what it could have been told right here.
 */
function missingIds(store: WorkItems): string {
	return JSON.stringify({
		ok: false,
		error: 'keine gültigen ids übergeben — nimm die ids aus dieser Liste',
		store: store.items
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

	const line = (t: { id?: string; title?: string; status?: WorkItemStatus; spark?: string }) =>
		`${t.id} ${t.title} (${t.status ? STATUS_LABEL[t.status] : 'offen'}, ${t.spark ?? 'me'})`
	const parts: string[] = []

	if (result.ok === false && typeof result.error === 'string') {
		parts.push(`Fehler: ${result.error}`)
	}
	const GROUPS = [
		['store', 'Liste'],
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
	// workitem_show answers with the new view state, not with items.
	if (typeof result.view === 'string') {
		parts.push(
			`Angezeigt wird jetzt: ${result.view === 'board' ? 'Board' : 'Liste'}, Spark ${result.spark}`
		)
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
export function runWorkItemTool(store: WorkItems, name: string, rawArgs: string): string {
	let args: Record<string, unknown> = {}
	try {
		args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)
	} catch {
		return JSON.stringify({ ok: false, error: `konnte die Argumente nicht lesen: ${rawArgs}` })
	}

	switch (name) {
		case 'workitem_list':
			return JSON.stringify({ ok: true, store: store.items })

		case 'workitem_create': {
			const titles = (Array.isArray(args.titles) ? args.titles : [args.titles])
				.filter((t): t is string => typeof t === 'string')
				.map((t) => t.trim())
				.filter((t) => t !== '')
			if (titles.length === 0) return JSON.stringify({ ok: false, error: 'keine Titel angegeben' })
			const spark = sparkOf(args, store)
			return JSON.stringify({ ok: true, created: titles.map((t) => store.create(t, spark)) })
		}

		case 'workitem_update': {
			const ids = idList(args.ids)
			if (ids.length === 0) return missingIds(store)

			const changes: { title?: string; status?: WorkItemStatus; spark?: string } = {}
			if (typeof args.title === 'string') changes.title = args.title
			if (typeof args.spark === 'string' && SPARKS.some((s) => s.id === args.spark))
				changes.spark = args.spark
			// `status` wins; `done` stays as the shorthand the model reaches for.
			if (typeof args.status === 'string' && args.status in STATUS_WIRE)
				changes.status = STATUS_WIRE[args.status]
			else if (typeof args.done === 'boolean') changes.status = args.done ? 'done' : 'open'

			const unknown = ids.filter((id) => !store.byId(id))
			const updated = ids.map((id) => store.update(id, changes)).filter((t) => t !== undefined)
			return JSON.stringify({ ok: updated.length > 0, updated, unbekannteIds: unknown })
		}

		case 'workitem_delete': {
			const ids = idList(args.ids)
			if (ids.length === 0) return missingIds(store)

			// Resolved before removing, so the reply can name what actually went.
			const targets = ids.map((id) => store.byId(id)).filter((t) => t !== undefined)
			const unknown = ids.filter((id) => !targets.some((t) => t.id === id))
			const deleted = targets.map((t) => store.remove(t.id)).filter((t) => t !== undefined)
			return JSON.stringify({ ok: deleted.length > 0, deleted, unbekannteIds: unknown })
		}

		case 'workitem_show': {
			if (args.view === 'liste' || args.view === 'board')
				store.view = args.view === 'board' ? 'board' : 'list'
			if (typeof args.spark === 'string' && SPARKS.some((s) => s.id === args.spark))
				store.active = args.spark
			return JSON.stringify({ ok: true, view: store.view, spark: store.active })
		}

		case 'workitem_clear_done':
			return JSON.stringify({ ok: true, deleted: store.clearDone() })

		default:
			return JSON.stringify({ ok: false, error: `unbekanntes Werkzeug ${name}` })
	}
}
