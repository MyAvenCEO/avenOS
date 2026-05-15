import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { proxyJson } from '../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const query = new URLSearchParams()
	for (const key of ['after', 'limit', 'visibility', 'runId', 'intentId', 'actorId', 'callId'] as const) {
		const value = url.searchParams.get(key)
		if (value) query.set(key, value)
	}
	if (![...query.keys()].some((key) => key !== 'after' && key !== 'limit' && key !== 'visibility')) {
		throw error(400, 'Missing event filters')
	}
	return proxyJson(`/api/events?${query.toString()}`)
}