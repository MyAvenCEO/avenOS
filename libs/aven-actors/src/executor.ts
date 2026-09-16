import type { Actor, CapabilitySlot, HandlerResult, Predicate } from './actor'
import { type AffordanceDefinition, discoverAffordances } from './affordances'
import {
	type ActorAccessContext,
	type ActorAuthorizer,
	type ActorPrincipal,
	authorizeRegistryForPlanning
} from './authorization'
import type { ActorFactoryResolver, ActorSpawnRequest } from './factory'
import type { CapabilityId, SchemaId } from './ids'
import {
	enrichAfterGoalsAuthorized,
	enrichAuthorized,
	type PhysicalPlanStep,
	type PhysicalProgram,
	solveAuthorized
} from './physical-planner'
import type { Ingredient, PlanValue } from './planner'
import {
	definitionRef,
	type ActorRegistrySnapshot,
	type ExecutionEnvironment,
	type RegisteredCapability
} from './registry'
import {
	assertPortableRunValue,
	type PlanRunExecutor,
	type PlanRunStartRequest,
	type PlanRunUnderstandingOutput
} from './run'
import { unifiable } from './term'

/** A committed value as seen by the portable executor. */
export interface RuntimeArtifact {
	artifactId: string
	predicate: Predicate
	schema: SchemaId
	typeKey: string
	schemaVersion: number
	contentDigest: string
	value: unknown
}

export interface RuntimeArtifactResolver {
	/** Resolve only when the committed artifact projects the expected fact. */
	resolve(artifactId: string, expectedPredicate: Predicate): Promise<RuntimeArtifact | null>
}

export interface RuntimeOutputDraft {
	slot: string
	role: string
	predicate: Predicate
	schema: SchemaId
	value: unknown
}

export interface RuntimeInputBinding {
	slot: string
	role: string
	artifact: RuntimeArtifact
}

export interface RuntimeStepPublication {
	publicationId: string
	runId: string
	stepId: string
	capabilityId: CapabilityId
	inputs: RuntimeInputBinding[]
	outputs: RuntimeOutputDraft[]
}

/** The host adapter commits outputs and provenance atomically. */
export interface RuntimeArtifactPublisher {
	publish(publication: RuntimeStepPublication): Promise<RuntimeArtifact[]>
}

/** Host-owned lookup; a registry address alone can never supply executable code. */
export interface ActorInstanceResolver {
	resolve(instanceId: string): Actor | undefined | Promise<Actor | undefined>
}

export interface ActorStepInput {
	artifactId: string
	predicate: Predicate
	schema: SchemaId
	typeKey: string
	schemaVersion: number
	contentDigest: string
	value: unknown
}

/** Portable payload delivered to a capability method. */
export interface ActorStepPayload extends Record<string, unknown> {
	runId: string
	stepId: string
	capabilityId: CapabilityId
	inputs: Record<string, ActorStepInput>
	parameters: Record<string, unknown>
	configuration: Record<string, unknown>
}

/** Portable record returned by actors executed through this core. */
export interface ActorStepResult {
	ok: true
	outputs: Record<string, unknown>
	warnings?: string[]
}

export interface PhysicalProgramExecutionRequest {
	runId: string
	program: PhysicalProgram
	registry: ActorRegistrySnapshot
	principal: ActorPrincipal
	access: ActorAccessContext
	authorizer: ActorAuthorizer
	factories: ActorFactoryResolver
	instances?: ActorInstanceResolver
	artifacts: RuntimeArtifactResolver & RuntimeArtifactPublisher
	parameters?: Record<string, unknown>
	resource?: Record<string, unknown>
	/** Live attempt cancellation. Hosts must still fence Store publication independently. */
	signal?: AbortSignal
}

export interface PhysicalProgramExecutionResult {
	completedStepIds: string[]
	artifacts: RuntimeArtifact[]
	/** Public program results in the exact order of PhysicalProgram.results. */
	results: RuntimeArtifact[]
	fulfilledPredicates: Predicate[]
	remainingGoals: Predicate[]
	registryRevision: number
	policyDecisionIds: string[]
	warnings: string[]
}

type Awaitable<Value> = Value | Promise<Value>

