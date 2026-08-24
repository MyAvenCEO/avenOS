import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'
import type { Runtime } from '$lib/server/runtime.js'

const createSchema = z.object({
	id: z.uuid(),
	title: z.string().min(1).max(512),
	intentType: z.string().min(1).max(128).default('intent'),
	sourceLabel: z.string().min(1).max(256).default('Conversation'),
	deadline: z.string().min(1).max(128).nullable().default(null),
	routingSummary: z.string().min(1).max(1024).optional()
})

async function resolved(event: Parameters<typeof requireUser>[0], rt: Runtime) {
	const user = await requireUser(event)
	if (!rt.intents)
		throw new AppError(503, 'INTENTS_UNAVAILABLE', 'Intent persistence is not configured.')
	return { service: rt.intents, target: await rt.environments.intentTargetForUser(user.id) }
}

export const GET = api(async (event, rt) => {
	const value = await resolved(event, rt)
	return { body: await value.service.list(value.target.databaseName, value.target.scopeId) }
})

export const POST = api(async (event, rt) => {
	const value = await resolved(event, rt)
	return {
		body: await value.service.create(
			value.target.databaseName,
			value.target.scopeId,
			createSchema.parse(await event.request.json())
		),
		status: 201
	}
})
