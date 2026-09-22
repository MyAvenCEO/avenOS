import {
	type ActorAuthorizer,
	type ActorFactoryResolver,
	type ActorInvocationHost,
	type ActorRegistrySnapshot,
	authorizeRegistryForPlanning,
	checkStudioPortValues,
	executeStudioProgram,
	invokeActorCapability,
	type PlanRunExecutionContext,
	type PlanRunExecutor,
	type PlanRunStartRequest,
	parseStudioSkillParameters,
	type RuntimeInputBinding,
	readPortResultMembership,
	resourceId,
	type StudioProgramValues,
	type TrustedActorInstallations
} from '@avenos/actors'
import { stablePublicationUuid } from './artifact-store-port.js'
import {
	type ReviewStore,
	requestRunReview,
	reviewContinuation,
	WaitingForReview
} from './reviews.js'
import {
	type StudioArtifact,
	type StudioArtifacts,
	type StudioDraftArtifact,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'
import { assertReferenceMembers, outputReferences } from './studio-output-references.js'
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
	factoriesFor(
		request: PlanRunStartRequest,
		signal?: AbortSignal,
		context?: PlanRunExecutionContext
	): ActorFactoryResolver | Promise<ActorFactoryResolver>
	installations: TrustedActorInstallations
	reviewsFor?(request: PlanRunStartRequest, context?: PlanRunExecutionContext): ReviewStore
	invocationHostFor?(
		request: PlanRunStartRequest,
		context?: PlanRunExecutionContext
	): ActorInvocationHost | Promise<ActorInvocationHost>
	/** Host-only handoff from protected publishers. Never infer these identities
	 * from Actor JSON or republish protected observations under the runner identity. */
	committedOutputsFor?(
		request: PlanRunStartRequest,
		context: PlanRunExecutionContext | undefined,
		stepId: string,
		capabilityId: string
	): Promise<Record<string, StudioArtifact[]> | undefined>
}

