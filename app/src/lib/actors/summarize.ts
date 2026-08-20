import type { Activity, ActivityKind } from './activity.svelte'

/**
 * Generic record → activity summary. The sandbox reducer authors a structured
 * `record` ({ ok, created, updated, deleted, items, spark, error }); this maps
 * that SHAPE to a one-line activity toast, keyed on the record — not on any
 * domain. It was `TodoActor.summarize`; lifted out and de-domained so ANY
 * config-built actor's calls summarize with zero per-actor code.
 */
export function summarizeRecord(method: string, recordJson: string): Omit<Activity, 'id'> | null {
	let record: Record<string, unknown>
	try {
		record = JSON.parse(recordJson)
	} catch {
		return null
	}
	const titles = (key: string): string[] =>
		Array.isArray(record[key])
			? (record[key] as { title?: string }[]).map((t) => t?.title).filter((t): t is string => !!t)
			: []

	if (record.ok === false) {
		return {
			kind: 'failed',
			titles: [],
			note: typeof record.error === 'string' ? record.error : method
		}
	}
	if (Array.isArray(record.created)) return { kind: 'created', titles: titles('created') }
	if (Array.isArray(record.updated)) {
		const changed = titles('updated')
		if (changed.length === 0) return null
		const first = (record.updated as { status?: string }[])[0]
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
	if (Array.isArray(record.deleted)) return { kind: 'deleted', titles: titles('deleted') }
	if (Array.isArray(record.items)) {
		return { kind: 'read', titles: [], note: `${(record.items as unknown[]).length} items` }
	}
	if (typeof record.spark === 'string') {
		return { kind: 'switched', titles: [], note: `spark ${record.spark}` }
	}
	return null
}
