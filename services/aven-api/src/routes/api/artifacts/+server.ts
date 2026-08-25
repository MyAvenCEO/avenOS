import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.artifacts) {
		throw new AppError(503, 'ARTIFACT_STORE_UNAVAILABLE', 'Artifact Store is not configured.')
	}
	const target = await rt.environments.artifactTargetForUser(user.id)
	return { body: await rt.artifacts.browse(target.databaseName, target.scopeId) }
})
