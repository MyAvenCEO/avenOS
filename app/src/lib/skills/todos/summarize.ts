import type { Activity, ActivityKind } from '../activity.svelte'

interface Todo {
	title: string
}

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
