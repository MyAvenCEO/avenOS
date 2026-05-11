import { registerProvider } from '@flue/sdk/app'
import { resolveActiveModelConfig } from './.flue/models'

const { modelConfig } = resolveActiveModelConfig()

registerProvider(modelConfig.provider, {
	api: modelConfig.api,
	baseUrl: modelConfig.baseUrl,
	apiKey: modelConfig.apiKey
})
