import {
	type ActorAccessContext,
	type ActorAuthorizer,
	type ActorPrincipal,
	ActorRegistry,
	type CapabilityId,
	parseStudioSkillV2,
	STUDIO_SKILL_ARTIFACT_VERSION,
	type StudioSkillV2,
	type StudioSkillV2Issue,
	studioSkillChildReferences,
	type TrustedActorInstallations,
	validateStudioSkillCapabilities,
	validateStudioSkillChildren
} from '@avenos/actors'
import type { StudioArtifact } from './studio-artifacts.js'

export interface StudioV2ValidationAuthority {
	principal: ActorPrincipal
	access: ActorAccessContext
	actorAuthorizer: ActorAuthorizer
	resolveReadableSkill(artifactId: string): Promise<StudioArtifact>
}

export interface StudioV2ValidationResult {
	definition: StudioSkillV2
	children: Map<string, StudioSkillV2>
	childArtifacts: Map<string, StudioArtifact>
	issues: StudioSkillV2Issue[]
}

/** Pure contract/authority admission shared by preview and immutable publication. */
export class StudioV2SkillValidator {
	constructor(
		readonly scope: string,
		readonly installations: TrustedActorInstallations
	) {}

	async validate(
		raw: unknown,
		authority: StudioV2ValidationAuthority
	): Promise<StudioV2ValidationResult> {
		const definition = parseStudioSkillV2(raw)
		const children = new Map<string, StudioSkillV2>()
		const childArtifacts = new Map<string, StudioArtifact>()
		const pending = studioSkillChildReferences(definition)
		while (pending.length) {
			const id = pending.shift()!
			if (children.has(id)) continue
			if (children.size >= 64) throw new Error('STUDIO_CHILD_LIMIT')
			const artifact = await authority.resolveReadableSkill(id)
			assertExactV2Skill(artifact, id, this.scope)
			const child = parseStudioSkillV2(artifact.payload)
			children.set(id, child)
			childArtifacts.set(id, artifact)
			pending.push(...studioSkillChildReferences(child))
		}
		const issues = validateStudioSkillChildren(definition, children)
		for (const [id, child] of children)
			issues.push(...prefix(validateStudioSkillChildren(child, children, id), `children.${id}`))
		const registry = new ActorRegistry()
		for (const installation of this.installations.list())
			registry.registerDefinition(installation.definition)
		const snapshot = registry.snapshot()
		const inventory = new Map(
			this.installations.inventory().map((entry) => [entry.capabilityId, entry])
		)
		const modelCapabilities = new Set(
			this.installations
				.list()
				.flatMap((installation) =>
					installation.descriptor.procedures
						.filter((procedure) => procedure.requiredFeatures.includes('model'))
						.map((procedure) => procedure.capabilityId)
				)
		)
		const storeTypes = new Map(
			this.installations
				.list()
				.flatMap((installation) =>
					installation.descriptor.schemas.map(
						(binding) =>
							[binding.schema, { key: binding.typeKey, version: binding.typeVersion }] as const
					)
				)
		)
		for (const [bodyPath, body] of [
			['definition', definition] as const,
			...[...children.entries()].map(([id, child]) => [`children.${id}`, child] as const)
		]) {
			if (!body.policy.allowModel) {
				const requirement = modelRequirement(body, children, modelCapabilities)
				if (requirement)
					issues.push({
						path: `${bodyPath}.policy.allowModel`,
						code: 'MODEL_POLICY_REQUIRED',
						message: `Skill "${body.name}" disables model access, but "${requirement.skill}" uses ${requirement.capability}. Enable allowModel on every containing Skill, or replace that operation with a deterministic one. No model was run.`
					})
			}
			issues.push(...prefix(validateRuntimeSurface(body), bodyPath))
			issues.push(...prefix(validateInstalledStoreTypes(body, storeTypes), bodyPath))
			issues.push(...prefix(validateStudioSkillCapabilities(body, snapshot), bodyPath))
			for (const capabilityId of invokedCapabilities(body)) {
				const installed = inventory.get(capabilityId)
				if (!installed || installed.disposition === 'contract-incomplete') {
					issues.push({
						path: `${bodyPath}.steps`,
						code: 'INSTALLATION_INCOMPLETE',
						message: 'Selected Actor lacks a trusted Store/procedure installation.'
					})
					continue
				}
				const actor = snapshot.definitions.find((item) => item.ref === installed.actorId)
				const capability = actor?.capabilities.find((item) => item.id === capabilityId)
				const decision = await authority.actorAuthorizer.decide({
					action: 'discover',
					principal: authority.principal,
					access: authority.access,
					definitionRef: installed.actorId,
					capabilityId,
					method: capability?.method
				})
				if (!decision.allow)
					issues.push({
						path: `${bodyPath}.steps`,
						code: 'CAPABILITY_UNAVAILABLE',
						message: 'Selected Actor is unavailable for this subject.'
					})
			}
		}
		return { definition, children, childArtifacts, issues }
	}
}

