import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.artifactProcessing)
		throw new AppError(503, 'INTENTS_UNAVAILABLE', 'Intent persistence is not configured.')
	const target = await rt.environments.artifactTargetForUser(user.id)
	return { body: await rt.artifactProcessing.intents(target.databaseName, target.scopeId) }
})
