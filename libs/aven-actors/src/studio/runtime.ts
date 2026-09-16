import type { AuthorizedRegistryView } from '../authorization'
import type { PhysicalPlanStep, PhysicalProgram } from '../physical-planner'
import type { PlanValue } from '../planner'
import {
	parseStudioSkillParameters,
	parseStudioSkillV2,
	type StudioParameterBinding,
	type StudioPortBinding,
	type StudioSkillStep,
	type StudioSkillV2
} from './v2'

export interface StudioV2ExecutionCompileRequest {
	definition: unknown
	children?: ReadonlyMap<string, StudioSkillV2>
	view: AuthorizedRegistryView
	executionEnvironment: 'local' | 'server'
	inputs: Record<string, string>
	parameters?: Record<string, unknown>
}

/**
 * Compile an explicitly authored finite Skill into the generic physical executor.
 * No capability search or Studio-specific implementation dispatch occurs here.
 */
export function compileStudioSkillV2Execution(
	request: StudioV2ExecutionCompileRequest
): PhysicalProgram {
	const root = parseStudioSkillV2(request.definition)
	const parameters = parseStudioSkillParameters(root, request.parameters ?? {})
	const state: CompileState = {
		view: request.view,
		environment: request.executionEnvironment,
		children: request.children ?? new Map(),
		steps: [],
		completions: new Map(),
		invocations: 0,
		members: 0,
		policy: root.policy
	}
	const boundary = new Map<string, PlanValue>()
	const expected = Object.keys(root.inputs)
	if (
		Object.keys(request.inputs).length !== expected.length ||
		expected.some((name) => typeof request.inputs[name] !== 'string')
	)
		throw new Error('STUDIO_INPUT_BINDINGS_INVALID')
	for (const [name, port] of Object.entries(root.inputs))
		boundary.set(name, {
			predicate: port.predicate,
			source: { kind: 'ingredient', artifactId: request.inputs[name] }
		})
	const outputs = compileDefinition(state, root, boundary, parameters, 'root', 1)
	const results = Object.keys(root.outputs).map((name) => {
		const value = outputs.get(name)
		if (!value) throw new Error(`STUDIO_OUTPUT_UNAVAILABLE:${name}`)
		return value
	})
	return {
		goals: results.map((value) => value.predicate),
		steps: state.steps,
		totalCost: state.steps.reduce((total, step) => total + step.cost, 0),
		results,
		registryRevision: request.view.registryRevision,
		plannedFor: {
			subjectId: request.view.principal.subjectId,
			...(request.view.access.tenantId && { tenantId: request.view.access.tenantId })
		},
		executionEnvironment: request.executionEnvironment
	}
}

interface CompileState {
	view: AuthorizedRegistryView
	environment: 'local' | 'server'
	children: ReadonlyMap<string, StudioSkillV2>
	steps: PhysicalPlanStep[]
	completions: Map<string, string[]>
	invocations: number
	members: number
	policy: StudioSkillV2['policy']
}

function compileDefinition(
	state: CompileState,
	definition: StudioSkillV2,
	boundary: Map<string, PlanValue>,
	parameters: Record<string, unknown>,
	prefix: string,
	depth: number
): Map<string, PlanValue> {
	if (depth > state.policy.maxDepth) throw new Error('STUDIO_DEPTH_LIMIT')
	const known = new Map<string, PlanValue>()
	for (const [name, value] of boundary) known.set(`input:${name}`, value)
	compileBody(state, definition.steps, known, parameters, prefix, depth)
	return new Map(
		Object.entries(definition.outputs).map(([name, output]) => [name, resolve(output.from, known)])
	)
}

function compileBody(
	state: CompileState,
	steps: StudioSkillStep[],
	known: Map<string, PlanValue>,
	parameters: Record<string, unknown>,
	prefix: string,
	depth: number
): void {
	for (const step of steps) {
		state.members++
		if (state.members > state.policy.maxMembers) throw new Error('STUDIO_MEMBER_LIMIT')
		if (step.kind === 'invoke') {
			compileInvocation(state, step, known, parameters, prefix)
			continue
		}
		if (step.kind === 'skill') {
			const startedAt = state.steps.length
			const child = state.children.get(step.skillArtifactId)
			if (!child) throw new Error(`STUDIO_CHILD_UNAVAILABLE:${step.skillArtifactId}`)
			const childBoundary = new Map(
				Object.entries(step.inputs).map(([name, binding]) => [name, resolve(binding, known)])
			)
			const childParameters = Object.fromEntries(
				Object.entries(step.parameters).map(([name, binding]) => [
					name,
					parameterValue(binding, parameters)
				])
			)
			const outputs = compileDefinition(
				state,
				child,
				childBoundary,
				parseStudioSkillParameters(child, childParameters),
				`${prefix}.${step.id}`,
				depth + 1
			)
			for (const [name, value] of outputs) known.set(`step:${step.id}:${name}`, value)
			state.completions.set(`${prefix}.${step.id}`, terminalSteps(state.steps.slice(startedAt)))
			continue
		}
		if (step.kind === 'when' && step.condition.kind === 'presence') {
			const startedAt = state.steps.length
			const present = step.condition.from.kind !== 'none'
			const branch = step.branches[present ? 'present' : 'absent']
			if (!branch) throw new Error('STUDIO_BRANCH_UNAVAILABLE')
			const branchKnown = new Map(known)
			compileBody(state, branch.steps, branchKnown, parameters, `${prefix}.${step.id}`, depth + 1)
			for (const [name, binding] of Object.entries(branch.outputs))
				known.set(`step:${step.id}:${name}`, resolve(binding, branchKnown))
			state.completions.set(`${prefix}.${step.id}`, terminalSteps(state.steps.slice(startedAt)))
			continue
		}
		throw new Error(`STUDIO_RUNTIME_FEATURE_UNAVAILABLE:${step.kind}`)
	}
}

