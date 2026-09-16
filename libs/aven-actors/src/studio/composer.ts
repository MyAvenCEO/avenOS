import type { StudioCatalogEntry, StudioCatalogPort } from './catalog'
import {
	parseStudioSkillV2,
	type StudioParameterBinding,
	type StudioPortBinding,
	type StudioSkillPort,
	type StudioSkillV2
} from './v2'

export interface StudioCompositionCue {
	kind: 'connected' | 'new-input' | 'optional' | 'protected' | 'new-parameter'
	name: string
	from?: string
}

export interface StudioCompositionResult {
	definition: StudioSkillV2
	stepId: string
	cues: StudioCompositionCue[]
}

/**
 * Add one authorized catalog operation without asking the author to wire JSON.
 * Exact compatible ports connect automatically; otherwise a reusable Skill input
 * or public parameter is exposed. Protected inputs stay host-resolved.
 */
export function composeCatalogOperation(
	rawDefinition: unknown,
	entry: StudioCatalogEntry
): StudioCompositionResult {
	if (!entry.canAuthor || !entry.installationDigest)
		throw new Error('STUDIO_OPERATION_NOT_AUTHORABLE')
	const definition = parseStudioSkillV2(rawDefinition)
	const stepId = uniqueName(definition.steps.map((step) => step.id), operationName(entry))
	const cues: StudioCompositionCue[] = []
	const inputs: Record<string, StudioPortBinding> = {}
	for (const port of entry.inputs) {
		if (port.sensitive) {
			cues.push({ kind: 'protected', name: port.name })
			continue
		}
		const target = exactPort(port)
		const match = availablePorts(definition)
			.reverse()
			.find((candidate) => compatible(candidate.port, target))
		if (match) {
			inputs[port.name] = match.binding
			cues.push({ kind: 'connected', name: port.name, from: match.label })
			continue
		}
		if (target.cardinality === 'optional') {
			inputs[port.name] = { kind: 'none' }
			cues.push({ kind: 'optional', name: port.name })
			continue
		}
		if (Object.keys(definition.inputs).length >= 16) throw new Error('STUDIO_INPUT_LIMIT')
		const inputName = uniqueName(Object.keys(definition.inputs), port.name)
		definition.inputs[inputName] = target
		inputs[port.name] = { kind: 'input', port: inputName }
		cues.push({ kind: 'new-input', name: port.name, from: inputName })
	}

	const parameters: Record<string, StudioParameterBinding> = {}
	const methodProperties = entry.parametersSchema.properties as Record<
		string,
		Record<string, unknown>
	>
	const required = (entry.parametersSchema.required as string[] | undefined) ?? []
	const publicProperties = definition.parametersSchema.properties as Record<
		string,
		Record<string, unknown>
	>
	const publicRequired = (definition.parametersSchema.required as string[] | undefined) ?? []
	for (const [name, schema] of Object.entries(methodProperties)) {
		const existing = Object.entries(publicProperties).find(
			([candidate, value]) => candidate === name && canonical(value) === canonical(schema)
		)
		if (existing) {
			if (required.includes(name) && !publicRequired.includes(existing[0]))
				publicRequired.push(existing[0])
			parameters[name] = { kind: 'parameter', name: existing[0] }
			cues.push({ kind: 'connected', name, from: existing[0] })
			continue
		}
		if (Object.keys(publicProperties).length >= 16) throw new Error('STUDIO_PARAMETER_LIMIT')
		const parameterName = uniqueName(Object.keys(publicProperties), name)
		publicProperties[parameterName] = structuredClone(schema)
		if (required.includes(name)) publicRequired.push(parameterName)
		definition.parametersSchema.maxProperties = Math.max(
			Number(definition.parametersSchema.maxProperties ?? 0),
			Object.keys(publicProperties).length
		)
		parameters[name] = { kind: 'parameter', name: parameterName }
		cues.push({ kind: 'new-parameter', name, from: parameterName })
	}

	const outputs = Object.fromEntries(
		entry.outputs.map((port) => [port.name, exactPort(port)])
	)
	definition.steps.push({
		id: stepId,
		label: entry.label,
		kind: 'invoke',
		capabilityId: entry.capabilityId,
		inputs,
		parameters,
		outputs
	})
	if (!Object.keys(definition.outputs).length)
		for (const [name, port] of Object.entries(outputs))
			definition.outputs[uniqueName(Object.keys(definition.outputs), name)] = {
				...port,
				from: { kind: 'step', stepId, port: name }
			}
	return { definition: parseStudioSkillV2(definition), stepId, cues }
}

