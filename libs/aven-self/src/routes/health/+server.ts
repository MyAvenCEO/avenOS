import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => {
	return new Response(JSON.stringify({ ok: true, service: 'aven-self' }), {
		headers: { 'content-type': 'application/json' },
	})
}
