import { describe, expect, test } from 'bun:test'
import {
	composeCatalogOperation,
	editStudioSkillV2,
	editStudioSkillV2Batch,
	newStudioSkillV2,
	parseStudioSkillV2,
	type StudioCatalogEntry
} from '../src'

const source = {
	schema: 'fixture:source@1',
	type: { key: 'fixture.source', version: 1 },
	predicate: 'fixture.source(X)',
	role: 'source',
	cardinality: 'one' as const
}
const result = {
	schema: 'fixture:result@1',
	type: { key: 'fixture.result', version: 1 },
	predicate: 'fixture.result(X)',
	role: 'result',
	cardinality: 'one' as const
}
const entry: StudioCatalogEntry = {
	actorId: 'ceo.aven:actor:fixture:worker@1',
	capabilityId: 'ceo.aven:capability:fixture:transform@1',
	version: '1',
	installationDigest: 'a'.repeat(64),
	label: 'Transform',
	description: 'Transform a fixture.',
	tags: [],
	mode: 'transform',
	parametersSchema: {
		type: 'object',
		properties: {},
		required: [],
		additionalProperties: false
	},
	inputs: [{ name: 'source', ...source, sensitive: false }],
	outputs: [{ name: 'result', ...result, sensitive: false }],
	requires: [source.predicate],
	produces: [result.predicate],
	placements: ['server'],
	readiness: 'needs-input',
	reasonCodes: [],
	canAuthor: true,
	canPlan: true,
	invocationStatus: 'not-evaluated'
}

