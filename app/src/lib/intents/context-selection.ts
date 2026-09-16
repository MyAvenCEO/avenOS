/** Keep the prompt's intent index small without limiting the workspace or lookup tools. */
export const DEFAULT_INTENT_CONTEXT_LIMIT = 8
export const INTENT_LOOKUP_LIMIT = 20

export interface IntentIndexEntry {
	id: string
	title: string
	type: string
	status: string
	source: string
	routingSummary?: string
}

/** Most recently opened first; new intents fill any unused slots in workspace order. */
export function selectContextIntents<T extends IntentIndexEntry>(
	items: T[],
	selectedId: string,
	recentIds: string[],
	limit = DEFAULT_INTENT_CONTEXT_LIMIT,
	index?: ReadonlyMap<string, T>
): T[] {
	const size = Number.isFinite(limit)
		? Math.max(0, Math.floor(limit))
		: DEFAULT_INTENT_CONTEXT_LIMIT
	if (!size) return []
	const byId = index ?? new Map(items.map((item) => [item.id, item]))
	const picked: T[] = [],
		seen = new Set<string>()
	const pick = (item: T | undefined) => {
		if (!item || item.status === 'archive' || seen.has(item.id)) return
		picked.push(item)
		seen.add(item.id)
	}
	for (const id of [selectedId, ...recentIds]) {
		pick(byId.get(id))
		if (picked.length === size) return picked
	}
	for (const item of items) {
		pick(item)
		if (picked.length === size) break
	}
	return picked
}

/** Search every intent, including archived ones, and return one bounded page. */
export function lookupIntents<T extends IntentIndexEntry>(
	items: T[],
	query: string,
	offset: number,
	limit: number,
	conversationMatches?: (id: string, query: string) => boolean
): { rows: T[]; total: number; offset: number; hasMore: boolean } {
	const needle = query.trim().toLocaleLowerCase()
	const matches = needle
		? items.filter(
				(item) =>
					[
						item.id,
						item.title,
						item.type,
						item.status,
						item.source,
						item.routingSummary ?? ''
					].some((value) => value.toLocaleLowerCase().includes(needle)) ||
					conversationMatches?.(item.id, query)
			)
		: items
	const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
	const size = Number.isFinite(limit)
		? Math.max(1, Math.min(INTENT_LOOKUP_LIMIT, Math.floor(limit)))
		: INTENT_LOOKUP_LIMIT
	return {
		rows: matches.slice(start, start + size),
		total: matches.length,
		offset: start,
		hasMore: start + size < matches.length
	}
}
