import type { RequestHandler } from './$types'
import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const query = new URLSearchParams()
	const parentActorId = url.searchParams.get('parentActorId')
	if (parentActorId) query.set('parentActorId', parentActorId)
	const suffix = query.size > 0 ? `?${query.toString()}` : ''
	return proxyJson(`/api/actors/structural-children${suffix}`)
}