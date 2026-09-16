import type { ActorRegistrySnapshot } from '../registry'

export interface StudioSkillPort {
	schema: string
	type: { key: string; version: number }
	predicate: string
	role: string
	cardinality: 'one' | 'optional' | 'many'
}

export type StudioPortBinding =
	| { kind: 'input'; port: string }
	| { kind: 'step'; stepId: string; port: string }
	| { kind: 'item'; loopId: string }
	| { kind: 'none' }

export type StudioParameterBinding =
	| { kind: 'literal'; value: unknown }
	| { kind: 'parameter'; name: string }

interface StudioStepBase {
	id: string
	label: string
	after?: string[]
}

export type StudioSkillStep = StudioStepBase &
	(
		| {
				kind: 'invoke'
				capabilityId: string
				inputs: Record<string, StudioPortBinding>
				parameters: Record<string, StudioParameterBinding>
				configuration?: Record<string, StudioParameterBinding>
				outputs: Record<string, StudioSkillPort>
		  }
		| {
				kind: 'skill'
				skillArtifactId: string
				skillVersion: 2
				inputs: Record<string, StudioPortBinding>
				parameters: Record<string, StudioParameterBinding>
				outputs: Record<string, StudioSkillPort>
		  }
		| {
				kind: 'achieve'
				goals: string[]
				ingredients: StudioPortBinding[]
				factFamilies: string[]
				excludedCapabilityIds: string[]
				outputs: Record<string, StudioSkillPort>
		  }
		| {
				kind: 'review'
				subjectSchema: string
				subjects: Record<string, StudioPortBinding>
				outputs: Record<string, StudioSkillPort>
		  }
		| {
				kind: 'forEach'
				collection: StudioPortBinding
				itemName: string
				childSkillArtifactId: string
				childInputs: Record<string, StudioPortBinding>
				concurrency: number
				failureMode: 'fail-fast' | 'collect-results'
				outputs: Record<string, StudioSkillPort>
		  }
		| {
				kind: 'when'
				condition:
					| { kind: 'presence'; from: StudioPortBinding }
					| { kind: 'observation'; from: StudioPortBinding; caseId: string }
				branches: Record<
					string,
					{ steps: StudioSkillStep[]; outputs: Record<string, StudioPortBinding> }
				>
				outputs: Record<string, StudioSkillPort>
		  }
	)

export interface StudioSkillV2 {
	version: 2
	name: string
	inputs: Record<string, StudioSkillPort>
	parametersSchema: Record<string, unknown>
	steps: StudioSkillStep[]
	outputs: Record<string, StudioSkillPort & { from: StudioPortBinding }>
	policy: {
		maxInvocations: number
		maxDepth: number
		maxMembers: number
		maxConcurrentChildren: number
		allowModel: boolean
	}
}

export interface StudioSkillV2Issue {
	path: string
	code: string
	message: string
}

export class StudioSkillV2Error extends Error {
	constructor(readonly issues: StudioSkillV2Issue[]) {
		super(issues.map((issue) => issue.message).join(' '))
		this.name = 'StudioSkillV2Error'
	}
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const name = /^[a-z][a-z0-9_-]{0,63}$/
const typeKey = /^[a-z][a-z0-9.-]{0,127}$/
const capabilityId =
	/^[a-z0-9][a-z0-9._-]*:capability:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9._+-]*$/

function fail(path: string, message: string, code = 'INVALID_PROGRAM'): never {
	throw new StudioSkillV2Error([{ path, code, message }])
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return fail(path, `${path} must be an object.`)
	return value as Record<string, unknown>
}

function closed(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	if (Object.keys(value).some((key) => !keys.includes(key))) fail(path, `Unknown field in ${path}.`)
}

function identifier(value: unknown, path: string): string {
	if (
		typeof value !== 'string' ||
		!name.test(value) ||
		['constructor', 'prototype', '__proto__'].includes(value)
	)
		return fail(path, `Invalid name at ${path}.`)
	return value
}

function shortText(value: unknown, path: string, max = 160): string {
	if (typeof value !== 'string' || !value.trim() || value.length > max)
		return fail(path, `A short label is required at ${path}.`)
	return value
}

function qualifiedCapability(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length > 256 || !capabilityId.test(value))
		return fail(path, 'Select an exact qualified capability ID.')
	return value
}

function positiveInteger(value: unknown, path: string, max: number): number {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max)
		return fail(path, `${path} must be between 1 and ${max}.`)
	return value as number
}

function named<T>(
	value: unknown,
	path: string,
	max: number,
	parse: (item: unknown, path: string) => T
): Record<string, T> {
	const entries = Object.entries(object(value, path))
	if (entries.length > max) fail(path, `Too many entries at ${path}.`)
	return Object.fromEntries(
		entries.map(([key, item]) => [identifier(key, path), parse(item, `${path}.${key}`)])
	)
}

function port(value: unknown, path: string): StudioSkillPort {
	const item = object(value, path)
	closed(item, ['schema', 'type', 'predicate', 'role', 'cardinality'], path)
	const type = object(item.type, `${path}.type`)
	closed(type, ['key', 'version'], `${path}.type`)
	if (
		typeof item.schema !== 'string' ||
		!item.schema.trim() ||
		item.schema.length > 160 ||
		typeof type.key !== 'string' ||
		!typeKey.test(type.key) ||
		typeof item.predicate !== 'string' ||
		!item.predicate.trim() ||
		item.predicate.length > 256 ||
		!['one', 'optional', 'many'].includes(String(item.cardinality))
	)
		return fail(path, 'Port needs a canonical schema, artifact type, predicate and cardinality.')
	return {
		schema: item.schema,
		type: { key: type.key, version: positiveInteger(type.version, `${path}.type.version`, 10000) },
		predicate: item.predicate,
		role: identifier(item.role, `${path}.role`),
		cardinality: item.cardinality as StudioSkillPort['cardinality']
	}
}

