import {
	authorizeRegistryForPlanning,
	compileStudioSkillV2Execution,
	executePhysicalProgram,
	resourceId,
	type ActorAuthorizer,
	type ActorFactoryResolver,
	type ActorRegistrySnapshot,
	type PlanRunExecutor,
	type PlanRunStartRequest,
	type TrustedActorInstallations
} from '@avenos/actors'
import { ArtifactStoreRuntimePort } from './artifact-store-port.js'
import { type StudioArtifact, type StudioArtifacts } from './studio-artifacts.js'
import {
	STUDIO_BRIEF_SCHEMA,
	STUDIO_EMAIL_BRIEF_CAPABILITY,
	STUDIO_EMAIL_SCHEMA
} from './studio-runtime.js'
import { assertExactV2Skill, StudioV2SkillValidator } from './studio-v2-validation.js'

export const STUDIO_SKILL_V2 = resourceId({
	authority: 'ceo.aven',
	kind: 'skill',
	namespace: 'studio',
	name: 'composed',
	version: '2'
})

export interface StudioV2ExecutionDependencies {
	registryFor(request: PlanRunStartRequest): ActorRegistrySnapshot | Promise<ActorRegistrySnapshot>
	authorizerFor(request: PlanRunStartRequest): ActorAuthorizer | Promise<ActorAuthorizer>
	factoriesFor(request: PlanRunStartRequest): ActorFactoryResolver | Promise<ActorFactoryResolver>
	installations: TrustedActorInstallations
}

/** Execute an exact saved v2 definition through the shared physical Actor runtime. */
export function createStudioV2Executor(
	artifacts: StudioArtifacts,
	dependencies: StudioV2ExecutionDependencies
): PlanRunExecutor {
	return async (request, context) => {
		throwIfAborted(context?.signal)
		if (request.skillRef !== STUDIO_SKILL_V2)
			throw new Error('The request is not a Studio Skill v2 activation.')
		const activationId = String(request.parameters.activationArtifactId ?? '')
		const activation = await artifacts.get(activationId)
		if (
			activation.typeKey !== 'studio.activation' ||
			activation.typeVersion !== 2 ||
			activation.payload.contractVersion !== 2
		)
			throw new Error('STUDIO_ACTIVATION_INVALID')
		const payload = activation.payload
		if (payload.initiator !== request.security.principal.subjectId)
			throw new Error('STUDIO_ACTIVATION_SUBJECT_MISMATCH')
		const skillArtifactId = String(payload.skillArtifactId ?? '')
		const skillArtifact = await artifacts.get(skillArtifactId)
		assertExactV2Skill(skillArtifact, skillArtifactId, artifacts.scope)
		const [registry, authorizer, factories] = await Promise.all([
			dependencies.registryFor(request),
			dependencies.authorizerFor(request),
			dependencies.factoriesFor(request)
		])
		const admitted = await new StudioV2SkillValidator(
			artifacts.scope,
			dependencies.installations
		).validate(skillArtifact.payload, {
			principal: request.security.principal,
			access: request.security.access,
			actorAuthorizer: authorizer,
			resolveReadableSkill: (id) => artifacts.get(id)
		})
		if (admitted.issues.length)
			throw new Error(`STUDIO_RUNTIME_CONTRACT_INVALID:${admitted.issues[0]!.code}`)
		throwIfAborted(context?.signal)
		const view = await authorizeRegistryForPlanning(registry, request.security.principal, authorizer, {
			access: request.security.access
		})
		const program = compileStudioSkillV2Execution({
			definition: admitted.definition,
			children: admitted.children,
			view,
			executionEnvironment: 'server',
			inputs: recordOfStrings(payload.inputs, 'activation inputs'),
			parameters: record(payload.parameters, 'activation parameters')
		})
		const port = new ArtifactStoreRuntimePort({
			client: artifacts.client,
			scopeId: artifacts.scope,
			initiator: { kind: 'user', id: `user:${request.security.principal.subjectId}` },
			schemas: [
				{
					schema: STUDIO_EMAIL_SCHEMA,
					typeKey: 'studio.email',
					typeVersion: 1,
					project: (_payload, artifactId) => [`ceo.aven.studio.email(${artifactId})`]
				},
				{
					schema: STUDIO_BRIEF_SCHEMA,
					typeKey: 'studio.brief',
					typeVersion: 1,
					project: (value) => [
						`ceo.aven.studio.brief(${String(record(value, 'brief').sourceArtifactId)})`
					]
				}
			],
			procedures: [
				{
					capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
					procedureKey: 'studio.email-brief',
					procedureVersion: '1',
					executor: { kind: 'service', id: 'actor-runner' },
					implementation: { adapter: 'generic-actor-runtime', version: 1 }
				}
			]
		})
		const executed = await executePhysicalProgram({
			runId: request.idempotencyKey,
			program,
			registry,
			principal: request.security.principal,
			access: request.security.access,
			authorizer,
			factories,
			artifacts: port,
			signal: context?.signal
		})
		const finalArtifactId = executed.results[0]?.artifactId
		const finalArtifact = finalArtifactId ? await artifacts.get(finalArtifactId) : undefined
		return {
			artifactIds: executed.artifacts.map((artifact) => artifact.artifactId),
			completedStepIds: executed.completedStepIds,
			remainingGoals: executed.remainingGoals,
			registryRevision: executed.registryRevision,
			policyDecisionIds: executed.policyDecisionIds,
			...(finalArtifact && { output: { artifact: finalArtifact } })
		}
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return
	if (signal.reason instanceof Error) throw signal.reason
	throw new Error('Execution cancelled.')
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function recordOfStrings(value: unknown, label: string): Record<string, string> {
	const result = record(value, label)
	if (Object.values(result).some((item) => typeof item !== 'string'))
		throw new Error(`${label} must contain artifact IDs`)
	return result as Record<string, string>
}
