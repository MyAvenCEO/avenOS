import { describe, expect, test } from 'bun:test'
import {
	ActorRegistry,
	definitionFromManifest,
	parseStudioSkillV2,
	presentSkillArtifact,
	StudioSkillV2Error,
	validateStudioSkillCapabilities
} from '../src'

const source = {
	schema: 'fixture:input@1',
	type: { key: 'fixture.input', version: 1 },
	predicate: 'fixture.input(X)',
	role: 'source',
	cardinality: 'one' as const
}
const summary = {
	schema: 'fixture:summary@1',
	type: { key: 'fixture.summary', version: 1 },
	predicate: 'fixture.summary(X)',
	role: 'summary',
	cardinality: 'one' as const
}
const details = {
	schema: 'fixture:details@1',
	type: { key: 'fixture.details', version: 1 },
	predicate: 'fixture.details(X)',
	role: 'details',
	cardinality: 'one' as const
}
const capabilityId = 'ceo.aven:capability:studio-fixture.inspect:run@1'

function program() {
	return {
		version: 2,
		name: 'Inspect a record',
		inputs: { source },
		parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
		steps: [
			{
				id: 'inspect',
				kind: 'invoke',
				label: 'Inspect record',
				capabilityId,
				inputs: { source: { kind: 'input', port: 'source' } },
				parameters: {},
				outputs: { summary, details }
			}
		],
		outputs: {
			summary: { ...summary, from: { kind: 'step', stepId: 'inspect', port: 'summary' } },
			details: { ...details, from: { kind: 'step', stepId: 'inspect', port: 'details' } }
		},
		policy: {
			maxInvocations: 16,
			maxDepth: 4,
			maxMembers: 32,
			maxConcurrentChildren: 2,
			allowModel: false
		}
	}
}

function registry() {
	const actors = new ActorRegistry()
	actors.registerDefinition(
		definitionFromManifest({
			id: 'inspect',
			authority: 'ceo.aven',
			namespace: 'studio-fixture',
			version: '1',
			name: 'Inspector',
			description: 'Inspect fixture records.',
			tags: [],
			methods: [
				{
					name: 'run',
					description: 'Inspect.',
					parameters: { type: 'object' },
					mode: 'transform',
					idempotency: 'pure',
					requires: [source.predicate],
					produces: [summary.predicate, details.predicate],
					inputSlots: [
						{
							name: 'source',
							predicate: source.predicate,
							schema: source.schema,
							role: source.role,
							cardinality: 'one'
						}
					],
					outputSlots: [
						{
							name: 'summary',
							predicate: summary.predicate,
							schema: summary.schema,
							role: summary.role,
							cardinality: 'one'
						},
						{
							name: 'details',
							predicate: details.predicate,
							schema: details.schema,
							role: details.role,
							cardinality: 'one'
						}
					]
				}
			]
		})
	)
	return actors.snapshot()
}

