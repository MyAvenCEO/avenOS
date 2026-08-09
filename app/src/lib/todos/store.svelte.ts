/**
 * The todo list, and the single source of truth for it.
 *
 * Voice and mouse go through the same four operations, which is the point: a
 * todo added by speaking is indistinguishable from one typed in, because there
 * is only one place where todos exist. The model does not keep its own copy —
 * it calls these, and reads the list back the same way the UI renders it.
 *
 * In memory only. Reloading loses everything; persistence is a separate problem
 * and pretending otherwise here would just make it harder to add later.
 */

export interface Todo {
	id: string
	title: string
	done: boolean
}

let nextId = 0

export class Todos {
	items = $state<Todo[]>([])

	get open(): Todo[] {
		return this.items.filter((t) => !t.done)
	}

	create(title: string): Todo {
		const todo: Todo = { id: `t${nextId++}`, title: title.trim(), done: false }
		this.items.push(todo)
		// Return the item as stored, not the literal: `items` is a `$state` proxy
		// and only writes through the proxy are tracked.
		return this.items[this.items.length - 1]
	}

	/**
	 * Find by id, or failing that by what someone would actually say.
	 *
	 * The model is told the ids, but a person says "streich Milch kaufen" and the
	 * model passes that through more often than not — so matching falls back to
	 * the title, case-insensitively, then to a substring either way round
	 * ("Milch" should find "Milch kaufen").
	 */
	find(idOrTitle: string): Todo | undefined {
		const needle = idOrTitle.trim().toLowerCase()
		return (
			this.items.find((t) => t.id === idOrTitle) ??
			this.items.find((t) => t.title.toLowerCase() === needle) ??
			this.items.find(
				(t) => t.title.toLowerCase().includes(needle) || needle.includes(t.title.toLowerCase())
			)
		)
	}

	update(idOrTitle: string, changes: { title?: string; done?: boolean }): Todo | undefined {
		const todo = this.find(idOrTitle)
		if (!todo) return undefined
		if (changes.title !== undefined) todo.title = changes.title.trim()
		if (changes.done !== undefined) todo.done = changes.done
		return todo
	}

	remove(idOrTitle: string): Todo | undefined {
		const todo = this.find(idOrTitle)
		if (!todo) return undefined
		this.items = this.items.filter((t) => t.id !== todo.id)
		return todo
	}

	toggle(idOrTitle: string): Todo | undefined {
		const todo = this.find(idOrTitle)
		if (!todo) return undefined
		todo.done = !todo.done
		return todo
	}

	clearDone(): number {
		const before = this.items.length
		this.items = this.items.filter((t) => !t.done)
		return before - this.items.length
	}
}
