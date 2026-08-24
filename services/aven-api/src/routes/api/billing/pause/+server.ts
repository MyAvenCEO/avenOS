import { api, readJson, requireUser } from '$lib/server/api.js'

// Pause stops billing at period end without ending the subscription.
export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const body = (await readJson(event)) as { tier?: string }
	await rt.subscriptions.pause(user.id, String(body.tier ?? ''))
	return { body: { pending: true } }
})