/**
 * Host-owned ports needed by the portable registry/planner/factory executor.
 *
 * Every port is selected from the already authenticated run request. This keeps
 * customer routing, authorization, credentials, and process ownership outside
 * the portable plan while allowing local and server hosts to share one core.
 */
export interface ActorExecutionHost {
	readonly executionEnvironment: ExecutionEnvironment
	registry(request: PlanRunStartRequest): Awaitable<ActorRegistrySnapshot>
	authorizer(request: PlanRunStartRequest): Awaitable<ActorAuthorizer>
	factories(request: PlanRunStartRequest): Awaitable<ActorFactoryResolver>
	instances?(request: PlanRunStartRequest): Awaitable<ActorInstanceResolver>
	artifacts(
		request: PlanRunStartRequest
	): Awaitable<RuntimeArtifactResolver & RuntimeArtifactPublisher>
	resource?(request: PlanRunStartRequest): Awaitable<Record<string, unknown> | undefined>
	/** Application actions considered after enrichment; definitions do not execute work. */
	affordances?(request: PlanRunStartRequest): Awaitable<AffordanceDefinition[]>
	/** Previously committed facts which may enable cross-artifact actions. */
	relatedIngredients?(request: PlanRunStartRequest): Awaitable<Ingredient[]>
}

/** Compose the same generic plan executor into either a local or server runner. */
export function createActorPlanExecutor(host: ActorExecutionHost): PlanRunExecutor {
	return async (request) => {
		if (request.executionEnvironment !== host.executionEnvironment) {
			throw new Error(
				`${host.executionEnvironment} execution host cannot run ${request.executionEnvironment} placement`
			)
		}
		assertGoalRequest(request)
		const [registry, authorizer] = await Promise.all([
			host.registry(request),
			host.authorizer(request)
		])
		const view = await authorizeRegistryForPlanning(
			registry,
			request.security.principal,
			authorizer,
			{ access: request.security.access }
		)
		const goalSpec = request.goalSpec ?? { mode: 'exact', completion: 'goal_only' as const }
		const enrichmentSpec =
			goalSpec.mode === 'explore' ||
			(goalSpec.mode === 'exact' && goalSpec.completion === 'goal_then_enrich')
				? goalSpec
				: null
		const planned =
			enrichmentSpec && goalSpec.mode === 'exact'
				? enrichAfterGoalsAuthorized(
						view,
						request.ingredients,
						request.goals,
						enrichmentSpec.factFamilies,
						{ executionEnvironment: host.executionEnvironment }
					)
				: enrichmentSpec
					? enrichAuthorized(view, request.ingredients, enrichmentSpec.factFamilies, {
							executionEnvironment: host.executionEnvironment
						})
					: solveAuthorized(view, request.ingredients, request.goals, {
							executionEnvironment: host.executionEnvironment
						})
		if (!planned.ok) throw new Error(planned.reason)

		// A zero-step program is a valid generic plan. It needs no factory or
		// Artifact Store connection and is useful for already-satisfied goals.
		if (planned.program.steps.length === 0) {
			const output = enrichmentSpec
				? await understandingOutput(host, request, view, [], enrichmentSpec.subject)
				: undefined
			return {
				artifactIds: [],
				completedStepIds: [],
				remainingGoals: enrichmentSpec
					? request.goals.filter(
							(goal) =>
								!request.ingredients.some((ingredient) => unifiable(goal, ingredient.predicate))
						)
					: [],
				registryRevision: registry.revision,
				policyDecisionIds: [],
				...(output && { output })
			}
		}

		const [factories, artifacts, resource, instances] = await Promise.all([
			host.factories(request),
			host.artifacts(request),
			host.resource?.(request),
			host.instances?.(request)
		])
		const result = await executePhysicalProgram({
			runId: request.idempotencyKey,
			program: planned.program,
			registry,
			principal: request.security.principal,
			access: request.security.access,
			authorizer,
			factories,
			...(instances && { instances }),
			artifacts,
			parameters: request.parameters,
			...(resource && { resource })
		})
		const output = enrichmentSpec
			? await understandingOutput(host, request, view, result.artifacts, enrichmentSpec.subject)
			: undefined
		return {
			artifactIds: result.artifacts.map((artifact) => artifact.artifactId),
			completedStepIds: result.completedStepIds,
			remainingGoals: result.remainingGoals,
			registryRevision: result.registryRevision,
			policyDecisionIds: result.policyDecisionIds,
			...(output && { output })
		}
	}
}