describe('v2 semantic Skill edits', () => {
	test('identifies stale execution dependencies and preserves an invalid rewrite atomically', () => {
		const original = composeCatalogOperation(
			newStudioSkillV2('Dependency rewrite'),
			entry
		).definition
		const producer = original.steps[0]!
		const consumer = { ...structuredClone(producer), id: 'consumer', after: [producer.id] }
		original.steps.push(consumer)
		original.outputs = {}
		const before = structuredClone(original)
		expect(() =>
			editStudioSkillV2Batch(original, [{ kind: 'remove-step', stepId: producer.id }])
		).toThrow('Step "consumer" depends on "transform"')
		expect(() =>
			editStudioSkillV2Batch(original, [{ kind: 'remove-step', stepId: producer.id }])
		).toThrow('No edits in this batch were saved')
		expect(original).toEqual(before)
		const changed = editStudioSkillV2Batch(original, [
			{ kind: 'remove-step', stepId: producer.id },
			{ kind: 'set-after', stepId: 'consumer', after: [] }
		])
		expect(changed.definition.steps.map((step) => step.id)).toEqual(['consumer'])
		expect(changed.definition.steps[0]!.after).toEqual([])
		expect(() =>
			editStudioSkillV2(original, {
				kind: 'move-step',
				stepId: producer.id,
				beforeStepId: null
			})
		).toThrow('Move "transform" before "consumer" using move-step')
	})
	test('explains a missing edit discriminator and leaves the whole batch untouched', () => {
		const original = newStudioSkillV2('Unchanged')
		expect(() =>
			editStudioSkillV2Batch(original, [
				{ kind: 'rename', name: 'Must not escape' },
				{ stepId: 'calculate', parameter: 'operation', binding: { kind: 'literal', value: 'add' } }
			])
		).toThrow('Edit 2 failed: STUDIO_EDIT_INVALID: Every edit needs its own kind')
		expect(original.name).toBe('Unchanged')
	})
	test('removes public settings and their wires atomically, preserving fixed literals', () => {
		const operation = {
			...entry,
			parametersSchema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					operation: { type: 'string', maxLength: 16 },
					rounding: { type: 'string', maxLength: 16 },
					decimal_places: { type: 'integer', minimum: 0, maximum: 32 }
				},
				required: ['operation']
			}
		}
		const original = composeCatalogOperation(newStudioSkillV2('Multiply'), operation).definition
		const edited = editStudioSkillV2Batch(original, [
			{
				kind: 'set-parameter-binding',
				stepId: 'transform',
				parameter: 'operation',
				binding: { kind: 'literal', value: 'multiply' }
			},
			...['operation', 'rounding', 'decimal_places'].map((name) => ({
				kind: 'remove-public-parameter',
				name
			}))
		])
		expect(edited.definition.parametersSchema.properties).toEqual({})
		expect(edited.definition.steps[0]).toMatchObject({
			parameters: { operation: { kind: 'literal', value: 'multiply' } }
		})
		expect(Object.keys((edited.definition.steps[0] as any).parameters)).toEqual(['operation'])
		expect(Object.keys(original.parametersSchema.properties as object)).toHaveLength(3)
		expect(edited.changes[2]?.before).toMatchObject({
			disconnected: [{ stepId: 'transform', field: 'parameters', name: 'rounding' }]
		})
		const nested = structuredClone(original)
		nested.inputs.source = { ...source, cardinality: 'optional' }
		const child = nested.steps[0]!
		if (child.kind !== 'invoke') throw new Error('Expected the composed invocation')
		child.configuration = { rounding: { kind: 'parameter', name: 'rounding' } }
		nested.steps = [
			{
				id: 'optional_branch',
				kind: 'when',
				label: 'Optional processing',
				condition: { kind: 'presence', from: { kind: 'input', port: 'source' } },
				branches: { present: { steps: [child], outputs: {} }, absent: { steps: [], outputs: {} } },
				outputs: {}
			}
		]
		nested.outputs = {}
		const withoutRounding = editStudioSkillV2(nested, {
			kind: 'remove-public-parameter',
			name: 'rounding'
		})
		expect(withoutRounding.change.before).toMatchObject({
			disconnected: [
				{ stepId: 'transform', field: 'parameters', name: 'rounding' },
				{ stepId: 'transform', field: 'configuration', name: 'rounding' }
			]
		})
	})
	test('creates a safe blank Skill and reports inspectable semantic changes', () => {
		let definition = newStudioSkillV2('My Skill')
		const renamed = editStudioSkillV2(definition, { kind: 'rename', name: 'Daily brief' })
		expect(renamed.change).toEqual({ path: 'name', before: 'My Skill', after: 'Daily brief' })
		definition = renamed.definition
		const policy = editStudioSkillV2(definition, {
			kind: 'set-policy',
			field: 'allowModel',
			value: true
		})
		expect(policy.definition.policy.allowModel).toBe(true)
		const parameter = editStudioSkillV2(policy.definition, {
			kind: 'set-public-parameter',
			name: 'tone',
			schema: { type: 'string', maxLength: 32, enum: ['brief', 'detailed'] },
			required: true
		})
		expect(parameter.definition.parametersSchema).toMatchObject({
			required: ['tone'],
			properties: { tone: { type: 'string', maxLength: 32 } }
		})
	})

	test('edits stable step identities and refuses changes that leave dangling dataflow', () => {
		const composed = composeCatalogOperation(newStudioSkillV2('Flow'), entry).definition
		const labeled = editStudioSkillV2(composed, {
			kind: 'set-step-label',
			stepId: 'transform',
			label: 'Create the result'
		})
		expect(labeled.definition.steps[0]?.label).toBe('Create the result')
		expect(labeled.change.path).toBe('steps.transform.label')
		expect(() =>
			editStudioSkillV2(labeled.definition, { kind: 'remove-step', stepId: 'transform' })
		).toThrow('Bound producer "transform" is missing or does not precede')
		expect(() =>
			editStudioSkillV2(labeled.definition, {
				kind: 'set-port-binding',
				stepId: 'transform',
				port: 'source',
				binding: { kind: 'step', stepId: 'missing', port: 'result' }
			})
		).toThrow('Bound producer "missing" is missing or does not precede')
	})

	test('rejects ambiguous nested step IDs and untyped edit envelopes', () => {
		const duplicate = newStudioSkillV2('Branches') as unknown as Record<string, unknown>
		duplicate.inputs = { maybe: { ...source, cardinality: 'optional' } }
		duplicate.steps = [
			{
				id: 'route',
				kind: 'when',
				label: 'Route',
				condition: { kind: 'presence', from: { kind: 'input', port: 'maybe' } },
				branches: {
					present: {
						steps: [
							{
								id: 'same',
								kind: 'review',
								label: 'One',
								subjectSchema: source.schema,
								subjects: {},
								outputs: {}
							}
						],
						outputs: {}
					},
					absent: {
						steps: [
							{
								id: 'same',
								kind: 'review',
								label: 'Two',
								subjectSchema: source.schema,
								subjects: {},
								outputs: {}
							}
						],
						outputs: {}
					}
				},
				outputs: {}
			}
		]
		expect(() => parseStudioSkillV2(duplicate)).toThrow('unique across the whole Skill')
		expect(() =>
			editStudioSkillV2(newStudioSkillV2('Safe'), { kind: 'rename', name: 'x', extra: true })
		).toThrow('STUDIO_EDIT_INVALID')
	})
})