describe('v2 Skill contract and pure presentation', () => {
	test('preserves named multiple outputs and checks the installed method', () => {
		const definition = parseStudioSkillV2(program())
		expect(Object.keys(definition.outputs)).toEqual(['summary', 'details'])
		expect(validateStudioSkillCapabilities(definition, registry())).toEqual([])
		const card = presentSkillArtifact('skill-id', 'digest', 2, program())
		expect(card.status).toBe('valid')
		expect(card.outputs.map((output) => output.name)).toEqual(['summary', 'details'])
		expect(card.effectCoverage).toBe('unknown')
	})

	test('rejects forward references, type changes, and arbitrary executable fields', () => {
		const forward = program()
		forward.steps[0].inputs.source = { kind: 'step', stepId: 'later', port: 'summary' } as never
		expect(() => parseStudioSkillV2(forward)).toThrow(StudioSkillV2Error)
		const wrong = program()
		wrong.outputs.summary.type = { ...wrong.outputs.summary.type, version: 2 }
		expect(() => parseStudioSkillV2(wrong)).toThrow('Output interface does not match')
		expect(() => parseStudioSkillV2({ ...program(), executable: 'eval(text)' })).toThrow(
			'Unknown field'
		)
	})

	test('does not let a caller bind a protected method slot as an ordinary artifact', () => {
		const actors = new ActorRegistry()
		const manifest = registry().definitions[0]!.manifest
		actors.registerDefinition(
			definitionFromManifest({
				...manifest,
				methods: [
					{
						...manifest.methods[0]!,
						inputSlots: [
							...manifest.methods[0]!.inputSlots!,
							{
								name: 'credential',
								predicate: 'fixture.secret(X)',
								schema: 'fixture:secret@1',
								cardinality: 'one',
								sensitive: true
							}
						]
					}
				]
			})
		)
		const p = program()
		p.steps[0].inputs.credential = { kind: 'input', port: 'source' } as never
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(p), actors.snapshot())
		expect(issues.some((issue) => issue.code === 'PROTECTED_INPUT')).toBe(true)
	})

	test('checks the bound input against the installed contract, not the caller declaration', () => {
		const changed = program()
		changed.inputs.source = { ...source, schema: 'fixture:forged@1' }
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(changed), registry())
		expect(issues.some((issue) => issue.code === 'INPUT_CONTRACT_MISMATCH')).toBe(true)
		const forged = program()
		forged.inputs.source = { ...source, predicate: 'fixture.input(private)' }
		expect(
			validateStudioSkillCapabilities(parseStudioSkillV2(forged), registry()).some(
				(issue) => issue.code === 'INPUT_CONTRACT_MISMATCH'
			)
		).toBe(true)
		const wrongRole = program()
		wrongRole.steps[0].outputs.summary = { ...summary, role: 'private' }
		wrongRole.outputs.summary.role = 'private'
		expect(
			validateStudioSkillCapabilities(parseStudioSkillV2(wrongRole), registry()).some(
				(issue) => issue.code === 'OUTPUT_CONTRACT_MISMATCH'
			)
		).toBe(true)
	})

	test('shows a bounded unsupported card for another immutable version', () => {
		const card = presentSkillArtifact('skill-id', 'digest', 3, { version: 3, name: 'Future' })
		expect(card.status).toBe('unsupported-version')
		expect(card.steps).toEqual([])
	})

	test('rejects unbounded or executable public parameter schemas and dangling bindings', () => {
		const unbounded = program()
		unbounded.parametersSchema = {
			type: 'object',
			properties: { query: { type: 'string' } },
			additionalProperties: false
		} as never
		expect(() => parseStudioSkillV2(unbounded)).toThrow('bounded length')
		const reference = program()
		reference.parametersSchema = {
			type: 'object',
			properties: {},
			additionalProperties: false,
			$ref: 'https://example.com/private'
		} as never
		expect(() => parseStudioSkillV2(reference)).toThrow('Unknown field')
		const dangling = program()
		dangling.steps[0].parameters = { query: { kind: 'parameter', name: 'undeclared' } } as never
		expect(() => parseStudioSkillV2(dangling)).toThrow('Public parameter is not declared')
	})

	test('presence branches merge named ports without leaking branch-local steps', () => {
		const optional = { ...source, cardinality: 'optional' as const }
		const branched = {
			...program(),
			inputs: { source: optional },
			steps: [
				{
					id: 'route',
					kind: 'when',
					label: 'Check presence',
					condition: { kind: 'presence', from: { kind: 'input', port: 'source' } },
					branches: {
						present: { steps: [], outputs: { answer: { kind: 'input', port: 'source' } } },
						absent: { steps: [], outputs: { answer: { kind: 'none' } } }
					},
					outputs: { answer: optional }
				}
			],
			outputs: { answer: { ...optional, from: { kind: 'step', stepId: 'route', port: 'answer' } } }
		}
		expect(parseStudioSkillV2(branched).steps[0]?.kind).toBe('when')
		const leaked = structuredClone(branched)
		leaked.outputs.answer.from.stepId = 'inner'
		expect(() => parseStudioSkillV2(leaked)).toThrow('Bind to a preceding step')
		const missing = structuredClone(branched)
		missing.steps[0].branches.absent.outputs = {} as never
		expect(() => parseStudioSkillV2(missing)).toThrow('Every branch must bind')
	})

	test('collection children require one exact item binding and sealed outputs', () => {
		const collection = { ...source, cardinality: 'many' as const }
		const result = { ...summary, cardinality: 'many' as const }
		const loop = {
			...program(),
			inputs: { source: collection },
			steps: [
				{
					id: 'each',
					kind: 'forEach',
					label: 'Inspect each',
					collection: { kind: 'input', port: 'source' },
					itemName: 'item',
					childSkillArtifactId: '12345678-1234-4234-8234-123456789abc',
					childInputs: { source: { kind: 'item', loopId: 'each' } },
					concurrency: 2,
					failureMode: 'fail-fast',
					outputs: { result }
				}
			],
			outputs: { result: { ...result, from: { kind: 'step', stepId: 'each', port: 'result' } } }
		}
		expect(parseStudioSkillV2(loop).steps[0]?.kind).toBe('forEach')
		const wrong = structuredClone(loop)
		wrong.steps[0].childInputs.source.loopId = 'other'
		expect(() => parseStudioSkillV2(wrong)).toThrow('Bind exactly one child input')
	})
})