function binding(value: unknown, path: string): StudioPortBinding {
	const item = object(value, path)
	if (item.kind === 'input') {
		closed(item, ['kind', 'port'], path)
		return { kind: 'input', port: identifier(item.port, path) }
	}
	if (item.kind === 'step') {
		closed(item, ['kind', 'stepId', 'port'], path)
		return {
			kind: 'step',
			stepId: identifier(item.stepId, path),
			port: identifier(item.port, path)
		}
	}
	if (item.kind === 'item') {
		closed(item, ['kind', 'loopId'], path)
		return { kind: 'item', loopId: identifier(item.loopId, path) }
	}
	if (item.kind === 'none') {
		closed(item, ['kind'], path)
		return { kind: 'none' }
	}
	return fail(path, 'Unknown port binding.')
}

function publicLiteral(value: unknown, path: string, depth = 0): unknown {
	if (depth > 8) fail(path, 'Literal nesting is too deep.')
	if (value === null || typeof value === 'boolean') return value
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.length <= 1024) return value
	if (Array.isArray(value) && value.length <= 64)
		return value.map((item, index) => publicLiteral(item, `${path}.${index}`, depth + 1))
	if (value && typeof value === 'object' && Object.keys(value).length <= 64)
		return named(value, path, 64, (item, at) => publicLiteral(item, at, depth + 1))
	return fail(path, 'Literal must be bounded public JSON.')
}

function parameter(value: unknown, path: string): StudioParameterBinding {
	const item = object(value, path)
	if (item.kind === 'literal') {
		closed(item, ['kind', 'value'], path)
		return { kind: 'literal', value: publicLiteral(item.value, `${path}.value`) }
	}
	if (item.kind === 'parameter') {
		closed(item, ['kind', 'name'], path)
		return { kind: 'parameter', name: identifier(item.name, path) }
	}
	return fail(path, 'Unknown parameter binding.')
}

function stringList(value: unknown, path: string, max: number): string[] {
	if (!Array.isArray(value) || value.length > max) return fail(path, 'Expected a bounded list.')
	return value.map((item, index) => shortText(item, `${path}.${index}`, 256))
}

