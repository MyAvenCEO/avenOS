import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const rootActorId = url.searchParams.get('rootActorId')
	if (!rootActorId) {
		throw error(400, 'Missing rootActorId')
	}
	const query = new URLSearchParams({ rootActorId })
	const observed = url.searchParams.get('observed')
	const includeRoot = url.searchParams.get('includeRoot')
	const parentActorId = url.searchParams.get('parentActorId')
	if (observed) query.set('observed', observed)
	if (includeRoot) query.set('includeRoot', includeRoot)
	if (parentActorId) query.set('parentActorId', parentActorId)
	return proxyJson(`/api/actors/hierarchy?${query.toString()}`)
}