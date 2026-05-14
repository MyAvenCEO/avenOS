import type { RequestHandler } from './$types'

import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.toString()
	return proxyJson(`/api/context/items${query ? `?${query}` : ''}`)
}