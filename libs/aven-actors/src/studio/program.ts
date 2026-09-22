import {
	parseStudioSkillParameters,
	parseStudioSkillV2,
	type StudioParameterBinding,
	type StudioPortBinding,
	type StudioSkillPort,
	type StudioSkillStep,
	type StudioSkillV2
} from './v2'

export interface StudioProgramArtifact {
	artifactId: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
}
export type StudioProgramValues = Record<string, StudioProgramArtifact[]>
export interface StudioProgramHost {
	read(id: string): Promise<StudioProgramArtifact>
	/** A host-owned review gate; returning means a durable verified decision exists. */
	review?(request: {
		id: string
		step: Extract<StudioSkillStep, { kind: 'review' }>
		subjects: StudioProgramValues
	}): Promise<void>
	/** The host reauthorizes, invokes and atomically publishes named results before returning. */
	invoke(request: {
		id: string
		step: Extract<StudioSkillStep, { kind: 'invoke' }>
		inputs: StudioProgramValues
		parameters: Record<string, unknown>
		configuration: Record<string, unknown>
		allowModel: boolean
		maxMembers: number
	}): Promise<StudioProgramValues>
}

/** Bounded, typed control flow over committed occurrences; no Actor-specific dispatch. */
export async function executeStudioProgram(request: {
	definition: StudioSkillV2
	children: ReadonlyMap<string, StudioSkillV2>
	inputs: Record<string, string | string[] | null>
	parameters: Record<string, unknown>
	host: StudioProgramHost
	signal?: AbortSignal
}) {
	const root = parseStudioSkillV2(request.definition)
	const completedStepIds: string[] = [],
		artifacts: StudioProgramArtifact[] = []
	type Frame = {
		policy: StudioSkillV2['policy']
		invocations: number
		members: number
		depth: number
	}
	const frames: Frame[] = []
	const checkAbort = () => request.signal?.throwIfAborted()
	const charge = (kind: 'invocations' | 'members', count = 1) => {
		for (const frame of frames) {
			frame[kind] += count
			const limit = kind === 'invocations' ? frame.policy.maxInvocations : frame.policy.maxMembers
			if (frame[kind] > limit) throw Error(`STUDIO_${kind.toUpperCase()}_LIMIT`)
		}
	}
	const resolve = (
		binding: StudioPortBinding,
		known: Map<string, StudioProgramArtifact[]>
	): StudioProgramArtifact[] => {
		if (binding.kind === 'none') return []
		const key =
			binding.kind === 'input'
				? `input:${binding.port}`
				: binding.kind === 'item'
					? `item:${binding.loopId}`
					: `step:${binding.stepId}:${binding.port}`
		const value = known.get(key)
		if (!value) throw Error(`STUDIO_BINDING_UNAVAILABLE:${key}`)
		return value
	}
	const bind = (
		bindings: Record<string, StudioPortBinding>,
		known: Map<string, StudioProgramArtifact[]>
	) =>
		Object.fromEntries(
			Object.entries(bindings).map(([name, binding]) => [name, resolve(binding, known)])
		)
	async function body(
		steps: StudioSkillStep[],
		known: Map<string, StudioProgramArtifact[]>,
		parameters: Record<string, unknown>,
		prefix: string,
		depth: number
	): Promise<void> {
		for (const step of steps) {
			checkAbort()
			const id = `${prefix}.${step.id}`
			let outputs: StudioProgramValues
			if (step.kind === 'invoke') {
				charge('invocations')
				outputs = await request.host.invoke({
					id,
					step,
					inputs: bind(step.inputs, known),
					parameters: parameterValues(step.parameters, parameters, bind(step.inputs, known)),
					configuration: parameterValues(
						step.configuration ?? {},
						parameters,
						bind(step.inputs, known)
					),
					allowModel: frames.every((f) => f.policy.allowModel),
					maxMembers: Math.min(...frames.map((f) => f.policy.maxMembers))
				})
				checkAbort()
				artifacts.push(...Object.values(outputs).flat())
			} else if (step.kind === 'review') {
				if (!request.host.review || Object.keys(step.outputs).length)
					throw Error('STUDIO_REVIEW_UNAVAILABLE')
				charge('invocations')
				await request.host.review({ id, step, subjects: bind(step.subjects, known) })
				checkAbort()
				outputs = {}
			} else if (step.kind === 'skill') {
				const child = request.children.get(step.skillArtifactId)
				if (!child) throw Error('STUDIO_CHILD_UNAVAILABLE')
				outputs = await run(
					child,
					bind(step.inputs, known),
					parameterValues(step.parameters, parameters, bind(step.inputs, known)),
					id,
					depth + 1
				)
			} else if (step.kind === 'forEach') {
				if (step.failureMode !== 'fail-fast') throw Error('STUDIO_COLLECT_FAILURES_UNAVAILABLE')
				const child = request.children.get(step.childSkillArtifactId)
				if (!child) throw Error('STUDIO_CHILD_UNAVAILABLE')
				outputs = Object.fromEntries(Object.keys(step.outputs).map((name) => [name, []]))
				const collection = [...resolve(step.collection, known)]
				charge('members', collection.length)
				// Serial admission respects every declared concurrency ceiling and keeps order stable.
				for (const [index, item] of collection.entries()) {
					checkAbort()
					const scope = new Map(known).set(`item:${step.id}`, [item])
					const result = await run(
						child,
						bind(step.childInputs, scope),
						{},
						`${id}.${index}`,
						depth + 1
					)
					for (const name of Object.keys(outputs)) outputs[name]!.push(...result[name]!)
				}
			} else if (step.kind === 'when') {
				const value = resolve(step.condition.from, known)
				const branchName =
					step.condition.kind === 'presence'
						? value.length
							? 'present'
							: 'absent'
						: readPointer(value[0]?.payload, step.condition.path) === step.condition.equals
							? step.condition.caseId
							: 'otherwise'
				const branch = step.branches[branchName]
				if (!branch) throw Error('STUDIO_BRANCH_UNAVAILABLE')
				const scope = new Map(known)
				await body(branch.steps, scope, parameters, `${id}.${branchName}`, depth)
				outputs = bind(branch.outputs, scope)
			} else throw Error(`STUDIO_RUNTIME_FEATURE_UNAVAILABLE:${step.kind}`)
			checkStudioPortValues(
				step.outputs,
				outputs,
				Math.min(...frames.map((f) => f.policy.maxMembers))
			)
			for (const [name, values] of Object.entries(outputs))
				known.set(`step:${step.id}:${name}`, values)
			completedStepIds.push(id)
		}
	}
	async function run(
		definition: StudioSkillV2,
		inputs: StudioProgramValues,
		parameters: Record<string, unknown>,
		prefix: string,
		depth: number
	): Promise<StudioProgramValues> {
		if (depth > root.policy.maxDepth || frames.some((f) => depth - f.depth + 1 > f.policy.maxDepth))
			throw Error('STUDIO_DEPTH_LIMIT')
		checkStudioPortValues(definition.inputs, inputs, definition.policy.maxMembers)
		const frame: Frame = { policy: definition.policy, invocations: 0, members: 0, depth }
		frames.push(frame)
		try {
			const known = new Map(
				Object.entries(inputs).map(([name, values]) => [`input:${name}`, values])
			)
			await body(
				definition.steps,
				known,
				parseStudioSkillParameters(definition, parameters),
				prefix,
				depth
			)
			const output = Object.fromEntries(
				Object.entries(definition.outputs).map(([name, port]) => [name, resolve(port.from, known)])
			)
			checkStudioPortValues(definition.outputs, output, definition.policy.maxMembers)
			return output
		} finally {
			frames.pop()
		}
	}
	const inputs: StudioProgramValues = {}
	if (Object.keys(request.inputs).some((name) => !Object.hasOwn(root.inputs, name)))
		throw Error('STUDIO_INPUT_BINDINGS_INVALID')
	for (const [name, port] of Object.entries(root.inputs)) {
		const binding = request.inputs[name]
		const ids = binding == null ? [] : typeof binding === 'string' ? [binding] : binding
		if (
			!Array.isArray(ids) ||
			ids.length > root.policy.maxMembers ||
			ids.some((id) => typeof id !== 'string')
		)
			throw Error('STUDIO_INPUT_BINDINGS_INVALID')
		inputs[name] = []
		for (const id of ids) {
			checkAbort()
			inputs[name]!.push(await request.host.read(id))
		}
	}
	const outputs = await run(root, inputs, request.parameters, 'root', 1)
	return { outputs, completedStepIds, artifacts }
}

