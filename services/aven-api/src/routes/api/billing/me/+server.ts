import { api, requireUser } from '$lib/server/api.js'

// The caller's own standing — the session is the only selector, by design.
export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { subscription: await rt.subscriptions.me(user.id) } }
})
