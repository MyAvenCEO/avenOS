import { api, requireUser } from '$lib/server/api.js'

// Invoice history, linked not rendered — each row carries the provider's
// hosted receipt URL.
export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { invoices: await rt.subscriptions.invoices(user) } }
})
