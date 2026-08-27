import { api, readJson, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

export const POST = api(async (event, rt) => {
	await requireUser(event)
	if (!rt.llmGateway) {
		throw new AppError(503, 'LLM_GATEWAY_UNAVAILABLE', 'The LLM gateway is not configured.')
	}
	return rt.llmGateway.openAiChatCompletion(await readJson(event))
})
