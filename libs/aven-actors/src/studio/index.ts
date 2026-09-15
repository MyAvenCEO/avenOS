import { resourceId } from '../ids'
import { type Capability, solve } from '../planner'

export const STUDIO_SKILL = resourceId({
	authority: 'ceo.aven',
	kind: 'skill',
	namespace: 'studio',
	name: 'program',
	version: '1'
})
export const STUDIO_VERSION = 1 as const
export interface StudioType {
	key: string
	version: number
}
export interface StudioBinding {
	kind: 'input' | 'step'
	name: string
}
export type StudioParameter = string | number | boolean
export interface StudioStep {
	id: string
	kind: 'capability' | 'skill' | 'goal' | 'review'
	label: string
	inputs: Record<string, StudioBinding>
	parameters: Record<string, StudioParameter>
	ref?: string
	goal?: StudioType
}
export interface StudioDefinition {
	version: 1
	name: string
	inputs: Record<string, StudioType>
	steps: StudioStep[]
	output: { type: StudioType; from: StudioBinding }
	policy: { maxInvocations: number; maxDepth: number; allowModel: boolean }
}
export interface StudioCapability {
	id: string
	label: string
	description: string
	input: StudioType
	output: StudioType
	cost: number
	observation: boolean
	model: boolean
	parameters: string[]
}
export const STUDIO_CATALOG: readonly StudioCapability[] = [
	{
		id: 'document.understand@1',
		label: 'Understand document',
		description: 'Inspect and extract supported information. The report may need review.',
		input: { key: 'core.file', version: 1 },
		output: { key: 'studio.understanding', version: 1 },
		cost: 2,
		observation: true,
		model: true,
		parameters: []
	},
	{
		id: 'report.brief@1',
		label: 'Prepare a brief',
		description: 'Create a compact account of a committed understanding report.',
		input: { key: 'studio.understanding', version: 1 },
		output: { key: 'studio.brief', version: 1 },
		cost: 1,
		observation: false,
		model: false,
		parameters: ['title']
	}
]
export interface StudioIssue {
	path: string
	code: string
	message: string
}
export class StudioValidationError extends Error {
	constructor(readonly issues: StudioIssue[]) {
		super(issues.map((i) => i.message).join(' '))
		this.name = 'StudioValidationError'
	}
}
const fail = (path: string, message: string, code = 'INVALID_PROGRAM'): never => {
	throw new StudioValidationError([{ path, code, message }])
}
const record = (value: unknown, path: string): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return fail(path, `${path} must be an object.`)
	return value as Record<string, unknown>
}
const closed = (value: Record<string, unknown>, keys: string[], path: string) => {
	if (Object.keys(value).some((k) => !keys.includes(k))) fail(path, `Unknown field in ${path}.`)
}
const identifier = (value: unknown, path: string): string => {
	if (
		typeof value !== 'string' ||
		!/^[a-z][a-z0-9_-]{0,63}$/.test(value) ||
		['constructor', 'prototype', '__proto__'].includes(value)
	)
		return fail(path, `Invalid name at ${path}.`)
	return value
}
const text = (value: unknown, path: string, max = 160): string => {
	if (typeof value !== 'string' || !value.trim() || value.length > max)
		return fail(path, `A short label is required at ${path}.`)
	return value
}
const integer = (value: unknown, path: string, max: number): number => {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
		return fail(path, `${path} must be between 1 and ${max}.`)
	return value
}
export function parseStudioType(value: unknown, path = 'type'): StudioType {
	const t = record(value, path)
	closed(t, ['key', 'version'], path)
	if (typeof t.key !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(t.key))
		return fail(path, 'Invalid artifact type.')
	return { key: t.key, version: integer(t.version, path, 10000) }
}
function binding(value: unknown, path: string): StudioBinding {
	const b = record(value, path)
	closed(b, ['kind', 'name'], path)
	if (b.kind !== 'input' && b.kind !== 'step')
		return fail(path, 'Choose an input or a preceding step.')
	return { kind: b.kind, name: identifier(b.name, path) }
}
export function parseStudioDefinition(value: unknown): StudioDefinition {
	if (JSON.stringify(value)?.length > 64 * 1024) fail('program', 'The program is too large.')
	const d = record(value, 'program')
	closed(d, ['version', 'name', 'inputs', 'steps', 'output', 'policy'], 'program')
	if (d.version !== 1) fail('version', 'Unsupported program version.')
	const inputs: Record<string, StudioType> = {}
	for (const [key, val] of Object.entries(record(d.inputs, 'inputs')))
		inputs[identifier(key, 'inputs')] = parseStudioType(val, `inputs.${key}`)
	if (!Object.keys(inputs).length || Object.keys(inputs).length > 16)
		fail('inputs', 'Choose between 1 and 16 input ports.')
	if (!Array.isArray(d.steps) || d.steps.length > 32)
		fail('steps', 'Programs support at most 32 steps.')
	const ids = new Set<string>()
	const steps = (d.steps as unknown[]).map((raw, index): StudioStep => {
		const path = `steps.${index}`
		const s = record(raw, path)
		closed(s, ['id', 'kind', 'label', 'inputs', 'parameters', 'ref', 'goal'], path)
		const id = identifier(s.id, path)
		if (ids.has(id)) fail(path, 'Every step needs its own identity.')
		ids.add(id)
		if (!['capability', 'skill', 'goal', 'review'].includes(String(s.kind)))
			fail(path, 'Unsupported step kind.')
		const bound: Record<string, StudioBinding> = {}
		for (const [name, val] of Object.entries(record(s.inputs, `${path}.inputs`)))
			bound[identifier(name, path)] = binding(val, path)
		if (Object.keys(bound).length > 16) fail(path, 'Too many bindings.')
		const parameters: Record<string, StudioParameter> = {}
		for (const [name, val] of Object.entries(record(s.parameters, `${path}.parameters`))) {
			identifier(name, path)
			if (
				!['string', 'boolean', 'number'].includes(typeof val) ||
				(typeof val === 'number' && !Number.isSafeInteger(val)) ||
				(typeof val === 'string' && val.length > 512)
			)
				fail(path, 'Parameters must be bounded scalar values.')
			parameters[name] = val as StudioParameter
		}
		if (Object.keys(parameters).length > 16) fail(path, 'Too many parameters.')
		if (s.kind === 'goal' && (s.ref !== undefined || s.goal === undefined))
			fail(path, 'An open goal needs an output type.')
		if (s.kind !== 'goal' && s.goal !== undefined)
			fail(path, 'Only an open goal declares a goal type.')
		if (s.kind === 'skill' && (typeof s.ref !== 'string' || !UUID.test(s.ref)))
			fail(path, 'A child must name an exact Skill artifact.')
		if (s.kind === 'capability' && typeof s.ref !== 'string') fail(path, 'Choose a capability.')
		if (s.kind === 'review' && s.ref !== undefined) fail(path, 'Review cannot name a capability.')
		return {
			id,
			kind: s.kind as StudioStep['kind'],
			label: text(s.label, path),
			inputs: bound,
			parameters,
			...(s.ref !== undefined ? { ref: text(s.ref, path, 180) } : {}),
			...(s.goal !== undefined ? { goal: parseStudioType(s.goal, path) } : {})
		}
	})
	const output = record(d.output, 'output')
	closed(output, ['type', 'from'], 'output')
	const p = record(d.policy, 'policy')
	closed(p, ['maxInvocations', 'maxDepth', 'allowModel'], 'policy')
	if (typeof p.allowModel !== 'boolean') fail('policy', 'Model policy is required.')
	return {
		version: 1,
		name: text(d.name, 'name'),
		inputs,
		steps,
		output: { type: parseStudioType(output.type), from: binding(output.from, 'output') },
		policy: {
			maxInvocations: integer(p.maxInvocations, 'maxInvocations', 64),
			maxDepth: integer(p.maxDepth, 'maxDepth', 8),
			allowModel: p.allowModel as boolean
		}
	}
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const sameType = (a: StudioType, b: StudioType) => a.key === b.key && a.version === b.version
export const typeLabel = (t: StudioType) => `${t.key}@${t.version}`
const predicate = (t: StudioType) =>
	`ceo.aven.studio.t_${[...t.key].map((c) => c.charCodeAt(0).toString(16)).join('')}_v${t.version}(subject)`
export interface CompiledStudioStep extends StudioStep {
	outputType: StudioType
	capabilities?: StudioCapability[]
	child?: CompiledStudioProgram
}
export interface CompiledStudioProgram {
	definition: StudioDefinition
	steps: CompiledStudioStep[]
	invocations: number
	conditional: boolean
	children: string[]
}
export function routesFor(
	input: StudioType,
	output: StudioType,
	excluded: string[] = [],
	catalog = STUDIO_CATALOG
): StudioCapability[][] {
	const capabilities: Capability[] = catalog
		.filter((c) => !excluded.includes(c.id))
		.map((c) => ({
			id: c.id,
			actor: c.id,
			method: c.id,
			requires: [predicate(c.input)],
			produces: [predicate(c.output)],
			cost: c.cost
		}))
	const found = solve(capabilities, [{ predicate: predicate(input) }], [predicate(output)], {
		maxSteps: 8,
		maxStates: 256
	})
	return found.ok
		? [found.program.steps.map((step) => catalog.find((c) => c.id === step.capability)!)]
		: []
}
export function compileStudio(
	definition: StudioDefinition,
	library: ReadonlyMap<string, StudioDefinition> = new Map(),
	catalog = STUDIO_CATALOG,
	ancestry: string[] = [],
	remainingDepth = 8
): CompiledStudioProgram {
	const d = parseStudioDefinition(definition)
	if (remainingDepth < 1) fail('steps', 'The nesting limit was reached.', 'DEPTH_LIMIT')
	const depth = Math.min(remainingDepth, d.policy.maxDepth)
	const values = new Map<string, StudioType>(
		Object.entries(d.inputs).map(([name, type]) => [`input:${name}`, type])
	)
	const children: string[] = []
	let invocations = 0
	let conditional = false
	const resolve = (b: StudioBinding) =>
		values.get(`${b.kind}:${b.name}`) ??
		fail(b.name, 'Bind to an input or a preceding step.', 'MISSING_INPUT')
	const steps = d.steps.map((s): CompiledStudioStep => {
		const inputs = Object.fromEntries(
			Object.entries(s.inputs).map(([name, b]) => [name, resolve(b)])
		)
		let outputType: StudioType
		let child: CompiledStudioProgram | undefined
		let capabilities: StudioCapability[] | undefined
		if (s.kind === 'review')
			return fail(
				s.id,
				'Review steps are inspectable but execution is not enabled in this slice.',
				'UNSUPPORTED_REVIEW'
			)
		if (s.kind === 'skill') {
			if (ancestry.includes(s.ref!)) fail(s.id, 'Recursive Skills are not supported.', 'CYCLE')
			const referenced =
				library.get(s.ref!) ?? fail(s.id, 'The exact child Skill is unavailable.', 'MISSING_CHILD')
			if (
				Object.keys(inputs).length !== Object.keys(referenced.inputs).length ||
				Object.entries(referenced.inputs).some(
					([name, type]) => !inputs[name] || !sameType(inputs[name]!, type)
				)
			)
				fail(s.id, 'Child input bindings do not match its interface.', 'TYPE_MISMATCH')
			child = compileStudio(
				{
					...referenced,
					policy: {
						maxInvocations: Math.min(d.policy.maxInvocations, referenced.policy.maxInvocations),
						maxDepth: referenced.policy.maxDepth,
						allowModel: d.policy.allowModel && referenced.policy.allowModel
					}
				},
				library,
				catalog,
				[...ancestry, s.ref!],
				depth - 1
			)
			if (Object.keys(s.parameters).length) fail(s.id, 'This version has no child parameter ports.')
			children.push(s.ref!, ...child.children)
			invocations += child.invocations
			conditional ||= child.conditional
			outputType = child.definition.output.type
		} else {
			if (Object.keys(inputs).length !== 1 || !inputs.source)
				fail(s.id, 'Bind one source input.', 'MISSING_INPUT')
			if (s.kind === 'goal') {
				if (Object.keys(s.parameters).length) fail(s.id, 'Goal parameters are not supported.')
				capabilities =
					routesFor(inputs.source!, s.goal!, [], catalog)[0] ??
					fail(s.id, 'No installed route establishes this output.', 'NO_ROUTE')
				outputType = s.goal!
			} else {
				const cap =
					catalog.find((c) => c.id === s.ref) ??
					fail(s.id, 'This capability is not installed.', 'UNAVAILABLE')
				if (!sameType(cap.input, inputs.source!))
					fail(s.id, 'The source type does not match this step.', 'TYPE_MISMATCH')
				if (Object.keys(s.parameters).some((k) => !cap.parameters.includes(k)))
					fail(s.id, 'This step does not accept that parameter.')
				if (
					s.parameters.title !== undefined &&
					(typeof s.parameters.title !== 'string' || !s.parameters.title.trim())
				)
					fail(s.id, 'A brief title must be non-empty text.')
				capabilities = [cap]
				outputType = cap.output
			}
			// The document adapter can always inspect deterministically; allowModel controls its optional model lane.
			invocations += capabilities.length
			conditional ||= capabilities.some((c) => c.observation)
		}
		values.set(`step:${s.id}`, outputType)
		return {
			...s,
			outputType,
			...(capabilities ? { capabilities } : {}),
			...(child ? { child } : {})
		}
	})
	if (!sameType(resolve(d.output.from), d.output.type))
		fail('output', 'The selected output does not match the promised type.', 'TYPE_MISMATCH')
	if (invocations > d.policy.maxInvocations)
		fail('policy', 'The whole program exceeds its invocation budget.', 'BUDGET_LIMIT')
	return { definition: d, steps, invocations, conditional, children: [...new Set(children)] }
}
export function draftFor(
	input: StudioType,
	output: StudioType,
	name = 'Understand document'
): StudioDefinition {
	return {
		version: 1,
		name,
		inputs: { source: input },
		steps: [
			{
				id: 'outcome',
				kind: 'goal',
				label: name,
				inputs: { source: { kind: 'input', name: 'source' } },
				parameters: {},
				goal: output
			}
		],
		output: { type: output, from: { kind: 'step', name: 'outcome' } },
		policy: { maxInvocations: 16, maxDepth: 4, allowModel: false }
	}
}