/** Typed programs and solver plans share Actor admission; collections stay named and sealed. */
export function createStudioV2Executor(
	artifacts: StudioArtifacts,
	dependencies: StudioV2ExecutionDependencies
): PlanRunExecutor {
	return async (request, context) => {
		context?.signal?.throwIfAborted()
		if (request.skillRef !== STUDIO_SKILL_V2) throw Error('Not a Studio activation.')
		const activationId = String(request.parameters.activationArtifactId ?? '')
		const activation = await artifacts.get(activationId)
		if (
			activation.typeKey !== 'studio.activation' ||
			activation.typeVersion !== 2 ||
			activation.payload.contractVersion !== 2
		)
			throw Error('STUDIO_ACTIVATION_INVALID')
		const payload = activation.payload
		if (
			payload.initiator !== request.security.principal.subjectId ||
			request.security.access.tenantId !== artifacts.scope
		)
			throw Error('STUDIO_ACTIVATION_SUBJECT_MISMATCH')
		const skillArtifactId = String(payload.skillArtifactId ?? '')
		const skill = await artifacts.get(skillArtifactId)
		assertExactV2Skill(skill, skillArtifactId, artifacts.scope)
		const [registry, authorizer, factories] = await Promise.all([
			dependencies.registryFor(request),
			dependencies.authorizerFor(request),
			dependencies.factoriesFor(request, context?.signal, context)
		])
		const admitted = await new StudioV2SkillValidator(
			artifacts.scope,
			dependencies.installations
		).validate(skill.payload, {
			principal: request.security.principal,
			access: request.security.access,
			actorAuthorizer: authorizer,
			resolveReadableSkill: (id) => artifacts.get(id)
		})
		if (admitted.issues.length)
			throw Error('STUDIO_RUNTIME_CONTRACT_INVALID:' + admitted.issues[0]!.code)
		const view = await authorizeRegistryForPlanning(
			registry,
			request.security.principal,
			authorizer,
			{ access: request.security.access }
		)
		const decisions = new Set<string>()
		const invocationHost = await dependencies.invocationHostFor?.(request, context)
		try {
			const results = await executeStudioProgram({
				definition: admitted.definition,
				children: admitted.children,
				inputs: studioObject(payload.inputs),
				parameters: studioObject(payload.parameters),
				signal: context?.signal,
				host: {
					read: (id) => artifacts.get(id),
					review: async ({ id, step, subjects }) => {
						const store = dependencies.reviewsFor?.(request, context)
						if (!store) throw Error('STUDIO_REVIEW_UNAVAILABLE')
						const exactSubjects: Record<string, unknown> = {}
						for (const [name, members] of Object.entries(subjects)) {
							exactSubjects[name] = await Promise.all(
								members.map(async (member) => {
									const exact = await artifacts.get(member.artifactId)
									return {
										artifactId: exact.artifactId,
										digest: exact.artifactSha256,
										type: exact.typeKey,
										version: exact.typeVersion
									}
								})
							)
						}
						decisions.add(
							await requestRunReview(store, context, {
								invocationId: id,
								subjectSchema: step.subjectSchema,
								title: step.label,
								subject: { activationId, skillArtifactId, subjects: exactSubjects }
							})
						)
					},
					invoke: async (invocation) => {
						context?.signal?.throwIfAborted()
						const authorized = view.capabilities.find(
							(c) => c.capability.id === invocation.step.capabilityId
						)
						const target = authorized?.targets.find((t) => t.executionEnvironment === 'server')
						if (!authorized || !target)
							throw Error('STUDIO_CAPABILITY_NOT_EXECUTABLE:' + invocation.step.capabilityId)
						const capability = registry.definitions
							.flatMap((d) => d.capabilities)
							.find((c) => c.id === authorized.capability.id)!
						const installed = dependencies.installations.get(target.definitionRef)!
						const method = installed.descriptor.manifest.methods.find(
							(m) => m.name === capability.method
						)!
						const procedure = installed.descriptor.procedures.find(
							(p) => p.capabilityId === capability.id
						)!
						if (!procedure) throw Error('STUDIO_PROCEDURE_UNAVAILABLE')
						if (procedure.requiredFeatures.includes('model') && !invocation.allowModel)
							throw Error('STUDIO_MODEL_NOT_ALLOWED')
						const parameters = parseStudioSkillParameters(
							{ ...admitted.definition, parametersSchema: method.parameters },
							invocation.parameters
						)
						const slots = capability.inputSlots ?? []
						const inputPorts = Object.fromEntries(
							slots.map((slot) => {
								const schema = installed.descriptor.schemas.find((s) => s.schema === slot.schema)!
								if (!schema || slot.sensitive) throw Error('STUDIO_INPUT_CONTRACT_INCOMPLETE')
								return [
									slot.name,
									{
										schema: schema.schema,
										type: { key: schema.typeKey, version: schema.typeVersion },
										predicate: slot.predicate,
										role: slot.role!,
										cardinality: slot.cardinality
									}
								]
							})
						)
						for (const slot of slots)
							if (slot.cardinality !== 'one' && !Object.hasOwn(invocation.inputs, slot.name))
								invocation.inputs[slot.name] = []
						checkStudioPortValues(inputPorts, invocation.inputs)
						const inputs: RuntimeInputBinding[] = []
						for (const slot of slots)
							for (const member of invocation.inputs[slot.name]!) {
								const exact = await artifacts.get(member.artifactId)
								if (
									exact.typeKey !== inputPorts[slot.name]!.type.key ||
									exact.typeVersion !== inputPorts[slot.name]!.type.version
								)
									throw Error('STUDIO_INPUT_TYPE_CHANGED')
								inputs.push({
									slot: slot.name,
									role: slot.role!,
									artifact: {
										artifactId: exact.artifactId,
										predicate: slot.predicate,
										schema: slot.schema!,
										typeKey: exact.typeKey,
										schemaVersion: exact.typeVersion,
										contentDigest: exact.artifactSha256 ?? studioPlanDigest(exact.payload),
										value: exact.payload
									}
								})
							}
						const publicationId = stablePublicationUuid(
							request.idempotencyKey + ':' + invocation.id
						)
						// A retry resolves the exact committed named result, never reruns a model or patch.
						const existing = await artifacts.lookup(publicationId)
						if (existing) {
							const replayDecision = await authorizer.decide({
								action: 'invoke',
								principal: request.security.principal,
								access: request.security.access,
								definitionRef: target.definitionRef,
								capabilityId: capability.id,
								target:
									target.kind === 'factory'
										? { kind: 'factory', factoryId: target.factoryId, offerId: target.offerId }
										: { kind: 'instance', instanceId: target.instanceId },
								configuration: invocation.configuration,
								method: capability.method,
								inputs: inputs.map((i) => ({ slot: i.slot, role: i.role, ...i.artifact })),
								runId: request.idempotencyKey
							})
							if (!replayDecision.allow) throw Error('STUDIO_REPLAY_DENIED')
							decisions.add(replayDecision.decisionId)
							return readPublishedPorts(publicationId, existing, invocation.step.outputs, artifacts)
						}
						const step = {
							id: invocation.id,
							capability: capability.id,
							actor: capability.actor,
							method: capability.method,
							inputs: [],
							outputs: [],
							dependsOn: [],
							cost: 1,
							target,
							parameters,
							configuration: invocation.configuration
						}
						const response = await invokeActorCapability(
							{
								runId: request.idempotencyKey,
								registry,
								principal: request.security.principal,
								access: request.security.access,
								authorizer,
								factories,
								signal: context?.signal,
								invocationHost,
								artifacts: {
									resolve: async () => null,
									publish: async () => {
										throw Error('Use named publication')
									}
								},
								program: {
									goals: [],
									steps: [],
									results: [],
									totalCost: 0,
									registryRevision: registry.revision,
									plannedFor: {
										subjectId: request.security.principal.subjectId,
										tenantId: artifacts.scope
									},
									executionEnvironment: 'server'
								}
							},
							step,
							capability,
							inputs,
							decisions
						)
						const result = studioObject(JSON.parse(response.record))
						if (result.ok !== true) throw Error(String(result.error ?? response.wire))
						const committedOutputs = await dependencies.committedOutputsFor?.(
							request,
							context,
							invocation.id,
							capability.id
						)
						if (committedOutputs && Object.keys(studioObject(result.outputs)).length)
							throw Error('STUDIO_AMBIGUOUS_OUTPUT_HANDOFF')
						const returned = committedOutputs ?? studioObject(result.outputs)
						if (Object.keys(returned).some((name) => !Object.hasOwn(invocation.step.outputs, name)))
							throw Error('STUDIO_UNDECLARED_PORT')
						const drafts: StudioDraftArtifact[] = []
						const referenceMap = outputReferences(result.references)
						const memberKeys = new Set<string>()
						for (const [name, port] of Object.entries(invocation.step.outputs)) {
							if (!Object.hasOwn(returned, name)) throw Error('STUDIO_MISSING_PORT_RESULT:' + name)
							const members =
								committedOutputs || port.cardinality === 'many'
									? returned[name]
									: returned[name] == null
										? []
										: [returned[name]]
							if (
								!Array.isArray(members) ||
								(port.cardinality === 'one' && members.length !== 1) ||
								(port.cardinality === 'optional' && members.length > 1) ||
								members.length > invocation.maxMembers
							)
								throw Error('STUDIO_PORT_CARDINALITY:' + name)
							for (const [index, value] of members.entries()) {
								const key = name + '-' + index
								memberKeys.add(key)
								if (committedOutputs) {
									const member = value as StudioArtifact
									const exact = await artifacts.get(member.artifactId)
									if (
										exact.scopeId !== artifacts.scope ||
										exact.typeKey !== port.type.key ||
										exact.typeVersion !== port.type.version ||
										exact.artifactSha256 !== member.artifactSha256
									)
										throw Error('STUDIO_COMMITTED_OUTPUT_MISMATCH')
									continue
								}
								const references = referenceMap[key] ?? []
								const blob = result.blobs?.[key]
								let bytes: Uint8Array | undefined
								if (blob) {
									if (typeof blob.base64 !== 'string' || blob.base64.length > 180_000_000)
										throw Error('STUDIO_OUTPUT_BLOB_INVALID')
									bytes = Buffer.from(blob.base64, 'base64')
									if (Buffer.from(bytes).toString('base64') !== blob.base64)
										throw Error('STUDIO_OUTPUT_BLOB_INVALID')
								}
								drafts.push({
									key,
									type: port.type.key,
									version: port.type.version,
									payload: value,
									references,
									output: { role: port.role, ordinal: index },
									...(bytes && { bytes, mediaType: blob.mediaType })
								})
							}
							drafts.push({
								key: 'port-' + name,
								type: 'actors.port-result',
								output: {
									role: 'port-result',
									ordinal: Object.keys(invocation.step.outputs).indexOf(name)
								},
								payload: {
									invocationId: publicationId,
									port: name,
									cardinality: port.cardinality,
									members: members.map((_: unknown, referenceOrdinal: number) => ({
										memberKey: 'member-' + referenceOrdinal,
										referenceOrdinal
									}))
								},
								references: members.map((_: unknown, index: number) => ({
									role: 'member',
									...(committedOutputs
										? { id: (members[index] as StudioArtifact).artifactId }
										: { local: name + '-' + index })
								}))
							})
						}
						assertReferenceMembers(referenceMap, memberKeys)
						context?.signal?.throwIfAborted()
						const committed = await artifacts.publish({
							id: publicationId,
							principal: request.security.principal.subjectId,
							procedure: procedure.procedureKey,
							procedureVersion: procedure.procedureVersion,
							executor: { kind: 'agent', id: installed.definition.ref },
							inputs: [
								...inputs.map((i) => ({ role: i.role, id: i.artifact.artifactId })),
								{ role: 'activation', id: activationId },
								{ role: 'program', id: skillArtifactId }
							],
							parameters: {
								logicalRunId: request.idempotencyKey,
								invocationStepId: invocation.id,
								capabilityId: capability.id,
								settings: parameters
							},
							implementation: {
								installationDigest: installed.digest,
								implementationDigest: procedure.implementationDigest
							},
							receipt: {
								outcome: 'succeeded',
								...(result.modelReceipt && { model: result.modelReceipt })
							},
							evidence: Array.isArray(result.evidence) ? result.evidence : [],
							artifacts: drafts
						})
						return readPublishedPorts(publicationId, committed, invocation.step.outputs, artifacts)
					}
				}
			})
			const outputArtifacts = Object.values(results.outputs).flat()
			return {
				artifactIds: results.artifacts.map((a) => a.artifactId),
				completedStepIds: results.completedStepIds,
				remainingGoals: [],
				registryRevision: registry.revision,
				policyDecisionIds: [...decisions],
				output: {
					outputs: Object.fromEntries(
						Object.entries(results.outputs).map(([name, values]) => [
							name,
							values.map((a) => a.artifactId)
						])
					),
					...(outputArtifacts[0] && {
						artifact: await artifacts.get(outputArtifacts[0].artifactId)
					})
				}
			}
		} catch (error) {
			if (!(error instanceof WaitingForReview)) throw error
			return {
				remainingGoals: request.goals,
				policyDecisionIds: [...decisions],
				continuation: reviewContinuation(error.record)
			}
		}
	}
}

