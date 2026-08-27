import { api, readJson, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'
import { llmCompletionRequestSchema } from '$lib/server/llm-gateway.js'

export const POST = api(async (event, rt) => {
	await requireUser(event)
	if (!rt.llmGateway) {
		throw new AppError(503, 'LLM_GATEWAY_UNAVAILABLE', 'The LLM gateway is not configured.')
	}
	const request = llmCompletionRequestSchema.parse(await readJson(event))
	return { body: await rt.llmGateway.complete(request) }
})
