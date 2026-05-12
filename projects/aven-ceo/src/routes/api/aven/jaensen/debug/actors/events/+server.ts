import type { RequestHandler } from './$types'
import { proxyEventStream } from '../../../_shared'

export const GET: RequestHandler = async ({ request, url }) => {
	const target = new URL('/debug/actors/events', 'http://proxy.invalid')
	const after = url.searchParams.get('after')
	if (after) target.searchParams.set('after', after)
	return proxyEventStream(`${target.pathname}${target.search}`, {
		headers: {
			accept: 'text/event-stream',
			'last-event-id': request.headers.get('last-event-id') ?? ''
		}
	})
}