async function readPublishedPorts(
	invocationId: string,
	committed: import('./studio-artifacts').StudioArtifact[],
	ports: import('@avenos/actors').StudioSkillV2['inputs'],
	artifacts: StudioArtifacts
): Promise<StudioProgramValues> {
	const outputs: StudioProgramValues = {}
	for (const [name, port] of Object.entries(ports)) {
		const reports = committed.filter(
			(a) => a.typeKey === 'actors.port-result' && a.typeVersion === 1 && a.payload.port === name
		)
		if (reports.length !== 1) throw Error('STUDIO_COMMITTED_PORT_MISSING')
		const report = reports[0]!
		const membership = studioObject(
			await artifacts.client.references(artifacts.scope, report.artifactId)
		)
		if (membership.artifactId !== report.artifactId || !Array.isArray(membership.references))
			throw Error('STUDIO_COMMITTED_MEMBERSHIP_INVALID')
		const references = membership.references
		const members = readPortResultMembership(
			invocationId,
			report.payload as unknown as import('@avenos/actors').StoredPortResultPayload,
			references,
			{ name, ...port, schema: port.schema as import('@avenos/actors').SchemaId }
		)
		outputs[name] = []
		for (const member of members) {
			outputs[name]!.push(await artifacts.get(member.artifactId))
		}
	}
	checkStudioPortValues(ports, outputs)
	return outputs
}
