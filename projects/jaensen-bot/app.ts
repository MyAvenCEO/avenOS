import { registerProvider } from '@flue/sdk/app'
import { getModel } from './.flue/models'

const modelKey = process.env.DEFAULT_MODEL || 'minimax-m2.7-nvfp4'
const modelConfig = getModel(modelKey)

if (!modelConfig) {
	throw new Error(`Model "${modelKey}" not found in .flue/models.ts`)
}

registerProvider(modelConfig.provider, {
	api: modelConfig.api,
	baseUrl: modelConfig.baseUrl,
	apiKey: modelConfig.apiKey
})
