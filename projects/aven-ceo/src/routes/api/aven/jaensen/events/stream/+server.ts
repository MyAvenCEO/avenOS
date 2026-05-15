import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { resolveJaensenWebApiBaseUrl } from '../../_shared'

export const GET: RequestHandler = async ({ request, url, fetch }) => {
	const target = new URL('/api/events/stream', resolveJaensenWebApiBaseUrl())
	for (const key of ['after', 'visibility', 'runId', 'intentId', 'actorId', 'callId'] as const) {
		const value = url.searchParams.get(key)
		if (value) target.searchParams.set(key, value)
	}
	if (!['runId', 'intentId', 'actorId', 'callId', 'visibility'].some((key) => url.searchParams.get(key))) {
		throw error(400, 'Missing event stream filters')
	}

	const response = await fetch(target, {
		headers: {
			accept: 'text/event-stream',
			'last-event-id': request.headers.get('last-event-id') ?? ''
		}
	})

	return new Response(response.body, {
		status: response.status,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
			'cache-control': response.headers.get('cache-control') ?? 'no-cache, no-transform',
			connection: response.headers.get('connection') ?? 'keep-alive'
		}
	})
}