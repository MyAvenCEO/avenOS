import { api, readJson, requireUser } from '$lib/server/api.js'

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const body = (await readJson(event)) as { tier?: string }
	const result = await rt.subscriptions.subscribe(user, String(body.tier ?? ''))
	return { body: result }
})
