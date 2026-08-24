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
const versionSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
const updateSchema = z.object({
	expectedVersion: z.number().int().positive(),
	title: z.string().min(1).max(512).optional(),
	intentType: z.string().min(1).max(128).optional(),
	sourceLabel: z.string().min(1).max(256).optional(),
	deadline: z.string().min(1).max(128).optional(),
	clearDeadline: z.boolean().default(false),
	routingSummary: z.string().min(1).max(1024).optional(),
	state: z.enum(['working', 'waiting', 'done', 'error']).optional()
})

async function target(event: Parameters<typeof requireUser>[0], rt: Runtime) {
	const user = await requireUser(event)
	if (!rt.intents)
		throw new AppError(503, 'INTENTS_UNAVAILABLE', 'Intent persistence is not configured.')
	return {
		service: rt.intents,
		target: await rt.environments.intentTargetForUser(user.id)
	}
}

export const GET = api(async (event, rt) => {
	const resolved = await target(event, rt)
	const intentId = intentIdSchema.parse(event.params.intentId)
	return {
		body: await resolved.service.detail(
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
		body: await resolved.service.contribute(
			resolved.target.databaseName,
			resolved.target.scopeId,
			intentId,
			contribution
		),
		status: 201
	}
})

export const PATCH = api(async (event, rt) => {
	const resolved = await target(event, rt)
	const intentId = intentIdSchema.parse(event.params.intentId)
	return {
		body: await resolved.service.update(
			resolved.target.databaseName,
			resolved.target.scopeId,
			intentId,
			updateSchema.parse(await event.request.json())
		)
	}
})

export const DELETE = api(async (event, rt) => {
	const resolved = await target(event, rt)
	const intentId = intentIdSchema.parse(event.params.intentId)
	await resolved.service.delete(
		resolved.target.databaseName,
		resolved.target.scopeId,
		intentId,
		versionSchema.parse(await event.request.json())
	)
	return { body: null }
})
