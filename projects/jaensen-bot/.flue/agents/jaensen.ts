import type { FlueContext } from '@flue/sdk/client'
import { configureProvider, registerProvider } from '@flue/sdk/app'
import { resolveActiveModelConfig } from '../models'
import { createFsStorage, loadSkillRegistry, LocalSandboxFactory, normalizeWebhookPayload, runJaensenTurn } from '../jaensen'

const { modelConfig: resolvedModelConfig } = resolveActiveModelConfig()

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
	const skillRegistry = await loadSkillRegistry(baseDir)
	const result = await runJaensenTurn(input, {
		storage,
		sandboxFactory: new LocalSandboxFactory(`${baseDir}/.flue/sandboxes`),
		skillRegistry,
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