export function checkStudioPortValues(
	ports: Record<string, StudioSkillPort>,
	values: StudioProgramValues,
	maximum = 256
): void {
	if (Object.keys(values).some((name) => !Object.hasOwn(ports, name)))
		throw Error('STUDIO_UNDECLARED_PORT')
	for (const [name, port] of Object.entries(ports)) {
		const members = values[name]
		if (
			!Array.isArray(members) ||
			(port.cardinality === 'one' && members.length !== 1) ||
			(port.cardinality === 'optional' && members.length > 1) ||
			members.length > maximum
		)
			throw Error(`STUDIO_PORT_CARDINALITY:${name}`)
		if (members.some((a) => a.typeKey !== port.type.key || a.typeVersion !== port.type.version))
			throw Error(`STUDIO_PORT_TYPE:${name}`)
	}
}

function parameterValues(
	bindings: Record<string, StudioParameterBinding>,
	values: Record<string, unknown>,
	inputs: StudioProgramValues
) {
	return Object.fromEntries(
		Object.entries(bindings).flatMap(([name, binding]) => {
			if (binding.kind === 'input-field') {
				const members = inputs[binding.port]
				if (members?.length !== 1) throw Error('STUDIO_FIELD_NEEDS_ONE_INPUT:' + binding.port)
				const value = readPointer(members[0]!.payload, binding.path)
				if (value === undefined) throw Error('STUDIO_INPUT_FIELD_MISSING:' + binding.path)
				return [[name, structuredClone(value)]]
			}
			if (binding.kind === 'parameter' && !Object.hasOwn(values, binding.name)) return []
			return [
				[name, structuredClone(binding.kind === 'literal' ? binding.value : values[binding.name])]
			]
		})
	)
}
function readPointer(value: unknown, pointer: string): unknown {
	for (const part of pointer.slice(1).split('/')) {
		const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
		if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
		value = (value as Record<string, unknown>)[key]
	}
	return value
}
