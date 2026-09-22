import {
	Actor,
	type ActorStepPayload,
	definitionFromManifest,
	LLM_FILE_SCHEMA,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import { implementationDigest, installedFactory } from './installed-runtime'
import { type StudioArtifacts, studioObject } from './studio-artifacts'

const schema = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'workspace',
	name: 'intent-attachment',
	version: '1'
})
export const INTENT_ARTIFACT_MANIFEST: Manifest = {
	id: 'intent-documents',
	authority: 'ceo.aven',
	namespace: 'workspace',
	version: '1',
	name: 'Intent documents',
	description:
		'Attach a saved document to the Intent of an original uploaded file. The association and both inputs retain their history.',
	tags: ['documents', 'intents'],
	methods: [
		{
			name: 'attach',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Attach document to the same Intent as source. Source must be the original uploaded core.file, not extracted text. Resolves its exact upload declaration; never guesses an Intent or creates a Todo. Returns a durable attachment, not a duplicate document. No matching declaration is an error.',
			parameters: { type: 'object', additionalProperties: false, maxProperties: 0, properties: {} },
			requires: [],
			produces: ['ceo.aven.workspace.intent_attachment(A)'],
			inputSlots: ['source', 'document'].map((name) => ({
				name,
				schema: LLM_FILE_SCHEMA,
				predicate: 'ceo.aven.docs.file(F)',
				role: name,
				cardinality: 'one' as const
			})),
			outputSlots: [
				{
					name: 'attachment',
					schema,
					predicate: 'ceo.aven.workspace.intent_attachment(A)',
					role: 'attachment',
					cardinality: 'one'
				}
			]
		}
	]
}
export async function installIntentArtifactRuntimeActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actor-runner/intent-documents',
		manifest: INTENT_ARTIFACT_MANIFEST,
		placements: ['server'],
		schemas: [
			{
				schema,
				typeKey: 'intent.attachment',
				typeVersion: 1,
				projectorDigest: implementationDigest('intent.attachment@1')
			},
			{
				schema: LLM_FILE_SCHEMA,
				typeKey: 'core.file',
				typeVersion: 1,
				projectorDigest: implementationDigest('core.file@1')
			}
		],
		procedures: definitionFromManifest(INTENT_ARTIFACT_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: 'workspace.intent.attach',
			procedureVersion: '1',
			implementationDigest: implementationDigest('intent-upload-declaration-attachment-1'),
			evidenceRuleDigest: implementationDigest('source-and-document-inputs-1'),
			requiredFeatures: []
		}))
	})
}
export function createIntentArtifactRuntimeFactory(store: StudioArtifacts) {
	return installedFactory(INTENT_ARTIFACT_MANIFEST, store.scope, () => {
		const actor = new Actor(INTENT_ARTIFACT_MANIFEST, {
			attach: async (raw) => {
				const call = raw as unknown as ActorStepPayload
				const sources = call.inputMembers?.source,
					documents = call.inputMembers?.document
				if (sources?.length !== 1 || documents?.length !== 1)
					throw Error('INTENT_ATTACHMENT_INPUTS_REQUIRED')
				const [source, document] = await Promise.all([
					store.get(sources[0]!.artifactId),
					store.get(documents[0]!.artifactId)
				])
				if ([source, document].some((a) => a.typeKey !== 'core.file' || a.typeVersion !== 1))
					throw Error('INTENT_ATTACHMENT_FILE_REQUIRED')
				const response = await store.client.publication(store.scope, source.publicationId)
				const publication = studioObject(studioObject(response).publication)
				const members = publication.artifacts as Array<{ artifactId: string; localKey: string }>
				if (!members?.some((a) => a.localKey === 'file' && a.artifactId === source.artifactId))
					throw Error('INTENT_SOURCE_UPLOAD_REQUIRED')
				const declaration = members.filter((a) => a.localKey === 'intent')
				if (declaration.length !== 1) throw Error('INTENT_SOURCE_DECLARATION_REQUIRED')
				const intent = await store.get(declaration[0]!.artifactId)
				if (
					intent.typeKey !== 'intent.declaration' ||
					intent.typeVersion !== 1 ||
					intent.payload.triggerKind !== 'file-upload'
				)
					throw Error('INTENT_SOURCE_DECLARATION_REQUIRED')
				const payload = {
					intentId: intent.payload.intentId,
					sourceArtifactId: source.artifactId,
					documentArtifactId: document.artifactId,
					declarationArtifactId: intent.artifactId,
					title: String(document.payload.originalName)
				}
				return {
					record: JSON.stringify({ ok: true, outputs: { attachment: payload } }),
					wire: 'Document attached to the source Intent.'
				}
			}
		})
		return { actor, dispose: () => actor.dispose() }
	})
}
