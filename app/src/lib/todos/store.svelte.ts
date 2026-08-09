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

export interface Todo {
	id: string
	title: string
	done: boolean
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

	get open(): Todo[] {
		return this.items.filter((t) => !t.done)
	}

	byId(id: string): Todo | undefined {
		return this.items.find((t) => t.id === id)
	}

	create(title: string): Todo {
		this.items.push({ id: id(), title: title.trim(), done: false })
		// Return the item as stored, not the literal: `items` is a `$state` proxy
		// and only writes through the proxy are tracked.
		return this.items[this.items.length - 1]
	}

	update(id: string, changes: { title?: string; done?: boolean }): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		if (changes.title !== undefined) todo.title = changes.title.trim()
		if (changes.done !== undefined) todo.done = changes.done
		return todo
	}

	remove(id: string): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		this.items = this.items.filter((t) => t.id !== id)
		return todo
	}

	toggle(id: string): Todo | undefined {
		const todo = this.byId(id)
		if (!todo) return undefined
		todo.done = !todo.done
		return todo
	}

	clearDone(): Todo[] {
		const removed = this.items.filter((t) => t.done)
		this.items = this.items.filter((t) => !t.done)
		return removed
	}
}
