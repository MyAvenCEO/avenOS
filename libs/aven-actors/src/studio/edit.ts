import {
	parseStudioSkillV2,
	type StudioPortBinding,
	type StudioSkillStep,
	type StudioSkillV2
} from './v2'

export type StudioV2SemanticEdit =
	| { kind: 'rename'; name: string }
	| {
			kind: 'set-policy'
			field:
				| 'maxInvocations'
				| 'maxDepth'
				| 'maxMembers'
				| 'maxConcurrentChildren'
				| 'allowModel'
			value: number | boolean
	  }
	| { kind: 'set-step-label'; stepId: string; label: string }
	| { kind: 'remove-step'; stepId: string }
	| { kind: 'set-port-binding'; stepId: string; port: string; binding: StudioPortBinding }
	| { kind: 'set-parameter-binding'; stepId: string; parameter: string; binding: unknown }
	| { kind: 'set-output'; name: string; output: unknown }
	| { kind: 'remove-output'; name: string }
	| { kind: 'set-public-parameter'; name: string; schema: unknown; required: boolean }
	| { kind: 'remove-public-parameter'; name: string }

export interface StudioV2SemanticChange {
	path: string
	before: unknown
	after: unknown
}

export interface StudioV2EditResult {
	definition: StudioSkillV2
	change: StudioV2SemanticChange
}

export function newStudioSkillV2(name: string): StudioSkillV2 {
	return parseStudioSkillV2({
		version: 2,
		name,
		inputs: {},
		parametersSchema: {
			type: 'object',
			properties: {},
			required: [],
			additionalProperties: false,
			maxProperties: 16
		},
		steps: [],
		outputs: {},
		policy: {
			maxInvocations: 16,
			maxDepth: 4,
			maxMembers: 64,
			maxConcurrentChildren: 2,
			allowModel: false
		}
	})
}

/** Typed semantic edits for both agent and visual clients; the result is always reparsed. */
export function editStudioSkillV2(rawDefinition: unknown, rawEdit: unknown): StudioV2EditResult {
	const definition = structuredClone(parseStudioSkillV2(rawDefinition))
	const edit = parseEdit(rawEdit)
	let change: StudioV2SemanticChange
	if (edit.kind === 'rename') {
		change = { path: 'name', before: definition.name, after: edit.name }
		definition.name = edit.name
	} else if (edit.kind === 'set-policy') {
		const before = definition.policy[edit.field]
		change = { path: `policy.${edit.field}`, before, after: edit.value }
		;(definition.policy as Record<string, unknown>)[edit.field] = edit.value
	} else if (edit.kind === 'set-step-label') {
		const step = findStep(definition.steps, edit.stepId)
		change = { path: `steps.${edit.stepId}.label`, before: step.label, after: edit.label }
		step.label = edit.label
	} else if (edit.kind === 'remove-step') {
		const removed = removeStep(definition.steps, edit.stepId)
		change = { path: `steps.${edit.stepId}`, before: removed, after: undefined }
	} else if (edit.kind === 'set-port-binding') {
		const step = findStep(definition.steps, edit.stepId)
		if (step.kind !== 'invoke' && step.kind !== 'skill')
			throw new Error('STUDIO_EDIT_TARGET_INCOMPATIBLE')
		const before = step.inputs[edit.port]
		step.inputs[edit.port] = edit.binding
		change = {
			path: `steps.${edit.stepId}.inputs.${edit.port}`,
			before,
			after: edit.binding
		}
	} else if (edit.kind === 'set-parameter-binding') {
		const step = findStep(definition.steps, edit.stepId)
		if (step.kind !== 'invoke' && step.kind !== 'skill')
			throw new Error('STUDIO_EDIT_TARGET_INCOMPATIBLE')
		const before = step.parameters[edit.parameter]
		step.parameters[edit.parameter] = edit.binding as never
		change = {
			path: `steps.${edit.stepId}.parameters.${edit.parameter}`,
			before,
			after: edit.binding
		}
	} else if (edit.kind === 'set-output') {
		const before = definition.outputs[edit.name]
		definition.outputs[edit.name] = edit.output as never
		change = { path: `outputs.${edit.name}`, before, after: edit.output }
	} else if (edit.kind === 'remove-output') {
		const before = definition.outputs[edit.name]
		if (!before) throw new Error('STUDIO_EDIT_TARGET_UNAVAILABLE')
		delete definition.outputs[edit.name]
		change = { path: `outputs.${edit.name}`, before, after: undefined }
	} else if (edit.kind === 'set-public-parameter') {
		const properties = definition.parametersSchema.properties as Record<string, unknown>
		const required = definition.parametersSchema.required as string[]
		const before = properties[edit.name]
		properties[edit.name] = edit.schema
		const wasRequired = required.includes(edit.name)
		if (edit.required && !wasRequired) required.push(edit.name)
		if (!edit.required && wasRequired)
			definition.parametersSchema.required = required.filter((name) => name !== edit.name)
		change = {
			path: `parametersSchema.properties.${edit.name}`,
			before: before === undefined ? undefined : { schema: before, required: wasRequired },
			after: { schema: edit.schema, required: edit.required }
		}
	} else {
		const properties = definition.parametersSchema.properties as Record<string, unknown>
		const before = properties[edit.name]
		if (before === undefined) throw new Error('STUDIO_EDIT_TARGET_UNAVAILABLE')
		delete properties[edit.name]
		definition.parametersSchema.required = (
			definition.parametersSchema.required as string[]
		).filter((name) => name !== edit.name)
		change = { path: `parametersSchema.properties.${edit.name}`, before, after: undefined }
	}
	return { definition: parseStudioSkillV2(definition), change }
}