function steps(value: unknown, path: string, max = 32, depth = 0): StudioSkillStep[] {
	if (depth > 8) fail(path, 'Branch nesting exceeds the Skill depth limit.')
	if (!Array.isArray(value) || value.length > max) return fail(path, 'Too many Skill steps.')
	const ids = new Set<string>()
	return value.map((raw, index): StudioSkillStep => {
		const at = `${path}.${index}`
		const item = object(raw, at)
		const id = identifier(item.id, `${at}.id`)
		if (ids.has(id)) fail(at, 'Step IDs must be unique.')
		ids.add(id)
		const label = shortText(item.label, `${at}.label`)
		const after = item.after === undefined ? undefined : stringList(item.after, `${at}.after`, 32)
		const base = { id, label, ...(after && { after }) }
		if (item.kind === 'invoke') {
			closed(
				item,
				[
					'id',
					'label',
					'after',
					'kind',
					'capabilityId',
					'inputs',
					'parameters',
					'configuration',
					'outputs'
				],
				at
			)
			return {
				...base,
				kind: 'invoke',
				capabilityId: qualifiedCapability(item.capabilityId, `${at}.capabilityId`),
				inputs: named(item.inputs, `${at}.inputs`, 16, binding),
				parameters: named(item.parameters, `${at}.parameters`, 16, parameter),
				...(item.configuration === undefined
					? {}
					: {
							configuration: named(item.configuration, `${at}.configuration`, 16, parameter)
						}),
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		if (item.kind === 'skill') {
			closed(
				item,
				[
					'id',
					'label',
					'after',
					'kind',
					'skillArtifactId',
					'skillVersion',
					'inputs',
					'parameters',
					'outputs'
				],
				at
			)
			if (
				typeof item.skillArtifactId !== 'string' ||
				!uuid.test(item.skillArtifactId) ||
				item.skillVersion !== 2
			)
				fail(at, 'Child must name an exact v2 Skill artifact.')
			return {
				...base,
				kind: 'skill',
				skillArtifactId: item.skillArtifactId,
				skillVersion: 2,
				inputs: named(item.inputs, `${at}.inputs`, 16, binding),
				parameters: named(item.parameters, `${at}.parameters`, 16, parameter),
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		if (item.kind === 'achieve') {
			closed(
				item,
				[
					'id',
					'label',
					'after',
					'kind',
					'goals',
					'ingredients',
					'factFamilies',
					'excludedCapabilityIds',
					'outputs'
				],
				at
			)
			if (!Array.isArray(item.ingredients) || item.ingredients.length > 16)
				fail(at, 'Too many goal ingredients.')
			return {
				...base,
				kind: 'achieve',
				goals: stringList(item.goals, `${at}.goals`, 16),
				ingredients: item.ingredients.map((value, i) => binding(value, `${at}.ingredients.${i}`)),
				factFamilies: stringList(item.factFamilies, `${at}.factFamilies`, 16),
				excludedCapabilityIds: stringList(
					item.excludedCapabilityIds,
					`${at}.excludedCapabilityIds`,
					32
				).map((value, index) => qualifiedCapability(value, `${at}.excludedCapabilityIds.${index}`)),
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		if (item.kind === 'review') {
			closed(item, ['id', 'label', 'after', 'kind', 'subjectSchema', 'subjects', 'outputs'], at)
			return {
				...base,
				kind: 'review',
				subjectSchema: shortText(item.subjectSchema, at, 160),
				subjects: named(item.subjects, `${at}.subjects`, 16, binding),
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		if (item.kind === 'forEach') {
			closed(
				item,
				[
					'id',
					'label',
					'after',
					'kind',
					'collection',
					'itemName',
					'childSkillArtifactId',
					'childInputs',
					'concurrency',
					'failureMode',
					'outputs'
				],
				at
			)
			if (
				typeof item.childSkillArtifactId !== 'string' ||
				!uuid.test(item.childSkillArtifactId) ||
				!['fail-fast', 'collect-results'].includes(String(item.failureMode))
			)
				fail(at, 'Collection child or failure mode is invalid.')
			return {
				...base,
				kind: 'forEach',
				collection: binding(item.collection, `${at}.collection`),
				itemName: identifier(item.itemName, at),
				childSkillArtifactId: item.childSkillArtifactId,
				childInputs: named(item.childInputs, `${at}.childInputs`, 16, binding),
				concurrency: positiveInteger(item.concurrency, `${at}.concurrency`, 4),
				failureMode: item.failureMode as 'fail-fast' | 'collect-results',
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		if (item.kind === 'when') {
			closed(item, ['id', 'label', 'after', 'kind', 'condition', 'branches', 'outputs'], at)
			const condition = object(item.condition, `${at}.condition`)
			if (condition.kind !== 'presence' && condition.kind !== 'observation')
				fail(at, 'Unknown branch condition.')
			closed(
				condition,
				condition.kind === 'presence' ? ['kind', 'from'] : ['kind', 'from', 'caseId'],
				at
			)
			const branch = named(item.branches, `${at}.branches`, 8, (value, branchAt) => {
				const body = object(value, branchAt)
				closed(body, ['steps', 'outputs'], branchAt)
				return {
					steps: steps(body.steps, `${branchAt}.steps`, 32, depth + 1),
					outputs: named(body.outputs, `${branchAt}.outputs`, 16, binding)
				}
			})
			if (
				condition.kind === 'presence' &&
				(Object.keys(branch).length !== 2 || !branch.present || !branch.absent)
			)
				fail(at, 'Presence branches must define present and absent.')
			if (
				condition.kind === 'observation' &&
				(Object.keys(branch).length !== 2 || !branch[String(condition.caseId)] || !branch.otherwise)
			)
				fail(at, 'Observation branches must define the selected case and otherwise.')
			return {
				...base,
				kind: 'when',
				condition:
					condition.kind === 'presence'
						? { kind: 'presence', from: binding(condition.from, at) }
						: {
								kind: 'observation',
								from: binding(condition.from, at),
								caseId: identifier(condition.caseId, at)
							},
				branches: branch,
				outputs: named(item.outputs, `${at}.outputs`, 16, port)
			}
		}
		return fail(at, 'Unsupported step kind.')
	})
}

function publicSchemaNode(value: unknown, path: string, depth = 0): Record<string, unknown> {
	if (depth > 4) fail(path, 'Public parameter schema nesting is too deep.')
	const schema = object(value, path)
	const kind = schema.type
	if (kind === 'object') {
		closed(
			schema,
			['type', 'properties', 'required', 'additionalProperties', 'maxProperties'],
			path
		)
		if (schema.additionalProperties !== false) fail(path, 'Public object schemas must be closed.')
		const properties = named(schema.properties, `${path}.properties`, 16, (item, at) =>
			publicSchemaNode(item, at, depth + 1)
		)
		const required =
			schema.required === undefined ? [] : stringList(schema.required, `${path}.required`, 16)
		if (
			required.some((name) => !Object.hasOwn(properties, name)) ||
			new Set(required).size !== required.length
		)
			fail(`${path}.required`, 'Required names must be unique declared properties.')
		if (
			schema.maxProperties !== undefined &&
			(!Number.isInteger(schema.maxProperties) ||
				Number(schema.maxProperties) < 0 ||
				Number(schema.maxProperties) > 16)
		)
			fail(`${path}.maxProperties`, 'Public objects need a bounded property limit.')
		return {
			type: 'object',
			properties,
			required,
			additionalProperties: false,
			...(schema.maxProperties === undefined ? {} : { maxProperties: schema.maxProperties })
		}
	}
	if (kind === 'array') {
		closed(schema, ['type', 'items', 'maxItems', 'minItems'], path)
		if (
			!Number.isInteger(schema.maxItems) ||
			Number(schema.maxItems) < 0 ||
			Number(schema.maxItems) > 64
		)
			fail(`${path}.maxItems`, 'Public arrays need a bounded item limit.')
		if (
			schema.minItems !== undefined &&
			(!Number.isInteger(schema.minItems) ||
				Number(schema.minItems) < 0 ||
				Number(schema.minItems) > Number(schema.maxItems))
		)
			fail(`${path}.minItems`, 'Invalid minimum item count.')
		return {
			type: 'array',
			items: publicSchemaNode(schema.items, `${path}.items`, depth + 1),
			maxItems: schema.maxItems,
			...(schema.minItems === undefined ? {} : { minItems: schema.minItems })
		}
	}
	if (kind === 'string') {
		closed(schema, ['type', 'minLength', 'maxLength', 'enum'], path)
		if (
			!Number.isInteger(schema.maxLength) ||
			Number(schema.maxLength) < 1 ||
			Number(schema.maxLength) > 1024
		)
			fail(`${path}.maxLength`, 'Public strings need a bounded length.')
		if (
			schema.minLength !== undefined &&
			(!Number.isInteger(schema.minLength) ||
				Number(schema.minLength) < 0 ||
				Number(schema.minLength) > Number(schema.maxLength))
		)
			fail(`${path}.minLength`, 'Invalid minimum string length.')
		if (
			schema.enum !== undefined &&
			(!Array.isArray(schema.enum) ||
				schema.enum.length > 32 ||
				schema.enum.some(
					(item) => typeof item !== 'string' || item.length > Number(schema.maxLength)
				))
		)
			fail(`${path}.enum`, 'Public choices must be bounded strings.')
		return structuredClone(schema)
	}
	if (kind === 'number' || kind === 'integer') {
		closed(schema, ['type', 'minimum', 'maximum', 'enum'], path)
		if (
			typeof schema.minimum !== 'number' ||
			!Number.isFinite(schema.minimum) ||
			typeof schema.maximum !== 'number' ||
			!Number.isFinite(schema.maximum) ||
			schema.minimum > schema.maximum
		)
			fail(path, 'Public numbers need finite bounds.')
		if (
			schema.enum !== undefined &&
			(!Array.isArray(schema.enum) ||
				schema.enum.length > 32 ||
				schema.enum.some((item) => typeof item !== 'number' || !Number.isFinite(item)))
		)
			fail(`${path}.enum`, 'Public numeric choices must be bounded.')
		return structuredClone(schema)
	}
	if (kind === 'boolean') {
		closed(schema, ['type'], path)
		return { type: 'boolean' }
	}
	return fail(path, 'Unsupported public parameter schema type.')
}

function parameterSchema(value: unknown): Record<string, unknown> {
	const schema = publicSchemaNode(value, 'parametersSchema')
	if (schema.type !== 'object') fail('parametersSchema', 'Public parameters need an object schema.')
	if (JSON.stringify(schema).length > 32 * 1024)
		fail('parametersSchema', 'Parameter schema is too large.')
	return schema
}

/** The same bounded public form grammar applies to installed Actor methods. */
export function parseStudioPublicParametersSchema(value: unknown): Record<string, unknown> {
	return parameterSchema(value)
}

function canonicalPublicSchema(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalPublicSchema).join(',')}]`
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalPublicSchema(item)}`)
			.join(',')}}`
	return JSON.stringify(value)
}

function matchesPublicSchema(value: unknown, schema: Record<string, unknown>): boolean {
	if (schema.type === 'boolean') return typeof value === 'boolean'
	if (schema.type === 'string')
		return (
			typeof value === 'string' &&
			value.length >= Number(schema.minLength ?? 0) &&
			value.length <= Number(schema.maxLength) &&
			(!schema.enum || (schema.enum as unknown[]).includes(value))
		)
	if (schema.type === 'number' || schema.type === 'integer')
		return (
			typeof value === 'number' &&
			Number.isFinite(value) &&
			(schema.type !== 'integer' || Number.isInteger(value)) &&
			value >= Number(schema.minimum) &&
			value <= Number(schema.maximum) &&
			(!schema.enum || (schema.enum as unknown[]).includes(value))
		)
	if (schema.type === 'array')
		return (
			Array.isArray(value) &&
			value.length >= Number(schema.minItems ?? 0) &&
			value.length <= Number(schema.maxItems) &&
			value.every((item) => matchesPublicSchema(item, schema.items as Record<string, unknown>))
		)
	if (schema.type === 'object') {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false
		const entries = Object.entries(value)
		const properties = schema.properties as Record<string, Record<string, unknown>>
		return (
			entries.length <= Number(schema.maxProperties ?? 16) &&
			(schema.required as string[]).every((key) => Object.hasOwn(value, key)) &&
			entries.every(
				([key, item]) =>
					Object.hasOwn(properties, key) && matchesPublicSchema(item, properties[key]!)
			)
		)
	}
	return false
}

/** Validate one run's public form values against the same bounded authoring grammar. */
export function parseStudioSkillParameters(
	definition: Pick<StudioSkillV2, 'parametersSchema'>,
	value: unknown
): Record<string, unknown> {
	const schema = parameterSchema(definition.parametersSchema)
	if (!matchesPublicSchema(value, schema))
		fail('parameters', 'Run settings do not match the Skill form.', 'PARAMETER_TYPE_MISMATCH')
	return structuredClone(value as Record<string, unknown>)
}

export function parseStudioSkillV2(value: unknown): StudioSkillV2 {
	let bytes: string
	try {
		bytes = JSON.stringify(value)
	} catch {
		return fail('program', 'Program is not finite JSON.')
	}
	if (!bytes || bytes.length > 256 * 1024) fail('program', 'Program is too large.')
	const item = object(value, 'program')
	closed(
		item,
		['version', 'name', 'inputs', 'parametersSchema', 'steps', 'outputs', 'policy'],
		'program'
	)
	if (item.version !== 2)
		fail('version', 'Unsupported Skill program version.', 'UNSUPPORTED_VERSION')
	const inputs = named(item.inputs, 'inputs', 16, port)
	const outputs = named(item.outputs, 'outputs', 16, (raw, path) => {
		const value = object(raw, path)
		closed(value, ['schema', 'type', 'predicate', 'role', 'cardinality', 'from'], path)
		const { from, ...portValue } = value
		return { ...port(portValue, path), from: binding(from, `${path}.from`) }
	})
	const policy = object(item.policy, 'policy')
	closed(
		policy,
		['maxInvocations', 'maxDepth', 'maxMembers', 'maxConcurrentChildren', 'allowModel'],
		'policy'
	)
	if (typeof policy.allowModel !== 'boolean') fail('policy.allowModel', 'Choose a model policy.')
	const definition: StudioSkillV2 = {
		version: 2,
		name: shortText(item.name, 'name'),
		inputs,
		parametersSchema: parameterSchema(item.parametersSchema),
		steps: steps(item.steps, 'steps'),
		outputs,
		policy: {
			maxInvocations: positiveInteger(policy.maxInvocations, 'policy.maxInvocations', 64),
			maxDepth: positiveInteger(policy.maxDepth, 'policy.maxDepth', 8),
			maxMembers: positiveInteger(policy.maxMembers, 'policy.maxMembers', 256),
			maxConcurrentChildren: positiveInteger(
				policy.maxConcurrentChildren,
				'policy.maxConcurrentChildren',
				4
			),
			allowModel: policy.allowModel
		}
	}
	const authoredNodes = (body: StudioSkillStep[]): number =>
		body.reduce(
			(count, step) =>
				count +
				1 +
				(step.kind === 'when'
					? Object.values(step.branches).reduce(
							(branchCount, branch) => branchCount + authoredNodes(branch.steps),
							0
						)
					: 0),
			0
		)
	if (authoredNodes(definition.steps) > 32) fail('steps', 'Skill has too many authored nodes.')
	const allIds = allSteps(definition.steps).map((step) => step.id)
	if (new Set(allIds).size !== allIds.length)
		fail('steps', 'Step IDs must be unique across the whole Skill.', 'DUPLICATE_STEP_ID')
	validateStaticBindings(definition)
	return definition
}

function validateStaticBindings(definition: StudioSkillV2): void {
	const inputPorts = new Map<string, StudioSkillPort>()
	for (const [name, value] of Object.entries(definition.inputs))
		inputPorts.set(`input:${name}`, value)
	const samePort = (
		source: StudioSkillPort | null,
		target: StudioSkillPort,
		path: string
	): void => {
		if (!source && target.cardinality === 'optional') return
		if (
			!source ||
			source.schema !== target.schema ||
			source.type.key !== target.type.key ||
			source.type.version !== target.type.version ||
			source.cardinality !== target.cardinality ||
			source.role !== target.role ||
			source.predicate !== target.predicate
		)
			fail(path, 'Output interface does not match its binding.', 'TYPE_MISMATCH')
	}
	type BodyState = { known: Map<string, StudioSkillPort>; previous: Set<string> }
	const resolve = (
		value: StudioPortBinding,
		path: string,
		state: BodyState
	): StudioSkillPort | null => {
		if (value.kind === 'none') return null
		if (value.kind === 'item') fail(path, 'Item binding is valid only for its collection child.')
		if (value.kind === 'step' && !state.previous.has(value.stepId))
			fail(path, 'Bind to a preceding step.', 'FORWARD_BINDING')
		return (
			state.known.get(
				value.kind === 'input' ? `input:${value.port}` : `step:${value.stepId}:${value.port}`
			) ?? fail(path, 'Unknown bound port.', 'MISSING_PORT')
		)
	}
	const walk = (body: StudioSkillStep[], path: string, inherited: BodyState): BodyState => {
		const state: BodyState = {
			known: new Map(inherited.known),
			previous: new Set(inherited.previous)
		}
		for (const [index, step] of body.entries()) {
			const at = `${path}.${index}`
			if (step.kind === 'invoke' || step.kind === 'skill')
				for (const [name, parameter] of [
					...Object.entries(step.parameters),
					...(step.kind === 'invoke' ? Object.entries(step.configuration ?? {}) : [])
				])
					if (
						parameter.kind === 'parameter' &&
						!Object.hasOwn(definition.parametersSchema.properties as object, parameter.name)
					)
						fail(
							`${at}.parameters.${name}`,
							'Public parameter is not declared.',
							'MISSING_PARAMETER'
						)
			for (const dep of step.after ?? [])
				if (!state.previous.has(dep))
					fail(`${at}.after`, 'Dependency must precede this step.', 'FORWARD_BINDING')
			const bindings =
				step.kind === 'invoke' || step.kind === 'skill'
					? Object.values(step.inputs)
					: step.kind === 'achieve'
						? step.ingredients
						: step.kind === 'review'
							? Object.values(step.subjects)
							: step.kind === 'forEach'
								? [
										step.collection,
										...Object.values(step.childInputs).filter((input) => input.kind !== 'item')
									]
								: [step.condition.from]
			for (const input of bindings) resolve(input, at, state)
			if (step.kind === 'forEach') {
				const collection = resolve(step.collection, at, state)
				if (collection?.cardinality !== 'many')
					fail(at, 'forEach requires a sealed collection.', 'TYPE_MISMATCH')
				const items = Object.values(step.childInputs).filter((input) => input.kind === 'item')
				if (items.length !== 1 || items[0]?.kind !== 'item' || items[0].loopId !== step.id)
					fail(at, 'Bind exactly one child input to this collection item.', 'MISSING_ITEM')
				if (Object.values(step.outputs).some((output) => output.cardinality !== 'many'))
					fail(at, 'Collection results must be sealed many ports.', 'TYPE_MISMATCH')
			}
			if (step.kind === 'when') {
				const condition = resolve(step.condition.from, at, state)
				if (step.condition.kind === 'presence' && condition?.cardinality !== 'optional')
					fail(at, 'Presence branch requires an optional port.', 'TYPE_MISMATCH')
				if (step.condition.kind === 'observation' && condition?.cardinality !== 'one')
					fail(at, 'Observation branch requires a committed one-valued report.', 'TYPE_MISMATCH')
				for (const [branchName, branch] of Object.entries(step.branches)) {
					const branchPath = `${at}.branches.${branchName}`
					const branchState = walk(branch.steps, `${branchPath}.steps`, {
						known: refinedBranchPorts(state.known, step, branchName),
						previous: state.previous
					})
					if (
						Object.keys(branch.outputs).length !== Object.keys(step.outputs).length ||
						Object.keys(step.outputs).some((name) => !Object.hasOwn(branch.outputs, name))
					)
						fail(
							`${branchPath}.outputs`,
							'Every branch must bind the same declared outputs.',
							'BRANCH_INTERFACE'
						)
					for (const [name, output] of Object.entries(step.outputs))
						samePort(
							resolve(branch.outputs[name]!, `${branchPath}.outputs.${name}`, branchState),
							output,
							`${branchPath}.outputs.${name}`
						)
				}
			}
			for (const [port, value] of Object.entries(step.outputs))
				state.known.set(`step:${step.id}:${port}`, value)
			state.previous.add(step.id)
		}
		return state
	}
	const final = walk(definition.steps, 'steps', { known: inputPorts, previous: new Set() })
	for (const [name, output] of Object.entries(definition.outputs))
		samePort(resolve(output.from, `outputs.${name}`, final), output, `outputs.${name}`)
}

/** Static contract check only; current authority and actual input evidence are separate. */
export function validateStudioSkillCapabilities(
	definition: StudioSkillV2,
	registry: ActorRegistrySnapshot
): StudioSkillV2Issue[] {
	const issues: StudioSkillV2Issue[] = []
	const inputs = new Map<string, StudioSkillPort>()
	for (const [name, value] of Object.entries(definition.inputs)) inputs.set(`input:${name}`, value)
	const walk = (body: StudioSkillStep[], prefix: string, known: Map<string, StudioSkillPort>) => {
		for (const [index, step] of body.entries()) {
			const at = `${prefix}.${index}`
			if (step.kind === 'when') {
				for (const [branchName, branch] of Object.entries(step.branches))
					walk(
						branch.steps,
						`${at}.branches.${branchName}.steps`,
						refinedBranchPorts(known, step, branchName)
					)
			}
			if (step.kind !== 'invoke') {
				for (const [name, value] of Object.entries(step.outputs))
					known.set(`step:${step.id}:${name}`, value)
				continue
			}
			const capability = registry.definitions
				.flatMap((actor) => actor.capabilities)
				.find((candidate) => candidate.id === step.capabilityId)
			if (!capability) {
				issues.push({
					path: at,
					code: 'CAPABILITY_UNAVAILABLE',
					message: 'Installed capability is unavailable.'
				})
				continue
			}
			const actor = registry.definitions.find((definition) =>
				definition.capabilities.some((candidate) => candidate.id === step.capabilityId)
			)
			const method = actor?.manifest.methods.find((item) => item.name === capability.method)
			let publicParameters: Record<string, unknown> | undefined
			try {
				publicParameters = parseStudioPublicParametersSchema(method?.parameters)
			} catch (error) {
				if (!(error instanceof StudioSkillV2Error)) throw error
			}
			if (
				!method?.mode ||
				!method.idempotency ||
				!publicParameters ||
				(capability.requires.length > 0 && !method.inputSlots?.length) ||
				(capability.produces.length > 0 && !method.outputSlots?.length) ||
				method.inputSlots?.some((slot) => !slot.schema || !slot.role) ||
				method.outputSlots?.some((slot) => !slot.schema || !slot.role)
			)
				issues.push({
					path: at,
					code: 'CONTRACT_INCOMPLETE',
					message: 'The installed capability has an incomplete execution contract.'
				})
			if (method?.mode === 'view' || method?.mode === 'stream' || method?.mode === 'effect')
				issues.push({
					path: at,
					code: 'UNSUPPORTED_RUNTIME',
					message: 'This capability requires a runtime adapter before it can be admitted.'
				})
			if (step.configuration && Object.keys(step.configuration).length > 0)
				issues.push({
					path: `${at}.configuration`,
					code: 'CONFIGURATION_UNVERIFIED',
					message: 'Public configuration needs an installed offer contract.'
				})
			const methodParameters = publicParameters?.properties
			for (const required of (publicParameters?.required as string[] | undefined) ?? [])
				if (!Object.hasOwn(step.parameters, required))
					issues.push({
						path: `${at}.parameters.${required}`,
						code: 'MISSING_PARAMETER',
						message: 'Required method parameter is unbound.'
					})
			for (const [name, binding] of Object.entries(step.parameters)) {
				const parameterAt = `${at}.parameters.${name}`
				if (
					!methodParameters ||
					typeof methodParameters !== 'object' ||
					Array.isArray(methodParameters) ||
					!Object.hasOwn(methodParameters, name)
				) {
					issues.push({
						path: parameterAt,
						code: 'UNDECLARED_PARAMETER',
						message: 'This method does not declare the selected public parameter.'
					})
					continue
				}
				try {
					const actorSchema = publicSchemaNode(
						(methodParameters as Record<string, unknown>)[name],
						parameterAt
					)
					if (binding.kind === 'literal' && !matchesPublicSchema(binding.value, actorSchema))
						issues.push({
							path: parameterAt,
							code: 'PARAMETER_TYPE_MISMATCH',
							message: 'Literal does not match the installed method parameter.'
						})
					if (binding.kind === 'parameter') {
						const publicSchema = (
							definition.parametersSchema.properties as Record<string, Record<string, unknown>>
						)[binding.name]
						if (
							!publicSchema ||
							canonicalPublicSchema(publicSchema) !== canonicalPublicSchema(actorSchema)
						)
							issues.push({
								path: parameterAt,
								code: 'PARAMETER_TYPE_MISMATCH',
								message: 'Skill parameter does not match the installed method parameter.'
							})
						if (
							(publicParameters?.required as string[] | undefined)?.includes(name) &&
							!(definition.parametersSchema.required as string[]).includes(binding.name)
						)
							issues.push({
								path: parameterAt,
								code: 'PARAMETER_MAY_BE_MISSING',
								message: 'Required method parameter cannot bind an optional Skill parameter.'
							})
					}
				} catch (error) {
					if (!(error instanceof StudioSkillV2Error)) throw error
					issues.push({
						path: parameterAt,
						code: 'PARAMETER_CONTRACT_INCOMPLETE',
						message: 'The installed method parameter needs a bounded public contract.'
					})
				}
			}
			for (const slot of capability.inputSlots ?? []) {
				if (slot.sensitive && slot.name in step.inputs)
					issues.push({
						path: `${at}.inputs.${slot.name}`,
						code: 'PROTECTED_INPUT',
						message: 'Protected input must be resolved by the trusted host.'
					})
				else if (!slot.sensitive && slot.cardinality !== 'optional' && !(slot.name in step.inputs))
					issues.push({
						path: `${at}.inputs.${slot.name}`,
						code: 'MISSING_PORT',
						message: 'Required input is unbound.'
					})
			}
			for (const key of Object.keys(step.inputs))
				if (!capability.inputSlots?.some((slot) => slot.name === key && !slot.sensitive))
					issues.push({
						path: `${at}.inputs.${key}`,
						code: 'UNDECLARED_PORT',
						message: 'Input port is not declared by this capability.'
					})
			for (const [key, binding] of Object.entries(step.inputs)) {
				const declared = capability.inputSlots?.find((slot) => slot.name === key && !slot.sensitive)
				const source =
					binding.kind === 'input'
						? known.get(`input:${binding.port}`)
						: binding.kind === 'step'
							? known.get(`step:${binding.stepId}:${binding.port}`)
							: null
				if (!declared) continue
				if (binding.kind === 'none' && declared.cardinality === 'optional') continue
				if (
					!source ||
					!declared.schema ||
					source.schema !== declared.schema ||
					source.predicate !== declared.predicate ||
					source.role !== declared.role ||
					(source.cardinality !== declared.cardinality &&
						!(source.cardinality === 'one' && declared.cardinality === 'optional'))
				)
					issues.push({
						path: `${at}.inputs.${key}`,
						code: 'INPUT_CONTRACT_MISMATCH',
						message: 'Bound input does not match the installed port contract.'
					})
			}
			for (const [key, output] of Object.entries(step.outputs)) {
				const declared = capability.outputSlots?.find((slot) => slot.name === key)
				if (
					!declared ||
					declared.schema !== output.schema ||
					declared.cardinality !== output.cardinality ||
					declared.role !== output.role ||
					declared.predicate !== output.predicate
				)
					issues.push({
						path: `${at}.outputs.${key}`,
						code: 'OUTPUT_CONTRACT_MISMATCH',
						message: 'Output port does not match the installed capability.'
					})
			}
			for (const slot of capability.outputSlots ?? [])
				if (!(slot.name in step.outputs))
					issues.push({
						path: `${at}.outputs.${slot.name}`,
						code: 'MISSING_PORT',
						message: 'Declared output port is missing.'
					})
			for (const [name, value] of Object.entries(step.outputs))
				known.set(`step:${step.id}:${name}`, value)
		}
	}
	walk(definition.steps, 'steps', inputs)
	return issues
}

function refinedBranchPorts(
	known: Map<string, StudioSkillPort>,
	step: Extract<StudioSkillStep, { kind: 'when' }>,
	branchName: string
): Map<string, StudioSkillPort> {
	const refined = new Map(known)
	if (step.condition.kind !== 'presence' || branchName !== 'present') return refined
	const binding = step.condition.from
	if (binding.kind !== 'input' && binding.kind !== 'step') return refined
	const key =
		binding.kind === 'input' ? `input:${binding.port}` : `step:${binding.stepId}:${binding.port}`
	const port = refined.get(key)
	if (port?.cardinality === 'optional') refined.set(key, { ...port, cardinality: 'one' })
	return refined
}

function allSteps(body: readonly StudioSkillStep[]): StudioSkillStep[] {
	return body.flatMap((step) => [
		step,
		...(step.kind === 'when'
			? Object.values(step.branches).flatMap((branch) => allSteps(branch.steps))
			: [])
	])
}

/** Exact structural dependencies, including conditional and collection children. */
export function studioSkillChildReferences(definition: StudioSkillV2): string[] {
	return [
		...new Set(
			allSteps(definition.steps).flatMap((step) =>
				step.kind === 'skill'
					? [step.skillArtifactId]
					: step.kind === 'forEach'
						? [step.childSkillArtifactId]
						: []
			)
		)
	]
}

function equivalentPort(
	left: StudioSkillPort,
	right: StudioSkillPort,
	cardinality: StudioSkillPort['cardinality'] = right.cardinality
): boolean {
	return (
		left.schema === right.schema &&
		left.type.key === right.type.key &&
		left.type.version === right.type.version &&
		left.predicate === right.predicate &&
		left.role === right.role &&
		left.cardinality === cardinality
	)
}

/** Exact child interfaces only; authority, Store visibility and effective policy are checked at admission. */
export function validateStudioSkillChildren(
	definition: StudioSkillV2,
	children: ReadonlyMap<string, StudioSkillV2>,
	rootArtifactId?: string
): StudioSkillV2Issue[] {
	const issues: StudioSkillV2Issue[] = []
	const childRefs = studioSkillChildReferences
	const ancestry = new Set<string>()
	const visited = new Set<string>()
	const visit = (id: string): void => {
		if (ancestry.has(id)) {
			issues.push({ path: 'steps', code: 'CYCLE', message: 'Nested Skills form a cycle.' })
			return
		}
		if (visited.has(id)) return
		const child = children.get(id)
		if (!child) {
			issues.push({
				path: 'steps',
				code: 'MISSING_CHILD',
				message: 'An exact child Skill is unavailable.'
			})
			return
		}
		ancestry.add(id)
		for (const descendant of childRefs(child)) visit(descendant)
		ancestry.delete(id)
		visited.add(id)
	}
	if (rootArtifactId) ancestry.add(rootArtifactId)
	for (const id of childRefs(definition)) visit(id)
	const inputPorts = new Map<string, StudioSkillPort>()
	for (const [name, value] of Object.entries(definition.inputs))
		inputPorts.set(`input:${name}`, value)
	const checkBody = (
		body: StudioSkillStep[],
		prefix: string,
		known: Map<string, StudioSkillPort>
	): void => {
		for (const [index, step] of body.entries()) {
			const at = `${prefix}.${index}`
			if (step.kind === 'when')
				for (const [branchName, branch] of Object.entries(step.branches))
					checkBody(
						branch.steps,
						`${at}.branches.${branchName}.steps`,
						refinedBranchPorts(known, step, branchName)
					)
			if (step.kind !== 'skill' && step.kind !== 'forEach') {
				for (const [name, value] of Object.entries(step.outputs))
					known.set(`step:${step.id}:${name}`, value)
				continue
			}
			const child = children.get(
				step.kind === 'skill' ? step.skillArtifactId : step.childSkillArtifactId
			)
			if (!child) {
				for (const [name, value] of Object.entries(step.outputs))
					known.set(`step:${step.id}:${name}`, value)
				continue
			}
			const boundInputs = step.kind === 'skill' ? step.inputs : step.childInputs
			if (
				Object.keys(boundInputs).length !== Object.keys(child.inputs).length ||
				Object.keys(child.inputs).some((name) => !Object.hasOwn(boundInputs, name))
			)
				issues.push({
					path: `${at}.inputs`,
					code: 'CHILD_INTERFACE_MISMATCH',
					message: 'Bind every exact child input by name.'
				})
			for (const [name, target] of Object.entries(child.inputs)) {
				const binding = boundInputs[name]
				if (!binding) continue
				const source =
					binding.kind === 'input'
						? known.get(`input:${binding.port}`)
						: binding.kind === 'step'
							? known.get(`step:${binding.stepId}:${binding.port}`)
							: binding.kind === 'item' && step.kind === 'forEach'
								? (() => {
										const collection =
											step.collection.kind === 'input'
												? known.get(`input:${step.collection.port}`)
												: step.collection.kind === 'step'
													? known.get(`step:${step.collection.stepId}:${step.collection.port}`)
													: undefined
										return collection && { ...collection, cardinality: 'one' as const }
									})()
								: undefined
				if (binding.kind === 'none' && target.cardinality === 'optional') continue
				if (
					!source ||
					(!equivalentPort(source, target) &&
						!(
							source.cardinality === 'one' &&
							target.cardinality === 'optional' &&
							equivalentPort(source, target, 'one')
						))
				)
					issues.push({
						path: `${at}.inputs.${name}`,
						code: 'CHILD_INPUT_MISMATCH',
						message: 'Bound artifact port differs from the exact child input contract.'
					})
			}
			if (
				Object.keys(step.outputs).length !== Object.keys(child.outputs).length ||
				Object.keys(child.outputs).some(
					(name) =>
						!step.outputs[name] ||
						!equivalentPort(
							step.outputs[name]!,
							child.outputs[name]!,
							step.kind === 'forEach' ? 'many' : child.outputs[name]!.cardinality
						)
				)
			)
				issues.push({
					path: `${at}.outputs`,
					code: 'CHILD_INTERFACE_MISMATCH',
					message: 'Declared child outputs differ from the exact saved interface.'
				})
			if (step.kind === 'skill') {
				const properties = child.parametersSchema.properties as Record<
					string,
					Record<string, unknown>
				>
				const required = child.parametersSchema.required as string[]
				if (
					Object.keys(step.parameters).some((name) => !Object.hasOwn(properties, name)) ||
					required.some((name) => !Object.hasOwn(step.parameters, name))
				)
					issues.push({
						path: `${at}.parameters`,
						code: 'CHILD_INTERFACE_MISMATCH',
						message: 'Child public parameters must match its saved interface.'
					})
				for (const [name, binding] of Object.entries(step.parameters)) {
					const target = properties[name]
					if (!target) continue
					const source =
						binding.kind === 'parameter'
							? (definition.parametersSchema.properties as Record<string, Record<string, unknown>>)[
									binding.name
								]
							: undefined
					if (
						binding.kind === 'literal'
							? !matchesPublicSchema(binding.value, target)
							: !source || canonicalPublicSchema(source) !== canonicalPublicSchema(target)
					)
						issues.push({
							path: `${at}.parameters.${name}`,
							code: 'CHILD_PARAMETER_MISMATCH',
							message: 'Bound public value differs from the exact child parameter contract.'
						})
					if (
						binding.kind === 'parameter' &&
						required.includes(name) &&
						!(definition.parametersSchema.required as string[]).includes(binding.name)
					)
						issues.push({
							path: `${at}.parameters.${name}`,
							code: 'PARAMETER_MAY_BE_MISSING',
							message: 'Required child parameter cannot bind an optional Skill parameter.'
						})
				}
			} else {
				const required = (child.parametersSchema.required as string[] | undefined) ?? []
				if (required.length > 0)
					issues.push({
						path: `${at}.parameters`,
						code: 'CHILD_PARAMETER_UNAVAILABLE',
						message: 'Collection children with required settings are not supported yet.'
					})
				const item = Object.entries(step.childInputs).find(([, binding]) => binding.kind === 'item')
				if (!item || !child.inputs[item[0]] || child.inputs[item[0]]!.cardinality !== 'one')
					issues.push({
						path: `${at}.childInputs`,
						code: 'CHILD_INTERFACE_MISMATCH',
						message: 'Collection item needs one exact child input.'
					})
			}
			for (const [name, value] of Object.entries(step.outputs))
				known.set(`step:${step.id}:${name}`, value)
		}
	}
	checkBody(definition.steps, 'steps', inputPorts)
	return issues
}