function compileInvocation(
	state: CompileState,
	step: Extract<StudioSkillStep, { kind: 'invoke' }>,
	known: Map<string, PlanValue>,
	parameters: Record<string, unknown>,
	prefix: string
): void {
	state.invocations++
	if (state.invocations > state.policy.maxInvocations) throw new Error('STUDIO_INVOCATION_LIMIT')
	const authorized = state.view.capabilities.find(
		(candidate) => candidate.capability.id === step.capabilityId
	)
	const target = authorized?.targets.find(
		(candidate) => candidate.executionEnvironment === state.environment
	)
	if (!authorized || !target)
		throw new Error(`STUDIO_CAPABILITY_NOT_EXECUTABLE:${step.capabilityId}`)
	const capability = authorized.capability
	const inputSlots = capability.inputSlots ?? []
	const outputSlots = capability.outputSlots ?? []
	if ([...inputSlots, ...outputSlots].some((slot) => slot.cardinality !== 'one'))
		throw new Error('STUDIO_RUNTIME_CARDINALITY_UNAVAILABLE')
	const id = `${prefix}.${step.id}`
	const inputs = inputSlots.map((slot) => {
		const binding = step.inputs[slot.name]
		if (!binding) throw new Error(`STUDIO_INPUT_UNAVAILABLE:${step.id}.${slot.name}`)
		return resolve(binding, known)
	})
	const outputs = outputSlots.map((slot, output) => {
		const declared = step.outputs[slot.name]
		if (!declared) throw new Error(`STUDIO_OUTPUT_UNAVAILABLE:${step.id}.${slot.name}`)
		return {
			predicate: declared.predicate,
			source: { kind: 'step' as const, stepId: id, output }
		}
	})
	const dependencies = new Set<string>()
	for (const dependency of step.after ?? []) {
		const completed = state.completions.get(`${prefix}.${dependency}`)
		if (!completed) throw new Error(`STUDIO_DEPENDENCY_UNAVAILABLE:${dependency}`)
		for (const physicalStepId of completed) dependencies.add(physicalStepId)
	}
	for (const value of inputs)
		if (value.source.kind === 'step') dependencies.add(value.source.stepId)
	state.steps.push({
		id,
		capability: capability.id,
		actor: capability.actor,
		method: capability.method,
		inputs,
		outputs,
		dependsOn: [...dependencies],
		cost: capability.cost ?? 1,
		target,
		parameters: Object.fromEntries(
			Object.entries(step.parameters).map(([name, binding]) => [
				name,
				parameterValue(binding, parameters)
			])
		),
		configuration: Object.fromEntries(
			Object.entries(step.configuration ?? {}).map(([name, binding]) => [
				name,
				parameterValue(binding, parameters)
			])
		)
	})
	state.completions.set(id, [id])
	for (const [index, slot] of outputSlots.entries()) {
		const value = outputs[index]
		if (value) known.set(`step:${step.id}:${slot.name}`, value)
	}
}

function terminalSteps(steps: PhysicalPlanStep[]): string[] {
	if (!steps.length) return []
	const dependedOn = new Set(steps.flatMap((step) => step.dependsOn))
	return steps.map((step) => step.id).filter((id) => !dependedOn.has(id))
}

function resolve(binding: StudioPortBinding, known: Map<string, PlanValue>): PlanValue {
	if (binding.kind === 'none') throw new Error('STUDIO_OPTIONAL_VALUE_ABSENT')
	if (binding.kind === 'item') throw new Error('STUDIO_ITEM_OUTSIDE_COLLECTION')
	const key =
		binding.kind === 'input' ? `input:${binding.port}` : `step:${binding.stepId}:${binding.port}`
	const value = known.get(key)
	if (!value) throw new Error(`STUDIO_BINDING_UNAVAILABLE:${key}`)
	return value
}

function parameterValue(
	binding: StudioParameterBinding,
	parameters: Record<string, unknown>
): unknown {
	if (binding.kind === 'literal') return structuredClone(binding.value)
	if (!Object.hasOwn(parameters, binding.name))
		throw new Error(`STUDIO_PARAMETER_UNAVAILABLE:${binding.name}`)
	return structuredClone(parameters[binding.name])
}