/** Policies intersect at runtime: a permissive child cannot override its parent. */
function modelRequirement(
	body: StudioSkillV2,
	children: ReadonlyMap<string, StudioSkillV2>,
	modelCapabilities: ReadonlySet<string>,
	seen = new Set<string>()
): { skill: string; capability: string } | undefined {
	const capability = invokedCapabilities(body).find((id) => modelCapabilities.has(id))
	if (capability) return { skill: body.name, capability }
	for (const id of studioSkillChildReferences(body)) {
		if (seen.has(id)) continue
		seen.add(id)
		const child = children.get(id)
		if (!child) continue
		const requirement = modelRequirement(child, children, modelCapabilities, seen)
		if (requirement) return requirement
	}
}

function validateRuntimeSurface(definition: StudioSkillV2): StudioSkillV2Issue[] {
	const issues: StudioSkillV2Issue[] = []
	const walk = (steps: StudioSkillV2['steps'], path: string) => {
		for (const [index, step] of steps.entries()) {
			const at = `${path}.${index}`
			if (
				step.kind === 'achieve' ||
				(step.kind === 'review' && Object.keys(step.outputs).length > 0) ||
				(step.kind === 'forEach' && step.failureMode !== 'fail-fast')
			)
				issues.push({
					path: at,
					code: 'RUNTIME_FEATURE_UNAVAILABLE',
					message: `${step.kind} can be inspected and edited, but this runtime cannot execute it yet.`
				})
			if (step.kind === 'when')
				for (const [name, branch] of Object.entries(step.branches))
					walk(branch.steps, `${at}.branches.${name}.steps`)
		}
	}
	walk(definition.steps, 'steps')
	return issues
}

function validateInstalledStoreTypes(
	definition: StudioSkillV2,
	bindings: ReadonlyMap<string, { key: string; version: number }>
): StudioSkillV2Issue[] {
	const issues: StudioSkillV2Issue[] = []
	const check = (
		path: string,
		port: { schema: string; type: { key: string; version: number } }
	) => {
		const installed = bindings.get(port.schema)
		if (installed && (installed.key !== port.type.key || installed.version !== port.type.version))
			issues.push({
				path,
				code: 'STORE_TYPE_MISMATCH',
				message: 'Artifact type differs from the trusted schema installation.'
			})
	}
	for (const [name, port] of Object.entries(definition.inputs)) check(`inputs.${name}`, port)
	for (const [name, port] of Object.entries(definition.outputs)) check(`outputs.${name}`, port)
	const walk = (steps: StudioSkillV2['steps'], path: string) => {
		for (const [index, step] of steps.entries()) {
			const at = `${path}.${index}`
			for (const [name, port] of Object.entries(step.outputs)) check(`${at}.outputs.${name}`, port)
			if (step.kind === 'when')
				for (const [name, branch] of Object.entries(step.branches))
					walk(branch.steps, `${at}.branches.${name}.steps`)
		}
	}
	walk(definition.steps, 'steps')
	return issues
}

export function assertExactV2Skill(
	artifact: StudioArtifact,
	expectedId: string,
	scope: string
): void {
	if (
		artifact.artifactId !== expectedId ||
		artifact.scopeId !== scope ||
		artifact.typeKey !== 'studio.skill' ||
		artifact.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION ||
		!/^[0-9a-f]{64}$/.test(artifact.artifactSha256)
	)
		throw new Error('EXACT_SKILL_UNAVAILABLE')
}

function prefix(issues: StudioSkillV2Issue[], path: string): StudioSkillV2Issue[] {
	return issues.map((issue) => ({ ...issue, path: `${path}.${issue.path}` }))
}

function invokedCapabilities(definition: StudioSkillV2): CapabilityId[] {
	const walk = (body: StudioSkillV2['steps']): CapabilityId[] =>
		body.flatMap((step) =>
			step.kind === 'invoke'
				? [step.capabilityId as CapabilityId]
				: step.kind === 'when'
					? Object.values(step.branches).flatMap((branch) => walk(branch.steps))
					: []
		)
	return [...new Set(walk(definition.steps))]
}
