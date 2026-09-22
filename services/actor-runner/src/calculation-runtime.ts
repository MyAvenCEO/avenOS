import {
	type ActorStepPayload,
	CALCULATION_MANIFEST,
	CALCULATION_SCHEMA,
	createCalculationActor,
	definitionFromManifest,
	LLM_RESULT_SCHEMA,
	type TrustedActorInstallations
} from '@avenos/actors'
import { implementationDigest, installedFactory } from './installed-runtime'
import type { StudioArtifacts } from './studio-artifacts'

export async function installCalculationRuntimeActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actors/calculation',
		manifest: CALCULATION_MANIFEST,
		placements: ['server'],
		schemas: [
			{
				schema: CALCULATION_SCHEMA,
				typeKey: 'values.calculation',
				typeVersion: 2,
				projectorDigest: implementationDigest('values.calculation@2')
			},
			{
				schema: LLM_RESULT_SCHEMA,
				typeKey: 'ai.completion',
				typeVersion: 1,
				projectorDigest: implementationDigest('ai.completion@1')
			}
		],
		procedures: definitionFromManifest(CALCULATION_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: 'values.calculate',
			procedureVersion: '2',
			implementationDigest: implementationDigest('bounded-exact-decimal-calculation-2'),
			evidenceRuleDigest: implementationDigest('supplied-operands-not-verified-source-facts-1'),
			requiredFeatures: []
		}))
	})
}

export function createCalculationRuntimeFactory(store: StudioArtifacts) {
	return installedFactory(CALCULATION_MANIFEST, store.scope, () => {
		const actor = createCalculationActor((raw) => (raw as unknown as ActorStepPayload).parameters)
		return { actor, dispose: () => actor.dispose() }
	})
}