/** Add an exact immutable v2 child Skill using the same named-port auto-wiring rules. */
export function composeSkillArtifact(
	rawDefinition: unknown,
	skillArtifactId: string,
	rawChild: unknown
): StudioCompositionResult {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(skillArtifactId))
		throw new Error('STUDIO_CHILD_ID_INVALID')
	const definition = parseStudioSkillV2(rawDefinition)
	const child = parseStudioSkillV2(rawChild)
	const stepId = uniqueName(definition.steps.map((step) => step.id), 'use-skill')
	const cues: StudioCompositionCue[] = []
	const inputs: Record<string, StudioPortBinding> = {}
	for (const [name, target] of Object.entries(child.inputs)) {
		const match = availablePorts(definition)
			.reverse()
			.find((candidate) => compatible(candidate.port, target))
		if (match) {
			inputs[name] = match.binding
			cues.push({ kind: 'connected', name, from: match.label })
			continue
		}
		if (target.cardinality === 'optional') {
			inputs[name] = { kind: 'none' }
			cues.push({ kind: 'optional', name })
			continue
		}
		if (Object.keys(definition.inputs).length >= 16) throw new Error('STUDIO_INPUT_LIMIT')
		const inputName = uniqueName(Object.keys(definition.inputs), name)
		definition.inputs[inputName] = structuredClone(target)
		inputs[name] = { kind: 'input', port: inputName }
		cues.push({ kind: 'new-input', name, from: inputName })
	}
	const childProperties = child.parametersSchema.properties as Record<string, Record<string, unknown>>
	const childRequired = (child.parametersSchema.required as string[] | undefined) ?? []
	const publicProperties = definition.parametersSchema.properties as Record<string, Record<string, unknown>>
	const publicRequired = (definition.parametersSchema.required as string[] | undefined) ?? []
	const parameters: Record<string, StudioParameterBinding> = {}
	for (const [name, schema] of Object.entries(childProperties)) {
		const parameterName = uniqueName(Object.keys(publicProperties), name)
		publicProperties[parameterName] = structuredClone(schema)
		if (childRequired.includes(name)) publicRequired.push(parameterName)
		parameters[name] = { kind: 'parameter', name: parameterName }
		cues.push({ kind: 'new-parameter', name, from: parameterName })
	}
	definition.parametersSchema.maxProperties = Math.max(
		Number(definition.parametersSchema.maxProperties ?? 0),
		Object.keys(publicProperties).length
	)
	const outputs = Object.fromEntries(
		Object.entries(child.outputs).map(([name, output]) => {
			const { from: _from, ...port } = output
			return [name, port]
		})
	)
	definition.steps.push({
		id: stepId,
		label: child.name,
		kind: 'skill',
		skillArtifactId,
		skillVersion: 2,
		inputs,
		parameters,
		outputs
	})
	if (!Object.keys(definition.outputs).length)
		for (const [name, port] of Object.entries(outputs))
			definition.outputs[uniqueName(Object.keys(definition.outputs), name)] = {
				...port,
				from: { kind: 'step', stepId, port: name }
			}
	return { definition: parseStudioSkillV2(definition), stepId, cues }
}

function exactPort(port: StudioCatalogPort): StudioSkillPort {
	if (!port.schema || !port.role || !port.type || port.sensitive)
		throw new Error('STUDIO_PORT_CONTRACT_INCOMPLETE')
	return {
		schema: port.schema,
		type: structuredClone(port.type),
		predicate: port.predicate,
		role: port.role,
		cardinality: port.cardinality
	}
}

function availablePorts(definition: StudioSkillV2): Array<{
	port: StudioSkillPort
	binding: StudioPortBinding
	label: string
}> {
	return [
		...Object.entries(definition.inputs).map(([name, port]) => ({
			port,
			binding: { kind: 'input' as const, port: name },
			label: name
		})),
		...definition.steps.flatMap((step) =>
			Object.entries(step.outputs).map(([name, port]) => ({
				port,
				binding: { kind: 'step' as const, stepId: step.id, port: name },
				label: `${step.label} · ${name}`
			}))
		)
	]
}

function compatible(source: StudioSkillPort, target: StudioSkillPort): boolean {
	return (
		source.schema === target.schema &&
		source.type.key === target.type.key &&
		source.type.version === target.type.version &&
		source.predicate === target.predicate &&
		source.role === target.role &&
		(source.cardinality === target.cardinality ||
			(source.cardinality === 'one' && target.cardinality === 'optional'))
	)
}

function operationName(entry: StudioCatalogEntry): string {
	const candidate = entry.capabilityId.split(':').at(-1)?.split('@')[0] ?? 'operation'
	const normalized = candidate.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '')
	return (/^[a-z]/.test(normalized) ? normalized : `operation-${normalized || 'step'}`).slice(0, 56)
}

function uniqueName(existing: string[], preferred: string): string {
	const used = new Set(existing)
	const base = (/^[a-z]/.test(preferred) ? preferred : `item-${preferred}`)
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.slice(0, 56)
	if (!used.has(base)) return base
	for (let index = 2; index <= 999; index++) {
		const value = `${base.slice(0, 60 - String(index).length)}-${index}`
		if (!used.has(value)) return value
	}
	throw new Error('STUDIO_NAME_LIMIT')
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`
	return JSON.stringify(value)
}
