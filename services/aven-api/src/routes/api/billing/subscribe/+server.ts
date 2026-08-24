import { api, readJson, requireUser } from '$lib/server/api.js'

// Booking a tier. Tiers are independent products — the only conflict is an
// active subscription of the SAME tier. The optional embedOrigin is the
// origin of the page that will iframe the checkout; Polar validates it
// against the org's embed-host allowlist, so it authorizes nothing here.
export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const body = (await readJson(event)) as { tier?: string; embedOrigin?: string }
	const embedOrigin = typeof body.embedOrigin === 'string' ? body.embedOrigin : null
	const result = await rt.subscriptions.subscribe(user, String(body.tier ?? ''), embedOrigin)
	return { body: result }
})