function assertGoalRequest(request: PlanRunStartRequest): void {
	const mode = request.goalSpec?.mode ?? 'exact'
	if (mode === 'explore' && request.goals.length > 0) {
		throw new Error('exploration cannot include exact goals')
	}
	if (mode === 'exact' && request.goals.length === 0) {
		throw new Error('exact execution requires at least one goal')
	}
	const subject = request.goalSpec && 'subject' in request.goalSpec && request.goalSpec.subject
	if (!subject) return
	if (!subject.artifactId) throw new Error('exploration subject requires an artifact')
	if (
		!request.ingredients.some(
			(ingredient) =>
				ingredient.predicate === subject.predicate && ingredient.artifactId === subject.artifactId
		)
	) {
		throw new Error('exploration subject is not an admitted ingredient')
	}
}

async function understandingOutput(
	host: ActorExecutionHost,
	request: PlanRunStartRequest,
	view: Awaited<ReturnType<typeof authorizeRegistryForPlanning>>,
	artifacts: RuntimeArtifact[],
	subject: Ingredient
): Promise<PlanRunUnderstandingOutput> {
	if (!subject.artifactId) throw new Error('exploration subject requires an artifact')
	const currentFacts: Ingredient[] = [
		...request.ingredients,
		...artifacts.map((artifact) => ({
			predicate: artifact.predicate,
			artifactId: artifact.artifactId
		}))
	]
	const [definitions, related] = await Promise.all([
		host.affordances?.(request) ?? [],
		host.relatedIngredients?.(request) ?? []
	])
	const capabilities = view.capabilities.flatMap(({ capability, targets }) =>
		targets.some((target) => target.executionEnvironment === host.executionEnvironment)
			? [capability]
			: []
	)
	const facts = uniqueIngredients([...currentFacts, ...related])
	return {
		kind: 'artifact-understanding',
		status: 'complete',
		stoppingReason: 'saturated',
		subjectArtifactId: subject.artifactId,
		facts: uniqueIngredients(currentFacts).flatMap((fact) => {
			if (!fact.artifactId) return []
			const artifact = artifacts.find((candidate) => candidate.artifactId === fact.artifactId)
			return [
				{
					predicate: fact.predicate,
					artifactId: fact.artifactId,
					...(artifact && { schema: artifact.schema })
				}
			]
		}),
		affordances: discoverAffordances(definitions, facts, capabilities)
	}
}

function uniqueIngredients(ingredients: Ingredient[]): Ingredient[] {
	const unique = new Map<string, Ingredient>()
	for (const ingredient of ingredients) {
		unique.set(`${ingredient.predicate}\0${ingredient.artifactId ?? ''}`, ingredient)
	}
	return [...unique.values()]
}

/**
 * Execute one already-authorized physical program through dynamically admitted
 * factory actors.
 *
 * This is deliberately the smallest generic executor slice: ordered steps,
 * one artifact per declared slot, factory targets, authoritative spawn/invoke
 * rechecks, atomic publication, and release after every step. Leases, fencing,
 * continuations, retries, instance targets, and wider cardinalities remain
 * explicit later slices rather than hidden test behavior.
 */
