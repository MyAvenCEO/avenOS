import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'
import type { Runtime } from '$lib/server/runtime.js'

const intentIdSchema = z.uuid()
const contributionSchema = z.object({
	id: z.uuid(),
	contributorKind: z.enum(['human', 'agent']),
	kind: z.string().min(1).max(64),
	text: z.string().max(100_000).nullable(),
	payload: z.record(z.string(), z.unknown()).default({})
})

async function target(event: Parameters<typeof requireUser>[0], rt: Runtime) {
	const user = await requireUser(event)
	if (!rt.artifactProcessing)
		throw new AppError(503, 'INTENTS_UNAVAILABLE', 'Intent persistence is not configured.')
	return {
		service: rt.artifactProcessing,
		target: await rt.environments.artifactTargetForUser(user.id)
	}
}

export const GET = api(async (event, rt) => {
	const resolved = await target(event, rt)
	const intentId = intentIdSchema.parse(event.params.intentId)
	return {
		body: await resolved.service.intent(
			resolved.target.databaseName,
			resolved.target.scopeId,
			intentId
		)
	}
})

export const POST = api(async (event, rt) => {
	const resolved = await target(event, rt)
	const intentId = intentIdSchema.parse(event.params.intentId)
	const contribution = contributionSchema.parse(await event.request.json())
	return {
		body: await resolved.service.appendContribution(
			resolved.target.databaseName,
			resolved.target.scopeId,
			intentId,
			contribution
		),
		status: 201
	}
})
