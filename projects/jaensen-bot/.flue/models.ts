/**
 * Model registry for easy model configuration
 * Add new models here to make them available to agents
 */

export interface ModelConfig {
	provider: string
	modelId: string
	api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'mistral-conversations'
	baseUrl: string
	apiKey: string
	reasoning?: boolean
}

const DEFAULT_TINFOIL_BASE_URL = 'https://api.tinfoil.ai/v1'
const DEFAULT_OPENAI_COMPAT_BASE_URL = 'http://box:8000/v1'

export const models: Record<string, ModelConfig> = {
	'tinfoil-glm-5-1': {
		provider: 'tinfoil',
		modelId: 'glm-5-1',
		api: 'openai-completions',
		baseUrl: process.env.JAENSEN_TINFOIL_BASE_URL || DEFAULT_TINFOIL_BASE_URL,
		apiKey: process.env.JAENSEN_TINFOIL_API_KEY || '',
		reasoning: true
	},

	// Local models (e.g., via local LLM server)
	'minimax-m2.7-nvfp4': {
		provider: 'minimax',
		modelId: 'minimax-m2.7-nvfp4',
		api: 'openai-completions',
		baseUrl: process.env.JAENSEN_OPENAI_BASE_URL || DEFAULT_OPENAI_COMPAT_BASE_URL,
		apiKey: process.env.JAENSEN_OPENAI_API_KEY || 'local',
		reasoning: true
	}

	// Example: GLM via local server
	// 'glm-4': {
	//   provider: 'glm',
	//   modelId: 'glm-4',
	//   api: 'openai-completions',
	//   baseUrl: process.env.OPENAI_BASE_URL || 'http://box:8000/v1',
	//   apiKey: process.env.OPENAI_API_KEY || 'local',
	// },

	// Example: Gemma via local server
	// 'gemma-2b': {
	//   provider: 'gemma',
	//   modelId: 'gemma-2b',
	//   api: 'openai-completions',
	//   baseUrl: process.env.OPENAI_BASE_URL || 'http://box:8000/v1',
	//   apiKey: process.env.OPENAI_API_KEY || 'local',
	// },
}

export function getModel(modelKey: string): ModelConfig | undefined {
	return models[modelKey]
}

export function getAllModels(): ModelConfig[] {
	return Object.values(models)
}

export function resolveActiveModelConfig(): { modelKey: string; modelConfig: ModelConfig } {
	const explicitModelKey = process.env.JAENSEN_MODEL?.trim()
	const hasTinfoil = Boolean(process.env.JAENSEN_TINFOIL_API_KEY?.trim())
	const hasOpenAiCompat = Boolean(process.env.JAENSEN_OPENAI_BASE_URL?.trim() || process.env.JAENSEN_OPENAI_API_KEY?.trim())

	if (hasTinfoil && hasOpenAiCompat) {
		throw new Error(
			'Jaensen provider configuration is ambiguous. Configure exactly one provider prefix: JAENSEN_TINFOIL_* or JAENSEN_OPENAI_*.'
		)
	}

	const inferredModelKey = hasTinfoil ? 'tinfoil-glm-5-1' : 'minimax-m2.7-nvfp4'
	const modelKey = explicitModelKey || inferredModelKey
	const modelConfig = getModel(modelKey)

	if (!modelConfig) {
		throw new Error(`Model "${modelKey}" not found in model registry.`)
	}

	if (modelConfig.provider === 'tinfoil') {
		if (!process.env.JAENSEN_TINFOIL_API_KEY?.trim()) {
			throw new Error('Jaensen Tinfoil configuration requires JAENSEN_TINFOIL_API_KEY.')
		}
		return {
			modelKey,
			modelConfig: {
				...modelConfig,
				modelId: process.env.JAENSEN_TINFOIL_MODEL?.trim() || modelConfig.modelId,
				baseUrl: process.env.JAENSEN_TINFOIL_BASE_URL?.trim() || modelConfig.baseUrl,
				apiKey: process.env.JAENSEN_TINFOIL_API_KEY.trim()
			}
		}
	}

	if (modelConfig.provider === 'minimax') {
		return {
			modelKey,
			modelConfig: {
				...modelConfig,
				modelId: process.env.JAENSEN_OPENAI_MODEL?.trim() || modelConfig.modelId,
				baseUrl: process.env.JAENSEN_OPENAI_BASE_URL?.trim() || modelConfig.baseUrl,
				apiKey: process.env.JAENSEN_OPENAI_API_KEY?.trim() || modelConfig.apiKey
			}
		}
	}

	return { modelKey, modelConfig }
}