export async function executePhysicalProgram(
	request: PhysicalProgramExecutionRequest
): Promise<PhysicalProgramExecutionResult> {
	throwIfAborted(request.signal)
	assertPortableRunValue(request.parameters ?? {})
	assertPortableRunValue(request.principal)
	assertPortableRunValue(request.access)
	assertPortableRunValue(request.resource ?? {})
	if (request.registry.revision !== request.program.registryRevision) {
		throw new Error('registry snapshot does not match the physical plan')
	}
	if (request.principal.subjectId !== request.program.plannedFor.subjectId) {
		throw new Error('execution principal does not match the physical plan')
	}
	if (request.access.tenantId !== request.program.plannedFor.tenantId) {
		throw new Error('execution tenant does not match the physical plan')
	}
	const values = new Map<string, RuntimeArtifact>()
	const completedStepIds: string[] = []
	const published: RuntimeArtifact[] = []
	const policyDecisionIds = new Set<string>()
	const warnings: string[] = []

	for (const step of request.program.steps) {
		throwIfAborted(request.signal)
		policyDecisionIds.add(step.target.authorization.decisionId)
		if (step.target.executionEnvironment !== request.program.executionEnvironment) {
			throw new Error(`${step.id} target violates the frozen execution environment`)
		}
		const missingDependency = step.dependsOn.find(
			(dependency) => !completedStepIds.includes(dependency)
		)
		if (missingDependency) throw new Error(`${step.id} depends on incomplete ${missingDependency}`)
		const capability = capabilityFor(request.registry, step.capability)
		const inputs = await resolveInputs(step.inputs, values, request.artifacts)
		throwIfAborted(request.signal)
		validateSlots('input', capability.inputSlots, capability.requires, inputs)
		const inputBindings = bindInputs(capability, inputs)
		const outputs = await executeTargetStep(
			request,
			step,
			capability,
			inputBindings,
			policyDecisionIds
		)
		throwIfAborted(request.signal)
		warnings.push(...outputs.warnings)
		const publication = await request.artifacts.publish({
			publicationId: `${request.runId}:${step.id}`,
			runId: request.runId,
			stepId: step.id,
			capabilityId: step.capability as CapabilityId,
			inputs: inputBindings,
			outputs: outputs.drafts
		})
		throwIfAborted(request.signal)
		if (publication.length !== step.outputs.length) {
			throw new Error(
				`${step.capability} published ${publication.length} artifacts for ${step.outputs.length} planned outputs`
			)
		}
		for (let index = 0; index < publication.length; index += 1) {
			const artifact = publication[index]
			const planned = step.outputs[index]
			if (!artifact || !planned) throw new Error(`${step.id} omitted output ${index}`)
			assertPublishedOutput(artifact, planned, outputs.drafts[index])
			assertPortableRunValue(artifact.value)
			values.set(stepValueKey(step.id, index), artifact)
			published.push(artifact)
		}
		completedStepIds.push(step.id)
	}

	const results = await Promise.all(
		request.program.results.map((value) => resolveValue(value, values, request.artifacts))
	)
	throwIfAborted(request.signal)
	const fulfilledPredicates = results.map((artifact) => artifact.predicate)
	const remainingGoals = request.program.goals.filter(
		(goal) => !fulfilledPredicates.some((predicate) => unifiable(goal, predicate))
	)
	return {
		completedStepIds,
		artifacts: published,
		results,
		fulfilledPredicates,
		remainingGoals,
		registryRevision: request.program.registryRevision,
		policyDecisionIds: [...policyDecisionIds].sort(),
		warnings
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return
	if (signal.reason instanceof Error) throw signal.reason
	throw new Error('Execution cancelled.')
}

async function executeTargetStep(
	request: PhysicalProgramExecutionRequest,
	step: PhysicalPlanStep,
	capability: RegisteredCapability,
	inputs: RuntimeInputBinding[],
	policyDecisionIds: Set<string>
): Promise<{ drafts: RuntimeOutputDraft[]; warnings: string[] }> {
	if (step.target.kind === 'instance')
		return executeInstanceStep(request, step, capability, inputs, policyDecisionIds)
	return executeFactoryStep(request, step, capability, inputs, policyDecisionIds)
}

async function executeInstanceStep(
	request: PhysicalProgramExecutionRequest,
	step: PhysicalPlanStep,
	capability: RegisteredCapability,
	inputs: RuntimeInputBinding[],
	policyDecisionIds: Set<string>
): Promise<{ drafts: RuntimeOutputDraft[]; warnings: string[] }> {
	if (step.target.kind !== 'instance') throw new Error('invalid instance target')
	const target = step.target
	const advertised = request.registry.instances.find(
		(candidate) =>
			candidate.instanceId === target.instanceId &&
			candidate.definitionRef === target.definitionRef &&
			candidate.status === 'available' &&
			candidate.executionEnvironment === request.program.executionEnvironment &&
			candidate.capabilityIds.includes(step.capability as CapabilityId) &&
			(!candidate.expiresAt || candidate.expiresAt > request.registry.capturedAt)
	)
	if (!advertised) throw new Error(`live actor ${target.instanceId} is unavailable`)
	const actor = await request.instances?.resolve(target.instanceId)
	if (
		!actor ||
		actor.uuid !== target.instanceId ||
		definitionRef(
			actor.manifest.id,
			actor.manifest.version,
			actor.manifest.authority,
			actor.manifest.namespace
		) !== target.definitionRef ||
		!actor.handles(step.method)
	)
		throw new Error(`trusted live actor ${target.instanceId} is unavailable`)
	const decision = await request.authorizer.decide({
		action: 'invoke',
		principal: request.principal,
		access: request.access,
		definitionRef: target.definitionRef,
		capabilityId: step.capability as CapabilityId,
		method: step.method,
		target: { kind: 'instance', instanceId: target.instanceId },
		configuration: {},
		inputs: authorizationInputs(inputs),
		runId: request.runId,
		...(request.resource && { resource: request.resource })
	})
	if (!decision.allow) throw new Error(`invoke denied: ${decision.reasonCode}`)
	policyDecisionIds.add(decision.decisionId)
	const boundInputs: Record<string, ActorStepInput> = {}
	for (const input of inputs) boundInputs[input.slot] = input.artifact
	const payload: ActorStepPayload = {
		runId: request.runId,
		stepId: step.id,
		capabilityId: step.capability as CapabilityId,
		inputs: boundInputs,
		parameters: step.parameters ?? request.parameters ?? {},
		configuration: step.configuration ?? {}
	}
	assertPortableRunValue(payload)
	const response = await dispatch(actor, {
		to: actor.uuid,
		method: step.method,
		payload
	})
	const result = parseActorStepResult(response)
	return { drafts: outputDrafts(capability, step, result), warnings: result.warnings ?? [] }
}

async function executeFactoryStep(
	request: PhysicalProgramExecutionRequest,
	step: PhysicalPlanStep,
	capability: RegisteredCapability,
	inputs: RuntimeInputBinding[],
	policyDecisionIds: Set<string>
): Promise<{ drafts: RuntimeOutputDraft[]; warnings: string[] }> {
	if (step.target.kind !== 'factory') throw new Error('invalid factory target')
	const factory = request.factories.resolve(step.target.factoryId)
	if (!factory || factory.offer.offerId !== step.target.offerId) {
		throw new Error(`factory implementation is unavailable for ${step.target.offerId}`)
	}
	const spawnDecision = await request.authorizer.decide({
		action: 'spawn',
		principal: request.principal,
		access: request.access,
		definitionRef: step.target.definitionRef,
		capabilityId: step.capability as CapabilityId,
		method: step.method,
		target: {
			kind: 'factory',
			offerId: step.target.offerId,
			factoryId: step.target.factoryId
		},
		configuration: step.configuration ?? step.target.configuration,
		inputs: authorizationInputs(inputs),
		runId: request.runId,
		...(request.resource && { resource: request.resource })
	})
	if (!spawnDecision.allow) throw new Error(`spawn denied: ${spawnDecision.reasonCode}`)
	policyDecisionIds.add(spawnDecision.decisionId)

	const spawnRequest: ActorSpawnRequest = {
		requestId: `${request.runId}:${step.id}:spawn`,
		runId: request.runId,
		principal: request.principal,
		access: request.access,
		offerId: step.target.offerId,
		requestedCapabilities: [step.capability as CapabilityId],
		configuration: {
			...step.target.configuration,
			...step.configuration,
			...spawnDecision.constraints?.forcedConfiguration
		},
		inputs: authorizationInputs(inputs),
		...(request.resource && { resource: request.resource })
	}
	const admission = await factory.assess(spawnRequest)
	if (!admission.admitted) throw new Error(`factory denied: ${admission.reasonCode}`)
	if (!admission.grantedCapabilities.includes(step.capability as CapabilityId)) {
		throw new Error(`factory admission omitted ${step.capability}`)
	}
	const spawned = await factory.spawn(spawnRequest, admission)
	try {
		if (
			spawned.advertisement.definitionRef !== step.target.definitionRef ||
			spawned.advertisement.executionEnvironment !== request.program.executionEnvironment ||
			!spawned.advertisement.capabilityIds.includes(step.capability as CapabilityId)
		) {
			throw new Error(`spawned actor does not satisfy ${step.capability}`)
		}
		const invokeDecision = await request.authorizer.decide({
			action: 'invoke',
			principal: request.principal,
			access: request.access,
			definitionRef: step.target.definitionRef,
			capabilityId: step.capability as CapabilityId,
			method: step.method,
			target: { kind: 'instance', instanceId: spawned.advertisement.instanceId },
			configuration: admission.normalizedConfiguration,
			inputs: authorizationInputs(inputs),
			runId: request.runId,
			...(request.resource && { resource: request.resource })
		})
		if (!invokeDecision.allow) throw new Error(`invoke denied: ${invokeDecision.reasonCode}`)
		policyDecisionIds.add(invokeDecision.decisionId)
		const boundInputs: Record<string, ActorStepInput> = {}
		for (const input of inputs) boundInputs[input.slot] = input.artifact
		const payload: ActorStepPayload = {
			runId: request.runId,
			stepId: step.id,
			capabilityId: step.capability as CapabilityId,
			inputs: boundInputs,
			parameters: step.parameters ?? request.parameters ?? {},
			configuration: admission.normalizedConfiguration
		}
		assertPortableRunValue(payload)
		const envelope = {
			id: `${request.runId}:${step.id}:attempt-1`,
			from: `run:${request.runId}`,
			to: spawned.actor.uuid,
			method: step.method,
			payload
		}
		const response = await dispatch(spawned.actor, envelope)
		const result = parseActorStepResult(response)
		const drafts = outputDrafts(capability, step, result)
		return { drafts, warnings: result.warnings ?? [] }
	} finally {
		await spawned.release()
	}
}

function authorizationInputs(inputs: RuntimeInputBinding[]) {
	return inputs.map(({ slot, role, artifact }) => ({
		slot,
		role,
		artifactId: artifact.artifactId,
		predicate: artifact.predicate,
		schema: artifact.schema,
		typeKey: artifact.typeKey,
		schemaVersion: artifact.schemaVersion,
		contentDigest: artifact.contentDigest
	}))
}

async function dispatch(
	actor: Actor,
	envelope: {
		to: string
		method: string
		payload: Record<string, unknown>
	}
): Promise<HandlerResult> {
	if (envelope.to !== actor.uuid) throw new Error(`envelope target does not match spawned actor`)
	return actor.deliver(envelope.method, envelope.payload)
}

function parseActorStepResult(response: HandlerResult): ActorStepResult {
	const parsed = JSON.parse(response.record) as unknown
	if (typeof parsed !== 'object' || parsed === null) throw new Error(response.wire)
	const candidate = parsed as ActorStepResult | { ok?: false; error?: unknown }
	if (
		candidate.ok !== true ||
		typeof (candidate as Partial<ActorStepResult>).outputs !== 'object' ||
		!(candidate as Partial<ActorStepResult>).outputs ||
		Array.isArray((candidate as Partial<ActorStepResult>).outputs)
	) {
		throw new Error(String('error' in candidate ? candidate.error : response.wire))
	}
	if (
		candidate.warnings !== undefined &&
		(!Array.isArray(candidate.warnings) ||
			candidate.warnings.some((warning) => typeof warning !== 'string'))
	) {
		throw new Error('actor returned invalid warnings')
	}
	assertPortableRunValue(candidate)
	return candidate as ActorStepResult
}

function outputDrafts(
	capability: RegisteredCapability,
	step: PhysicalPlanStep,
	result: ActorStepResult
): RuntimeOutputDraft[] {
	validateDeclaredSlots('output', capability.outputSlots, capability.produces)
	const slots = capability.outputSlots ?? []
	const unknown = Object.keys(result.outputs).find(
		(name) => !slots.some((slot) => slot.name === name)
	)
	if (unknown) throw new Error(`${capability.id} returned undeclared output slot ${unknown}`)
	return slots.map((slot, index) => {
		if (!(slot.name in result.outputs)) throw new Error(`${capability.id} omitted ${slot.name}`)
		const predicate = step.outputs[index]?.predicate
		if (!predicate || !slot.schema)
			throw new Error(`${capability.id} has an incomplete output slot`)
		return {
			slot: slot.name,
			role: slot.role ?? slot.name,
			predicate,
			schema: slot.schema,
			value: result.outputs[slot.name]
		}
	})
}

function bindInputs(
	capability: RegisteredCapability,
	artifacts: RuntimeArtifact[]
): RuntimeInputBinding[] {
	return (capability.inputSlots ?? []).map((slot, index) => {
		const artifact = artifacts[index]
		if (!artifact) throw new Error(`${capability.id} omitted input ${slot.name}`)
		return { slot: slot.name, role: slot.role ?? slot.name, artifact }
	})
}

async function resolveInputs(
	inputs: PlanValue[],
	values: Map<string, RuntimeArtifact>,
	resolver: RuntimeArtifactResolver
): Promise<RuntimeArtifact[]> {
	return Promise.all(inputs.map((value) => resolveValue(value, values, resolver)))
}

async function resolveValue(
	value: PlanValue,
	values: Map<string, RuntimeArtifact>,
	resolver: RuntimeArtifactResolver
): Promise<RuntimeArtifact> {
	if (value.source.kind === 'step') {
		const artifact = values.get(stepValueKey(value.source.stepId, value.source.output))
		if (!artifact)
			throw new Error(`uncommitted input ${value.source.stepId}:${value.source.output}`)
		return artifact
	}
	if (!value.source.artifactId) throw new Error(`ingredient ${value.predicate} has no artifact`)
	const artifact = await resolver.resolve(value.source.artifactId, value.predicate)
	if (!artifact) throw new Error(`artifact ${value.source.artifactId} was not found`)
	if (!unifiable(value.predicate, artifact.predicate)) {
		throw new Error(`artifact ${artifact.artifactId} does not prove ${value.predicate}`)
	}
	return artifact
}

function validateSlots(
	kind: 'input' | 'output',
	slots: CapabilitySlot[] | undefined,
	predicates: Predicate[],
	artifacts: RuntimeArtifact[]
): void {
	validateDeclaredSlots(kind, slots, predicates)
	for (let index = 0; index < artifacts.length; index += 1) {
		const slot = slots?.[index]
		const artifact = artifacts[index]
		if (!slot || !artifact) throw new Error(`missing ${kind} slot ${index}`)
		if (!slot.schema || slot.schema !== artifact.schema) {
			throw new Error(`${kind} slot ${slot.name} requires schema ${slot.schema}`)
		}
		if (!unifiable(slot.predicate, artifact.predicate)) {
			throw new Error(`${kind} slot ${slot.name} does not accept ${artifact.predicate}`)
		}
	}
}

function validateDeclaredSlots(
	kind: 'input' | 'output',
	slots: CapabilitySlot[] | undefined,
	predicates: Predicate[]
): void {
	if (!slots || slots.length !== predicates.length) {
		throw new Error(`${kind} slots must bind every capability predicate`)
	}
	for (const [index, slot] of slots.entries()) {
		if (slot.cardinality !== 'one') {
			throw new Error(`${kind} slot ${slot.name} uses unsupported ${slot.cardinality} cardinality`)
		}
		if (!slot.schema) throw new Error(`${kind} slot ${slot.name} has no schema`)
		const predicate = predicates[index]
		if (!predicate || !unifiable(slot.predicate, predicate)) {
			throw new Error(`${kind} slot ${slot.name} does not bind capability predicate ${predicate}`)
		}
	}
}

function assertPublishedOutput(
	artifact: RuntimeArtifact,
	planned: PlanValue,
	draft: RuntimeOutputDraft | undefined
): void {
	if (!draft || !unifiable(planned.predicate, artifact.predicate)) {
		throw new Error(`published artifact does not prove ${planned.predicate}`)
	}
	if (artifact.schema !== draft.schema) {
		throw new Error(`published artifact does not use ${draft.schema}`)
	}
}

function capabilityFor(
	registry: ActorRegistrySnapshot,
	capabilityId: string
): RegisteredCapability {
	for (const definition of registry.definitions) {
		const capability = definition.capabilities.find((candidate) => candidate.id === capabilityId)
		if (capability) return capability
	}
	throw new Error(`planned capability ${capabilityId} is absent from registry revision`)
}

function stepValueKey(stepId: string, output: number): string {
	return `${stepId}:${output}`
}
