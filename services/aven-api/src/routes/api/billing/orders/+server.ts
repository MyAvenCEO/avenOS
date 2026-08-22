import { api, requireUser } from '$lib/server/api.js'

// Meine Bestellungen — the caller's own orders, customer resolved from the
// session. The official invoice per order is the one Creem mails; the API
// carries no document, so there is nothing to link.
export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { orders: await rt.subscriptions.orders(user) } }
})