function parseEdit(value: unknown): StudioV2SemanticEdit {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('STUDIO_EDIT_INVALID')
	const edit = value as Record<string, unknown>
	const kind = edit.kind
	const keys: Record<string, string[]> = {
		rename: ['kind', 'name'],
		'set-policy': ['kind', 'field', 'value'],
		'set-step-label': ['kind', 'stepId', 'label'],
		'remove-step': ['kind', 'stepId'],
		'set-port-binding': ['kind', 'stepId', 'port', 'binding'],
		'set-parameter-binding': ['kind', 'stepId', 'parameter', 'binding'],
		'set-output': ['kind', 'name', 'output'],
		'remove-output': ['kind', 'name'],
		'set-public-parameter': ['kind', 'name', 'schema', 'required'],
		'remove-public-parameter': ['kind', 'name']
	}
	if (typeof kind !== 'string' || !keys[kind] || !exactKeys(edit, keys[kind]!))
		throw new Error('STUDIO_EDIT_INVALID')
	const name = (field: string): string => {
		const candidate = edit[field]
		if (typeof candidate !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(candidate))
			throw new Error('STUDIO_EDIT_INVALID')
		return candidate
	}
	if (kind === 'rename') {
		if (typeof edit.name !== 'string') throw new Error('STUDIO_EDIT_INVALID')
		return { kind, name: edit.name }
	}
	if (kind === 'set-policy') {
		if (
			!['maxInvocations', 'maxDepth', 'maxMembers', 'maxConcurrentChildren', 'allowModel'].includes(
				String(edit.field)
			) ||
			(typeof edit.value !== 'number' && typeof edit.value !== 'boolean')
		)
			throw new Error('STUDIO_EDIT_INVALID')
		return edit as StudioV2SemanticEdit
	}
	if (kind === 'set-step-label') {
		if (typeof edit.label !== 'string') throw new Error('STUDIO_EDIT_INVALID')
		return { kind, stepId: name('stepId'), label: edit.label }
	}
	if (kind === 'remove-step') return { kind, stepId: name('stepId') }
	if (kind === 'set-port-binding')
		return { kind, stepId: name('stepId'), port: name('port'), binding: edit.binding as never }
	if (kind === 'set-parameter-binding')
		return {
			kind,
			stepId: name('stepId'),
			parameter: name('parameter'),
			binding: edit.binding
		}
	if (kind === 'set-output') return { kind, name: name('name'), output: edit.output }
	if (kind === 'remove-output') return { kind, name: name('name') }
	if (kind === 'set-public-parameter') {
		if (typeof edit.required !== 'boolean') throw new Error('STUDIO_EDIT_INVALID')
		return { kind, name: name('name'), schema: edit.schema, required: edit.required }
	}
	return { kind: 'remove-public-parameter', name: name('name') }
}

function findStep(steps: StudioSkillStep[], id: string): StudioSkillStep {
	for (const step of steps) {
		if (step.id === id) return step
		if (step.kind === 'when')
			for (const branch of Object.values(step.branches)) {
				const found = findStepOrNull(branch.steps, id)
				if (found) return found
			}
	}
	throw new Error('STUDIO_EDIT_TARGET_UNAVAILABLE')
}

function findStepOrNull(steps: StudioSkillStep[], id: string): StudioSkillStep | null {
	try {
		return findStep(steps, id)
	} catch (error) {
		if (error instanceof Error && error.message === 'STUDIO_EDIT_TARGET_UNAVAILABLE') return null
		throw error
	}
}

function removeStep(steps: StudioSkillStep[], id: string): StudioSkillStep {
	const index = steps.findIndex((step) => step.id === id)
	if (index >= 0) return steps.splice(index, 1)[0]!
	for (const step of steps)
		if (step.kind === 'when')
			for (const branch of Object.values(step.branches)) {
				try {
					return removeStep(branch.steps, id)
				} catch (error) {
					if (!(error instanceof Error) || error.message !== 'STUDIO_EDIT_TARGET_UNAVAILABLE')
						throw error
				}
			}
	throw new Error('STUDIO_EDIT_TARGET_UNAVAILABLE')
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}
