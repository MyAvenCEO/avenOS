import type { RequestHandler } from './$types'
import { proxyJson } from '../../../_shared'

export const GET: RequestHandler = async ({ params, url }) => {
	const query = url.searchParams.toString()
	return proxyJson(`/api/intents/${encodeURIComponent(params.intentId)}/envelopes${query ? `?${query}` : ''}`)
}