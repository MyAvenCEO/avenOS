import { api, requireUser } from '$lib/server/api.js'

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	await rt.subscriptions.resume(user.id)
	return { body: { pending: true } }
})
