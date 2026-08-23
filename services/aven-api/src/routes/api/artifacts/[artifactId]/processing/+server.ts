import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

const artifactIdSchema = z.uuid()

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.artifactProcessing) {
		throw new AppError(
			503,
			'ARTIFACT_PROCESSOR_UNAVAILABLE',
			'Artifact processing is not configured.'
		)
	}
	const target = await rt.environments.artifactTargetForUser(user.id)
	return {
		body: await rt.artifactProcessing.status(
			target.databaseName,
			target.scopeId,
			artifactIdSchema.parse(event.params.artifactId)
		)
	}
})
