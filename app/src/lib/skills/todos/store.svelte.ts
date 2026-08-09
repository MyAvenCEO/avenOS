/**
 * The todo list, and the single source of truth for it.
 *
 * Voice and mouse go through the same operations, which is the point: a todo
 * added by speaking is indistinguishable from one typed in, because there is
 * only one place where todos exist.
 *
 * In memory only. Reloading loses everything; persistence is a separate problem
 * and pretending otherwise here would just make it harder to add later.
 */

/**
 * Three states rather than a done-flag: a kanban needs a middle, and "I am on
 * it" is real information a checkbox cannot hold.
 */
export type TodoStatus = 'open' | 'doing' | 'done'

/**
 * A spark is the project context a todo lives in — every todo belongs to
 * exactly one. Two fixed examples for now ("me" for your own things, "team"
 * for shared ones); dynamic sparks are the obvious next step, which is why
 * they are data rather than a union type.
 */
export interface Spark {
	id: string
	name: string
}

export const SPARKS: Spark[] = [
	{ id: 'me', name: 'Me' },
	{ id: 'team', name: 'Team' }
]

export interface Todo {
	id: string
	title: string
	status: TodoStatus
	/** The spark this todo belongs to. Exactly one, always. */
	spark: string
}

/**
 * Short, unique, and stable for the life of a todo.
 *
 * A slice of a UUID rather than the whole thing: the model has to copy these
 * back from a `todo_list` result, and thirty-six characters of hex is a lot of
 * surface to copy wrongly for no benefit on a list this size. Counters like
 * `t0` were worse — they are guessable, and a model that guesses an id edits
 * the wrong todo with complete confidence.
 */
const id = () => crypto.randomUUID().slice(0, 8)

export class Todos {
	items = $state<Todo[]>([])
	/** The spark the view shows and new todos land in. */
	active = $state<string>('me')

	/** The active spark's todos — what the view actually renders. */
	get visible(): Todo[] {
		return this.items.filter((t) => t.spark === this.active)
	}

	get open(): Todo[] {
		return this.visible.filter((t) => t.status !== 'done')
	}

	byId(id: string): Todo | undefined {
		return this.items.find((t) => t.id === id)
	}

	create(title: string, spark: string = this.active): Todo {
		this.items.push({ id: id(), title: title.trim(), status: 'open', spark })
		// Return the item as stored, not the literal: `items` is a `$state` proxy
		// and only writes through the proxy are tracked.
		return this.items[this.items.length - 1]
	}

	update(
		id: string,
		changes: { title?: string; status?: TodoStatus; spark?: string }
	): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		if (changes.title !== undefined) todo.title = changes.title.trim()
		if (changes.status !== undefined) todo.status = changes.status
		if (changes.spark !== undefined) todo.spark = changes.spark
		return todo
	}

	remove(id: string): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		this.items = this.items.filter((t) => t.id !== id)
		return todo
	}

	/** The checkbox gesture: anything not done becomes done, done reopens. */
	toggle(id: string): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		todo.status = todo.status === 'done' ? 'open' : 'done'
		return todo
	}

	/** The badge gesture: one step around open → doing → done → open. */
	cycle(id: string): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		todo.status = todo.status === 'open' ? 'doing' : todo.status === 'doing' ? 'done' : 'open'
		return todo
	}

	/** Scoped to the active spark — "räum die Liste auf" means the visible one. */
	clearDone(): Todo[] {
		const removed = this.visible.filter((t) => t.status === 'done')
		this.items = this.items.filter((t) => t.spark !== this.active || t.status !== 'done')
		return removed
	}
}
