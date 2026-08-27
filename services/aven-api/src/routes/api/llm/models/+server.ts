import { api, requireUser } from '$lib/server/api.js'
import { llmCapabilitySchema } from '$lib/server/llm-gateway.js'

export const GET = api(async (event, rt) => {
	await requireUser(event)
	const requiredCapabilities = llmCapabilitySchema
		.array()
		.max(16)
		.parse(event.url.searchParams.getAll('capability'))
	return {
		body: {
			models: rt.llmGateway?.models(requiredCapabilities) ?? []
		}
	}
})
