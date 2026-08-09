import type { Activity, ActivityKind } from '../activity.svelte'

interface WorkItem {
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
		Array.isArray(result[key])
			? (result[key] as WorkItem[]).map((t) => t?.title).filter(Boolean)
			: []

	if (result.ok === false) {
		return {
			kind: 'failed',
			titles: [],
			note: typeof result.error === 'string' ? result.error : name
		}
	}

	switch (name) {
		case 'workitem_create':
			return { kind: 'created', titles: titles('created') }

		case 'workitem_update': {
			const changed = titles('updated')
			if (changed.length === 0) return null
			// The same tool does several different things; which one matters more
			// to a reader than the fact that an update occurred. The kind follows
			// the resulting status — a title-only edit keeps its old status, which
			// is why "renamed" is the fallback rather than a case.
			const first = (result.updated as { status?: string; title?: string }[])[0]
			const kind: ActivityKind =
				first?.status === 'done'
					? 'done'
					: first?.status === 'doing'
						? 'doing'
						: first?.status === 'open'
							? 'reopened'
							: 'renamed'
			return { kind, titles: changed }
		}

		case 'workitem_delete':
		case 'workitem_clear_done':
			return { kind: 'deleted', titles: titles('deleted') }

		case 'workitem_show': {
			const view = result.view === 'board' ? 'Board' : 'Liste'
			const spark = result.spark === 'team' ? 'Team' : 'Me'
			return { kind: 'switched', titles: [], note: `${view} · ${spark}` }
		}

		case 'workitem_list':
			return {
				kind: 'read',
				titles: [],
				note: `${(result.store as unknown[])?.length ?? 0} Aufgaben gelesen`
			}

		default:
			return null
	}
}
