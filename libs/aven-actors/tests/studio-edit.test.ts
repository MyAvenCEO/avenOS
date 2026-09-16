import { describe, expect, test } from 'bun:test'
import {
	composeCatalogOperation,
	editStudioSkillV2,
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
	canInvokeNow: false
}

describe('v2 semantic Skill edits', () => {
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
    ).toThrow('Bind to a preceding step')
		expect(() =>
			editStudioSkillV2(labeled.definition, {
				kind: 'set-port-binding',
				stepId: 'transform',
				port: 'source',
				binding: { kind: 'step', stepId: 'missing', port: 'result' }
			})
		).toThrow('Bind to a preceding step')
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
						steps: [{ id: 'same', kind: 'review', label: 'One', subjectSchema: source.schema,
							subjects: {}, outputs: {} }], outputs: {}
					},
					absent: {
						steps: [{ id: 'same', kind: 'review', label: 'Two', subjectSchema: source.schema,
							subjects: {}, outputs: {} }], outputs: {}
					}
				},
				outputs: {}
			}
		]
		expect(() => parseStudioSkillV2(duplicate)).toThrow('unique across the whole Skill')
		expect(() => editStudioSkillV2(newStudioSkillV2('Safe'), { kind: 'rename', name: 'x', extra: true }))
			.toThrow('STUDIO_EDIT_INVALID')
	})
})
