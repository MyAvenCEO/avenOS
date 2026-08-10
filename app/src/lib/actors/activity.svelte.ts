/**
 * What the actors actually did, in words, as they do it — the vocabulary is
 * generic; turning a specific record into an entry is each actor's own
 * summarize.
 */

export type ActivityKind =
	| 'created'
	| 'done'
	| 'doing'
	| 'reopened'
	| 'renamed'
	| 'deleted'
	| 'read'
	| 'switched'
	| 'asked'
	| 'failed'

export interface Activity {
	id: number
	kind: ActivityKind
	titles: string[]
	note?: string
}

export const ACTIVITY_LABELS: Record<ActivityKind, { mark: string; label: string }> = {
	created: { mark: '+', label: 'created' },
	done: { mark: '✓', label: 'done' },
	doing: { mark: '◐', label: 'in progress' },
	reopened: { mark: '○', label: 'reopened' },
	renamed: { mark: '✎', label: 'renamed' },
	deleted: { mark: '×', label: 'deleted' },
	read: { mark: '↻', label: 'list read' },
	switched: { mark: '⇄', label: 'view' },
	asked: { mark: '?', label: 'asked' },
	failed: { mark: '!', label: 'failed' }
}

/** How long one result stays on screen. */
const LINGER = 3000

let nextId = 0

export class ToolActivity {
	/** The one toast on screen; the newest replaces whatever is there. */
	current = $state<Activity | null>(null)

	#timer: ReturnType<typeof setTimeout> | null = null

	clear(): void {
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = null
		this.current = null
	}

	/** Show one summarized entry as the current toast. Null is a quiet no-op. */
	show(entry: Omit<Activity, 'id'> | null): void {
		if (!entry) return
		if (entry.titles.length === 0 && !entry.note && entry.kind !== 'failed') return
		if (this.#timer) clearTimeout(this.#timer)
		this.current = { ...entry, id: nextId++ }
		const shown = this.current.id
		this.#timer = setTimeout(() => {
			if (this.current?.id === shown) this.current = null
		}, LINGER)
	}
}

/** The one toast — page renders it, actors feed it. */
export const activity = new ToolActivity()
