import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

const id = z.uuid()
const action = z.enum(['archive', 'restore', 'merge'])
const version = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
const merge = version.extend({ sourceIntentIds: z.array(z.uuid()).min(1).max(100) })

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.intents)
		throw new AppError(503, 'INTENTS_UNAVAILABLE', 'Intent persistence is not configured.')
	const intentId = id.parse(event.params.intentId)
	const command = action.parse(event.params.action)
	const body = (command === 'merge' ? merge : version).parse(await event.request.json())
	const target = await rt.environments.intentTargetForUser(user.id)
	return {
		body: await rt.intents.lifecycle(target.databaseName, target.scopeId, intentId, command, body)
	}
})
