import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const rootActorId = url.searchParams.get('rootActorId')
	if (!rootActorId) {
		throw error(400, 'Missing rootActorId')
	}
	const query = new URLSearchParams({ rootActorId })
	const view = url.searchParams.get('view')
	const after = url.searchParams.get('after')
	const limit = url.searchParams.get('limit')
	if (view) query.set('view', view)
	if (after) query.set('after', after)
	if (limit) query.set('limit', limit)
	return proxyJson(`/api/actors/branch-logs?${query.toString()}`)
}