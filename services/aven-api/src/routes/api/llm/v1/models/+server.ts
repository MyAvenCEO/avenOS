import { api, requireUser } from '$lib/server/api.js'
import { llmCapabilitySchema } from '$lib/server/llm-gateway.js'

export const GET = api(async (event, rt) => {
	await requireUser(event)
	const capabilities = llmCapabilitySchema
		.array()
		.max(16)
		.parse(event.url.searchParams.getAll('capability'))
	return {
		body: {
			object: 'list',
			data: (rt.llmGateway?.models(capabilities) ?? []).map((model) => ({
				id: model.id,
				object: 'model',
				created: 0,
				owned_by: 'aven',
				label: model.label,
				capabilities: model.capabilities
			}))
		}
	}
})
