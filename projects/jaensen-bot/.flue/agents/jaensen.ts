import type { FlueContext } from '@flue/sdk/client'
import { configureProvider, registerProvider } from '@flue/sdk/app'
import { getModel } from '../models'
import { createFsStorage, loadSkillDocs, LocalSandboxFactory, normalizeWebhookPayload, runJaensenTurn } from '../jaensen'

const modelKey = process.env.DEFAULT_MODEL || 'minimax-m2.7-nvfp4'
const modelConfig = getModel(modelKey)

if (!modelConfig) {
	throw new Error(`Model "${modelKey}" not found in model registry.`)
}

const resolvedModelConfig = modelConfig

registerProvider(resolvedModelConfig.provider, {
	api: resolvedModelConfig.api,
	baseUrl: resolvedModelConfig.baseUrl,
	apiKey: resolvedModelConfig.apiKey
})

configureProvider(resolvedModelConfig.provider, {
	baseUrl: resolvedModelConfig.baseUrl,
	apiKey: resolvedModelConfig.apiKey
})

export const triggers = { webhook: true }

export default async function ({ init, payload }: FlueContext) {
	const harness = await init({
		model: `${resolvedModelConfig.provider}/${resolvedModelConfig.modelId}`
	})
	const session = await harness.session()
	const input = normalizeWebhookPayload(payload)
	const baseDir = process.cwd()
	const storage = await createFsStorage(baseDir)
	const skillDocs = await loadSkillDocs(baseDir)
	const result = await runJaensenTurn(input, {
		storage,
		sandboxFactory: new LocalSandboxFactory(`${baseDir}/.flue/sandboxes`),
		skillDocs,
		generate: async (prompt) => {
			const output = await session.prompt(prompt)
			return typeof output === 'string' ? output : JSON.stringify(output)
		}
	})

	return {
		response: result.response,
		intent: result.primaryIntent,
		routing: result.routing,
		intentDecision: result.intentDecision,
		skillResults: result.skillResults,
		humanNotification: result.humanNotification
	}
}