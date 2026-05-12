import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { proxyJson } from '../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const scope = url.searchParams.get('scope')
	if (!scope) {
		throw error(400, 'Missing scope')
	}
	const after = url.searchParams.get('after')
	const query = new URLSearchParams({ scope })
	if (after) query.set('after', after)
	return proxyJson(`/api/events?${query.toString()}`)
}