import { createHash } from 'node:crypto'
import {
	Actor,
	type ActorAuthorizer,
	type ActorFactory,
	type ActorFactoryOffer,
	ActorRegistry,
	type ActorSpawnRequest,
	type ActorStepPayload,
	definitionFromManifest,
	type Manifest,
	resourceId,
	type SpawnedActor,
	type TrustedActorInstallations
} from '@avenos/actors'

export const STUDIO_EMAIL_SCHEMA = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'studio',
	name: 'email',
	version: '1'
})
export const STUDIO_BRIEF_SCHEMA = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'studio',
	name: 'brief',
	version: '1'
})
export const STUDIO_EMAIL_BRIEF_CAPABILITY = resourceId({
	authority: 'ceo.aven',
	kind: 'capability',
	namespace: 'studio.email-brief',
	name: 'create',
	version: '1'
})

export const STUDIO_EMAIL_BRIEF_MANIFEST: Manifest = {
	id: 'email-brief',
	authority: 'ceo.aven',
	namespace: 'studio',
	version: '1',
	name: 'Email brief',
	description: 'Create a concise, deterministic brief from committed email metadata.',
	tags: ['email', 'brief', 'deterministic'],
	methods: [
		{
			name: 'create',
			description: 'Turn an incoming email into a compact brief without a model call.',
			parameters: {
				type: 'object',
				properties: {},
				required: [],
				additionalProperties: false,
				maxProperties: 0
			},
			mode: 'transform',
			idempotency: 'pure',
			requires: ['ceo.aven.studio.email(E)'],
			produces: ['ceo.aven.studio.brief(E)'],
			inputSlots: [
				{
					name: 'email',
					predicate: 'ceo.aven.studio.email(E)',
					schema: STUDIO_EMAIL_SCHEMA,
					role: 'source',
					cardinality: 'one'
				}
			],
			outputSlots: [
				{
					name: 'brief',
					predicate: 'ceo.aven.studio.brief(E)',
					schema: STUDIO_BRIEF_SCHEMA,
					role: 'result',
					cardinality: 'one'
				}
			]
		}
	]
}

const definition = definitionFromManifest(STUDIO_EMAIL_BRIEF_MANIFEST)
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const offer: ActorFactoryOffer = {
	offerId: resourceId({
		authority: 'ceo.aven',
		kind: 'offer',
		namespace: 'studio',
		name: 'email-brief-server',
		version: '1'
	}),
	factoryId: resourceId({
		authority: 'ceo.aven',
		kind: 'factory',
		namespace: 'studio',
		name: 'email-brief-server',
		version: '1'
	}),
	definitionRef: definition.ref,
	label: 'Email brief · server',
	capabilityIds: [STUDIO_EMAIL_BRIEF_CAPABILITY],
	executionEnvironment: 'server',
	lifetime: 'step'
}

export async function installStudioRuntimeActors(
	installations: TrustedActorInstallations
): Promise<void> {
	await installations.install({
		packageId: '@avenos/actor-runner/studio-runtime',
		manifest: STUDIO_EMAIL_BRIEF_MANIFEST,
		placements: ['server'],
		schemas: [
			{
				schema: STUDIO_EMAIL_SCHEMA,
				typeKey: 'studio.email',
				typeVersion: 1,
				projectorDigest: digest('studio.email@1 -> ceo.aven.studio.email(E)')
			},
			{
				schema: STUDIO_BRIEF_SCHEMA,
				typeKey: 'studio.brief',
				typeVersion: 1,
				projectorDigest: digest('studio.brief@1 -> ceo.aven.studio.brief(E)')
			}
		],
		procedures: [
			{
				capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
				procedureKey: 'studio.email-brief',
				procedureVersion: '1',
				implementationDigest: digest('studio-email-brief-actor-v1'),
				evidenceRuleDigest: digest('causal-inputs:email;outputs:brief'),
				requiredFeatures: []
			}
		]
	})
}

export function createStudioRuntimeRegistry(): ActorRegistry {
	const registry = new ActorRegistry()
	registry.registerDefinition(definition)
	registry.publishOffer(offer)
	return registry
}

export function createStudioRuntimeFactory(): ActorFactory {
	return {
		offer,
		async assess(request: ActorSpawnRequest) {
			return {
				admitted: true,
				admissionId: `studio-email-brief:${request.requestId}`,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				grantedCapabilities: request.requestedCapabilities,
				normalizedConfiguration: {}
			}
		},
		async spawn(request: ActorSpawnRequest): Promise<SpawnedActor> {
			const actor = new Actor(STUDIO_EMAIL_BRIEF_MANIFEST, {
				create(payload) {
					const invocation = payload as unknown as ActorStepPayload
					const email = invocation.inputs.email
					if (!email || !email.value || typeof email.value !== 'object')
						throw new Error('EMAIL_INPUT_INVALID')
					const value = email.value as Record<string, unknown>
					const subject = String(value.subject ?? '').trim()
					const from = String(value.from ?? '').trim()
					if (!subject || !from) throw new Error('EMAIL_INPUT_INVALID')
					return {
						record: JSON.stringify({
							ok: true,
							outputs: {
								brief: {
									sourceArtifactId: email.artifactId,
									title: subject,
									summary: `Email from ${from}: ${subject}`,
									status: 'complete'
								}
							}
						}),
						wire: `Brief created for ${subject}`
					}
				}
			})
			return {
				actor,
				advertisement: {
					instanceId: actor.uuid,
					definitionRef: definition.ref,
					label: offer.label,
					address: { kind: 'worker', value: 'actor-runner' },
					capabilityIds: request.requestedCapabilities,
					status: 'available',
					executionEnvironment: 'server'
				},
				release: () => actor.dispose()
			}
		}
	}
}

export function createStudioRuntimeAuthorizer(scopeId: string): ActorAuthorizer {
	return {
		decide(request) {
			const permitted =
				request.principal.kind === 'user' &&
				request.access.tenantId === scopeId &&
				request.definitionRef === definition.ref &&
				(!request.capabilityId || request.capabilityId === STUDIO_EMAIL_BRIEF_CAPABILITY)
			return permitted
				? { allow: true, decisionId: `studio-email-brief:${request.action}` }
				: {
						allow: false,
						decisionId: `studio-email-brief-deny:${request.action}`,
						reasonCode: 'STUDIO_RUNTIME_DENIED'
					}
		}
	}
}

export function studioRuntimeOffer(): ActorFactoryOffer {
	return structuredClone(offer)
}
