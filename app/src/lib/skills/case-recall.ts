import { bus } from '$lib/actors/bus'

export interface RecalledCase {
	id: string
	title: string
	source: string
	status: string
}
type RecallCall = (name: string, data: Record<string, unknown>) => Promise<{ record: string }>
const call: RecallCall = (name, data) => bus.dispatch('studio-case', name, data)

/** Adapter to shared indexed recall. Studio owns no index, cache, or history mutation.
 * Cursors stay opaque; native reads include stored work omitted from the recent context.
 */
export async function findPastCases(
	query: string,
	cursor: string | null = null,
	invoke: RecallCall = call
) {
	const result = JSON.parse(
		(await invoke('workspace_search', { kind: 'intent', query, ...(cursor ? { cursor } : {}) }))
			.record
	)
	if (result.ok === false) throw Error(result.error ?? 'Could not search past work.')
	const items: RecalledCase[] = (result.intents ?? []).map((item: Record<string, unknown>) => {
		if (typeof item.id !== 'string' || typeof item.title !== 'string')
			throw Error('Search returned an incomplete task. Try searching again.')
		return {
			id: item.id,
			title: item.title,
			// Native summaries and the in-memory preview have different metadata projections.
			source: String(item.sourceLabel ?? item.source ?? 'Past work'),
			status: String(item.state ?? item.status ?? 'Available')
		}
	})
	return {
		items,
		hasMore: !!result.hasMore,
		nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null,
		coverage: 'shared-recall' as const
	}
}
export async function readPastCase(id: string, invoke: RecallCall = call) {
	const result = JSON.parse((await invoke('workspace_read', { kind: 'intent', id })).record)
	if (result.ok === false || result.id !== id)
		throw Error('This case could not be read. Search again or describe what you remember.')
	return result as {
		id: string
		title: string
		source: string
		conversation: Array<{ content: string; role: string }>
		activity: string[]
		artifacts: string[]
		olderMessagesAvailable?: boolean
	}
}
