import { describe, expect, test } from 'bun:test'
import {
	composeCatalogOperation,
	parseStudioSkillV2,
	type StudioCatalogEntry,
	type StudioSkillV2
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

function definition(): StudioSkillV2 {
	return parseStudioSkillV2({
		version: 2,
		name: 'Fixture flow',
		inputs: {},
		parametersSchema: {
			type: 'object',
			properties: {},
			required: [],
			additionalProperties: false,
			maxProperties: 0
		},
		steps: [],
		outputs: {},
		policy: {
			maxInvocations: 8,
			maxDepth: 4,
			maxMembers: 32,
			maxConcurrentChildren: 2,
			allowModel: false
		}
	})
}

function entry(overrides: Partial<StudioCatalogEntry> = {}): StudioCatalogEntry {
	return {
		actorId: 'ceo.aven:actor:fixture:worker@1',
		capabilityId: 'ceo.aven:capability:fixture:transform@1',
		version: '1',
		installationDigest: 'a'.repeat(64),
		label: 'Fixture · transform',
		description: 'Transform a fixture.',
		tags: ['test'],
		mode: 'transform',
		parametersSchema: {
			type: 'object',
			properties: {
				tone: { type: 'string', maxLength: 32 },
				detail: { type: 'boolean' }
			},
			required: ['tone'],
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
		canInvokeNow: false,
		...overrides
	}
}

describe('catalog-driven v2 composition', () => {
	test('turns an operation into a valid reusable Skill without manual wiring', () => {
		const composed = composeCatalogOperation(definition(), entry())
		expect(composed.stepId).toBe('transform')
		expect(composed.definition.inputs).toEqual({ source })
		expect(composed.definition.parametersSchema).toMatchObject({
			required: ['tone'],
			maxProperties: 2,
			properties: {
				tone: { type: 'string', maxLength: 32 },
				detail: { type: 'boolean' }
			}
		})
		expect(composed.definition.steps[0]).toMatchObject({
			kind: 'invoke',
			inputs: { source: { kind: 'input', port: 'source' } },
			parameters: {
				tone: { kind: 'parameter', name: 'tone' },
				detail: { kind: 'parameter', name: 'detail' }
			},
			outputs: { result }
		})
		expect(composed.definition.outputs.result).toEqual({
			...result,
			from: { kind: 'step', stepId: 'transform', port: 'result' }
		})
		expect(composed.cues.map((cue) => cue.kind)).toEqual([
			'new-input',
			'new-parameter',
			'new-parameter'
		])
	})

	test('connects the newest exact output and leaves an unmatched optional port empty', () => {
		const first = composeCatalogOperation(definition(), entry()).definition
		const next = entry({
			capabilityId: 'ceo.aven:capability:fixture:finish@1',
			parametersSchema: {
				type: 'object',
				properties: {},
				required: [],
				additionalProperties: false
			},
			inputs: [
				{ name: 'result', ...result, sensitive: false },
				{
					name: 'context',
					schema: 'fixture:context@1',
					type: { key: 'fixture.context', version: 1 },
					predicate: 'fixture.context(X)',
					role: 'context',
					cardinality: 'optional',
					sensitive: false
				}
			],
			outputs: []
		})
		const composed = composeCatalogOperation(first, next)
		expect(composed.definition.steps[1]).toMatchObject({
			inputs: {
				result: { kind: 'step', stepId: 'transform', port: 'result' },
				context: { kind: 'none' }
			}
		})
		expect(composed.cues).toEqual([
			{ kind: 'connected', name: 'result', from: 'Fixture · transform · result' },
			{ kind: 'optional', name: 'context' }
		])
	})

	test('keeps protected inputs out of the artifact graph and rejects blocked entries', () => {
		const protectedEntry = entry({
			inputs: [
				{ name: 'source', ...source, sensitive: false },
				{
					name: 'credential',
					predicate: 'fixture.credential(X)',
					role: 'credential',
					cardinality: 'one',
					sensitive: true
				}
			]
		})
		const composed = composeCatalogOperation(definition(), protectedEntry)
		expect(composed.definition.steps[0]).not.toHaveProperty('inputs.credential')
		expect(composed.cues).toContainEqual({ kind: 'protected', name: 'credential' })
		expect(() =>
			composeCatalogOperation(definition(), entry({ canAuthor: false }))
		).toThrow('STUDIO_OPERATION_NOT_AUTHORABLE')
	})

	test('accepts a valid method schema that omits the optional required list', () => {
		const optionalOnly = entry({
			parametersSchema: {
				type: 'object',
				properties: { detail: { type: 'boolean' } },
				additionalProperties: false
			}
		})
		const composed = composeCatalogOperation(definition(), optionalOnly)
		expect(composed.definition.parametersSchema.required).toEqual([])
		expect(composed.definition.steps[0]).toMatchObject({
			parameters: { detail: { kind: 'parameter', name: 'detail' } }
		})
	})
})
