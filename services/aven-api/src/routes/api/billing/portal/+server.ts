import { api, requireUser } from '$lib/server/api.js'

// The provider-hosted portal for the caller's own customer record — the one
// place the official invoice documents exist (Creem is merchant of record;
// its API exposes no per-transaction receipt URL and no address/tax-id
// fields we could collect ourselves).
export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { url: await rt.subscriptions.portalUrl(user) } }
})
