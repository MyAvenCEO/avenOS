/**
 * What the tools actually did, in words, as they do it.
 *
 * Skill-agnostic on purpose: the vocabulary (created, done, deleted, …) and
 * the toast mechanics live here, while turning a specific tool's result into
 * an entry is each skill's own `summarize` — the skill knows what its results
 * mean, this file knows how to show them.
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

let nextId = 0

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

	/** Show one summarized entry as the current toast. Null is a quiet no-op. */
	show(entry: Omit<Activity, 'id'> | null): void {
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
	doing: { mark: '◐', label: 'in Arbeit' },
	reopened: { mark: '○', label: 'wieder offen' },
	renamed: { mark: '✎', label: 'umbenannt' },
	deleted: { mark: '×', label: 'gelöscht' },
	read: { mark: '↻', label: 'Liste gelesen' },
	switched: { mark: '⇄', label: 'Ansicht' },
	failed: { mark: '!', label: 'fehlgeschlagen' }
}
