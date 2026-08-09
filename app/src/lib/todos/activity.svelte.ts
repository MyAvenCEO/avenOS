/**
 * What the tools actually did, in words, as they do it.
 *
 * The transcript already showed which tools ran — `TODO_UPDATE · TODO_UPDATE` —
 * which says an edit happened but not what it touched. That is the gap where
 * the interesting failures lived: five things ticked off when two were named, a
 * deletion where an item should only have been checked, a confirmation for work
 * that never happened at all. Every one of those looked identical from the
 * outside.
 *
 * So each call is summarized from its *result* rather than its arguments —
 * which is the difference between what the model asked for and what the list
 * actually did.
 */

export type ActivityKind =
	| 'created'
	| 'done'
	| 'reopened'
	| 'renamed'
	| 'deleted'
	| 'read'
	| 'failed'

export interface Activity {
	id: number
	kind: ActivityKind
	/** The todos involved, by title. Empty for a plain read. */
	titles: string[]
	/** Only set for `read` and `failed`, where a count or a reason is the point. */
	note?: string
}

/** How long one result stays on screen. */
const LINGER = 3000

interface Todo {
	title: string
}

let nextId = 0

/**
 * Read one tool result into a displayable entry, or nothing for a no-op.
 *
 * Parsing the result rather than trusting the call means a request to delete
 * three items that only matched one shows as one deletion. Shared between the
 * toast and the transcript, so the fleeting and the permanent record of a call
 * can never disagree.
 */
export function summarize(name: string, resultJson: string): Omit<Activity, 'id'> | null {
	let result: Record<string, unknown>
	try {
		result = JSON.parse(resultJson)
	} catch {
		return null
	}

	const titles = (key: string): string[] =>
		Array.isArray(result[key]) ? (result[key] as Todo[]).map((t) => t?.title).filter(Boolean) : []

	if (result.ok === false) {
		return {
			kind: 'failed',
			titles: [],
			note: typeof result.error === 'string' ? result.error : name
		}
	}

	switch (name) {
		case 'todo_create':
			return { kind: 'created', titles: titles('created') }

		case 'todo_update': {
			const changed = titles('updated')
			if (changed.length === 0) return null
			// The same tool does three different things; which one matters more
			// to a reader than the fact that an update occurred.
			const first = (result.updated as { done?: boolean; title?: string }[])[0]
			const kind: ActivityKind =
				first?.done === true ? 'done' : first?.done === false ? 'reopened' : 'renamed'
			return { kind, titles: changed }
		}

		case 'todo_delete':
		case 'todo_clear_done':
			return { kind: 'deleted', titles: titles('deleted') }

		case 'todo_list':
			return {
				kind: 'read',
				titles: [],
				note: `${(result.todos as unknown[])?.length ?? 0} Aufgaben gelesen`
			}

		default:
			return null
	}
}

export class ToolActivity {
	/**
	 * The one result currently being shown, if any.
	 *
	 * A toast rather than a list. Several calls can land in a single turn, and a
	 * growing stack of them pushed the input panel down the screen and turned a
	 * glanceable "did that work?" into something to read. The newest replaces
	 * whatever is there; each stands for three seconds and then goes.
	 */
	current = $state<Activity | null>(null)

	#timer: ReturnType<typeof setTimeout> | null = null

	clear(): void {
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = null
		this.current = null
	}

	/** Show one tool result as the current toast. */
	record(name: string, resultJson: string): void {
		const entry = summarize(name, resultJson)
		if (entry) this.#push(entry)
	}

	#push(entry: Omit<Activity, 'id'>): void {
		if (this.#timer) clearTimeout(this.#timer)
		this.current = { ...entry, id: nextId++ }
		// Captured, so a toast replaced before its time is up cannot have the
		// newer one dismissed by the older one's timer.
		const shown = this.current.id
		this.#timer = setTimeout(() => {
			if (this.current?.id === shown) this.current = null
		}, LINGER)
	}
}

/** Symbol and wording per kind, so the card reads at a glance. */
export const ACTIVITY_LABELS: Record<ActivityKind, { mark: string; label: string }> = {
	created: { mark: '+', label: 'angelegt' },
	done: { mark: '✓', label: 'abgehakt' },
	reopened: { mark: '○', label: 'wieder offen' },
	renamed: { mark: '✎', label: 'umbenannt' },
	deleted: { mark: '×', label: 'gelöscht' },
	read: { mark: '↻', label: 'Liste gelesen' },
	failed: { mark: '!', label: 'fehlgeschlagen' }
}
