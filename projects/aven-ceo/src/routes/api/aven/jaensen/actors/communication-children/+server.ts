import type { RequestHandler } from './$types'
import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const query = new URLSearchParams()
	const actorId = url.searchParams.get('actorId')
	if (actorId) query.set('actorId', actorId)
	const suffix = query.size > 0 ? `?${query.toString()}` : ''
	return proxyJson(`/api/actors/communication-children${suffix}`)
}