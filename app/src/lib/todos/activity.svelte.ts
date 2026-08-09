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

/** Enough to see the last exchange without the panel becoming a log. */
const KEEP = 4

interface Todo {
	title: string
}

let nextId = 0

export class ToolActivity {
	entries = $state<Activity[]>([])

	clear(): void {
		this.entries = []
	}

	/**
	 * Read one tool result and add a line for it.
	 *
	 * Parsing the result rather than trusting the call means a request to delete
	 * three items that only matched one shows as one deletion.
	 */
	record(name: string, resultJson: string): void {
		let result: Record<string, unknown>
		try {
			result = JSON.parse(resultJson)
		} catch {
			return
		}

		const titles = (key: string): string[] =>
			Array.isArray(result[key]) ? (result[key] as Todo[]).map((t) => t?.title).filter(Boolean) : []

		if (result.ok === false) {
			this.#push({
				kind: 'failed',
				titles: [],
				note: typeof result.error === 'string' ? result.error : name
			})
			return
		}

		switch (name) {
			case 'todo_create':
				this.#push({ kind: 'created', titles: titles('created') })
				break

			case 'todo_update': {
				const changed = titles('updated')
				if (changed.length === 0) break
				// The same tool does three different things; which one matters more
				// to a reader than the fact that an update occurred.
				const first = (result.updated as { done?: boolean; title?: string }[])[0]
				const kind: ActivityKind =
					first?.done === true ? 'done' : first?.done === false ? 'reopened' : 'renamed'
				this.#push({ kind, titles: changed })
				break
			}

			case 'todo_delete':
			case 'todo_clear_done':
				this.#push({ kind: 'deleted', titles: titles('deleted') })
				break

			case 'todo_list':
				this.#push({
					kind: 'read',
					titles: [],
					note: `${(result.todos as unknown[])?.length ?? 0} Aufgaben gelesen`
				})
				break
		}
	}

	#push(entry: Omit<Activity, 'id'>): void {
		// A no-op read is worth showing; a no-op edit is noise.
		if (entry.titles.length === 0 && entry.kind !== 'read' && entry.kind !== 'failed') return
		this.entries.push({ ...entry, id: nextId++ })
		if (this.entries.length > KEEP) this.entries = this.entries.slice(-KEEP)
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
