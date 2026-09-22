import {
	type ActorStepPayload,
	createKnowledgeActor,
	definitionFromManifest,
	KNOWLEDGE_MANIFEST,
	KNOWLEDGE_SCHEMA,
	type TrustedActorInstallations
} from '@avenos/actors'
import { implementationDigest, installedFactory } from './installed-runtime'
import type { StudioArtifacts } from './studio-artifacts'

export async function installKnowledgeRuntimeActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actors/knowledge',
		manifest: KNOWLEDGE_MANIFEST,
		placements: ['server'],
		schemas: [
			{
				schema: KNOWLEDGE_SCHEMA,
				typeKey: 'knowledge.result',
				typeVersion: 1,
				projectorDigest: implementationDigest('knowledge.result@1')
			}
		],
		procedures: definitionFromManifest(KNOWLEDGE_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: 'knowledge.query',
			procedureVersion: '1',
			implementationDigest: implementationDigest('source-bound-semantic-projection-typed-money-2'),
			evidenceRuleDigest: implementationDigest('snapshot-query-and-exact-row-references-1'),
			requiredFeatures: []
		}))
	})
}
export function createKnowledgeRuntimeFactory(store: StudioArtifacts) {
	return installedFactory(KNOWLEDGE_MANIFEST, store.scope, () => {
		const actor = createKnowledgeActor(
			(query) =>
				store.client.library(store.scope, query as Record<string, string | number | undefined>),
			(raw) => (raw as unknown as ActorStepPayload).parameters
		)
		return { actor, dispose: () => actor.dispose() }
	})
}
