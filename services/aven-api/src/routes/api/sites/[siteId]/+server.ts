import { api, readJson, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'
import { requireSiteManagementPasskey } from '$lib/server/sites/authorization.js'
import { siteBindingInputSchema } from '$lib/server/sites/validation.js'

export const PUT = api(async (event, rt) => {
	const user = await requireUser(event)
	await requireSiteManagementPasskey(rt, user.id)
	const siteId = event.params.siteId
	if (!siteId) throw new AppError(404, 'SITE_NOT_FOUND', 'No site has that id.')
	const input = siteBindingInputSchema({ allowOperatorSubdomains: user.role === 'admin' }).parse(
		await readJson(event)
	)
	return { body: await rt.sites.update(user.id, siteId, input) }
})

export const DELETE = api(async (event, rt) => {
	const user = await requireUser(event)
	await requireSiteManagementPasskey(rt, user.id)
	const siteId = event.params.siteId
	if (!siteId || !(await rt.sites.remove(user.id, siteId)))
		throw new AppError(404, 'SITE_NOT_FOUND', 'No site has that id.')
	return { body: { removed: true } }
})
