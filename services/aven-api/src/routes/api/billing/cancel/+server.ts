import { api, readJson, requireUser } from '$lib/server/api.js'

// Kündigungsbutton semantics: default is end-of-period, as easy as booking.
export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const body = (await readJson(event)) as { immediate?: boolean }
	await rt.subscriptions.cancel(user.id, body.immediate === true)
	return { body: { pending: true } }
})
