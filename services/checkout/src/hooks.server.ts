import { serverBuildRuntime } from 'virtual:aven-server-build-runtime'
import type { Handle } from '@sveltejs/kit'
import { isCheckoutPath } from '$lib/server/surface.js'

export const handle: Handle = async (event) => {
	if (!isCheckoutPath(event.event.url.pathname)) return new Response('Not found', { status: 404 })
	return serverBuildRuntime.handle(event)
}
