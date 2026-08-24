import { z } from 'zod'
import { api, readJson, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'
import { siteBindingInputSchema } from '$lib/server/sites/validation.js'
import { namePattern, normalizeName } from '$lib/validation.js'

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { sites: await rt.sites.listForUser(user.id) } }
})

export const PUT = api(async (event, rt) => {
	const user = await requireUser(event)
	const input = siteBindingInputSchema.parse(await readJson(event))
	return { body: await rt.sites.configure(user.id, input), status: 201 }
})

export const DELETE = api(async (event, rt) => {
	const user = await requireUser(event)
	const input = z
		.object({
			name: z
				.string()
				.transform(normalizeName)
				.refine((name) => namePattern.test(name))
		})
		.parse(await readJson(event))
	if (!(await rt.sites.remove(user.id, input.name)))
		throw new AppError(404, 'SITE_NOT_FOUND', 'No site is configured for that name.')
	return { body: { removed: true } }
})
