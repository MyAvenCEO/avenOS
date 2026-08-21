import { api, readJson, requireUser } from '$lib/server/api.js'

// Up- or downgrade — the target tier is the only client input; the
// subscription acted on is always the session's own row.
export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const body = (await readJson(event)) as { tier?: string }
	await rt.subscriptions.change(user.id, String(body.tier ?? ''))
	return { body: { pending: true } }
})
