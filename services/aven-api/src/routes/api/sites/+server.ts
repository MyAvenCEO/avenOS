import { api, readJson, requireUser } from '$lib/server/api.js'
import { requireSiteManagementPasskey } from '$lib/server/sites/authorization.js'
import { siteBindingInputSchema } from '$lib/server/sites/validation.js'

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { sites: await rt.sites.listForUser(user.id) } }
})

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	await requireSiteManagementPasskey(rt, user.id)
	const input = siteBindingInputSchema.parse(await readJson(event))
	return { body: await rt.sites.create(user.id, input), status: 201 }
})
