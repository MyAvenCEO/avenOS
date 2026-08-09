/**
 * The todo list, and the single source of truth for it.
 *
 * Voice and mouse go through the same operations, which is the point: a todo
 * added by speaking is indistinguishable from one typed in, because there is
 * only one place where store exist.
 *
 * In memory only. Reloading loses everything; persistence is a separate problem
 * and pretending otherwise here would just make it harder to add later.
 */

/**
 * Three states rather than a done-flag: a kanban needs a middle, and "I am on
 * it" is real information a checkbox cannot hold.
 */
export type WorkItemStatus = 'open' | 'doing' | 'done'

/**
 * A spark is the project context a todo lives in — every todo belongs to
 * exactly one. Two fixed examples for now ("me" for your own things, "team"
 * for shared ones); dynamic sparks are the obvious next step, which is why
 * they are data rather than a union type.
 */
export interface Spark {
	id: string
	name: string
	/** The spark's dot color, used wherever a todo is labeled with its spark. */
	color: string
}

export const SPARKS: Spark[] = [
	{ id: 'me', name: 'Me', color: '#d4a373' },
	{ id: 'team', name: 'Team', color: '#7e6ead' }
]

export interface WorkItem {
	id: string
	title: string
	status: WorkItemStatus
	/** The spark this todo belongs to. Exactly one, always. */
	spark: string
}

/**
 * Short, unique, and stable for the life of a todo.
 *
 * A slice of a UUID rather than the whole thing: the model has to copy these
 * back from a `workitem_list` result, and thirty-six characters of hex is a lot of
 * surface to copy wrongly for no benefit on a list this size. Counters like
 * `t0` were worse — they are guessable, and a model that guesses an id edits
 * the wrong todo with complete confidence.
 */
const id = () => crypto.randomUUID().slice(0, 8)

export class WorkItems {
	items = $state<WorkItem[]>([])
	/** The spark the view shows and new store land in. */
	active = $state<string>('me')
	/**
	 * Which shape the workspace renders, list or board. Lives here rather than
	 * in the component because switching is a tool call — "zeig mir das Board"
	 * — never a button.
	 */
	view = $state<'list' | 'board'>('list')

	/** The active spark's store — what the view actually renders. */
	get visible(): WorkItem[] {
		return this.items.filter((t) => t.spark === this.active)
	}

	get open(): WorkItem[] {
		return this.visible.filter((t) => t.status !== 'done')
	}

	byId(id: string): WorkItem | undefined {
		return this.items.find((t) => t.id === id)
	}

	create(title: string, spark: string = this.active): WorkItem {
		this.items.push({ id: id(), title: title.trim(), status: 'open', spark })
		// Return the item as stored, not the literal: `items` is a `$state` proxy
		// and only writes through the proxy are tracked.
		return this.items[this.items.length - 1]
	}

	update(
		id: string,
		changes: { title?: string; status?: WorkItemStatus; spark?: string }
	): WorkItem | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		if (changes.title !== undefined) todo.title = changes.title.trim()
		if (changes.status !== undefined) todo.status = changes.status
		if (changes.spark !== undefined) todo.spark = changes.spark
		return todo
	}

	remove(id: string): WorkItem | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		this.items = this.items.filter((t) => t.id !== id)
		return todo
	}

	/** The checkbox gesture: anything not done becomes done, done reopens. */
	toggle(id: string): WorkItem | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		todo.status = todo.status === 'done' ? 'open' : 'done'
		return todo
	}

	/** The badge gesture: one step around open → doing → done → open. */
	cycle(id: string): WorkItem | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		todo.status = todo.status === 'open' ? 'doing' : todo.status === 'doing' ? 'done' : 'open'
		return todo
	}

	/** Scoped to the active spark — "räum die Liste auf" means the visible one. */
	clearDone(): WorkItem[] {
		const removed = this.visible.filter((t) => t.status === 'done')
		this.items = this.items.filter((t) => t.spark !== this.active || t.status !== 'done')
		return removed
	}
}
