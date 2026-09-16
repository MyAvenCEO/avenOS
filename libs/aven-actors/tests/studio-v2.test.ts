import { describe, expect, test } from 'bun:test'
import {
	ActorRegistry,
	definitionFromManifest,
	parseStudioSkillV2,
	presentSkillArtifact,
	StudioSkillV2Error,
	validateStudioSkillCapabilities,
	validateStudioSkillChildren
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
					parameters: { type: 'object', properties: {}, additionalProperties: false },
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
		const configured = program()
		configured.parametersSchema = {
			type: 'object',
			properties: { tone: { type: 'string', maxLength: 12, enum: ['brief', 'full'] } },
			required: ['tone'],
			additionalProperties: false
		}
		expect(presentSkillArtifact('skill-id', 'digest', 2, configured).parameters).toEqual([
			{ name: 'tone', type: 'choice', required: true, choices: ['brief', 'full'] }
		])
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

	test('checks installed contracts inside both conditional branches', () => {
		const first = structuredClone(program().steps[0]!)
		first.id = 'first'
		const second = structuredClone(program().steps[0]!)
		second.id = 'second'
		second.capabilityId = 'ceo.aven:capability:missing.inspect:run@1'
		const branch = (step: typeof first) => ({
			steps: [step],
			outputs: {
				summary: { kind: 'step', stepId: step.id, port: 'summary' },
				details: { kind: 'step', stepId: step.id, port: 'details' }
			}
		})
		const p = program()
		p.steps = [
			{
				id: 'route',
				kind: 'when',
				label: 'Route by observation',
				condition: { kind: 'observation', from: { kind: 'input', port: 'source' }, caseId: 'yes' },
				branches: { yes: branch(first), otherwise: branch(second) },
				outputs: { summary, details }
			}
		] as never
		p.outputs.summary.from.stepId = 'route'
		p.outputs.details.from.stepId = 'route'
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(p), registry())
		expect(
			issues.some(
				(issue) =>
					issue.code === 'CAPABILITY_UNAVAILABLE' &&
					issue.path === 'steps.0.branches.otherwise.steps.0'
			)
		).toBe(true)
	})

	test('blocks a malformed public method schema even with no parameter bindings', () => {
		const actors = new ActorRegistry()
		const manifest = registry().definitions[0]!.manifest
		actors.registerDefinition(
			definitionFromManifest({
				...manifest,
				methods: [
					{
						...manifest.methods[0]!,
						parameters: { type: 'object' }
					}
				]
			})
		)
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(program()), actors.snapshot())
		expect(issues.some((issue) => issue.code === 'CONTRACT_INCOMPLETE')).toBe(true)
	})

	test('requires method parameters and does not admit unverifiable configuration', () => {
		const actors = new ActorRegistry()
		const manifest = registry().definitions[0]!.manifest
		actors.registerDefinition(
			definitionFromManifest({
				...manifest,
				methods: [
					{
						...manifest.methods[0]!,
						parameters: {
							type: 'object',
							properties: { count: { type: 'integer', minimum: 1, maximum: 3 } },
							required: ['count'],
							additionalProperties: false
						}
					}
				]
			})
		)
		const p = program()
		p.steps[0].configuration = { private_address: { kind: 'literal', value: 'localhost' } } as never
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(p), actors.snapshot())
		expect(issues.map((issue) => issue.code)).toContain('MISSING_PARAMETER')
		expect(issues.map((issue) => issue.code)).toContain('CONFIGURATION_UNVERIFIED')
	})

	test('requires every non-optional installed input, including many-valued ports', () => {
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
								name: 'records',
								predicate: source.predicate,
								schema: source.schema,
								role: source.role,
								cardinality: 'many'
							}
						]
					}
				]
			})
		)
		const issues = validateStudioSkillCapabilities(parseStudioSkillV2(program()), actors.snapshot())
		expect(issues).toContainEqual(
			expect.objectContaining({ code: 'MISSING_PORT', path: 'steps.0.inputs.records' })
		)
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
		const undeclared = program()
		undeclared.steps[0].parameters = { query: { kind: 'literal', value: 'hello' } } as never
		expect(
			validateStudioSkillCapabilities(parseStudioSkillV2(undeclared), registry()).some(
				(issue) => issue.code === 'UNDECLARED_PARAMETER'
			)
		).toBe(true)
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
						present: {
							steps: [
								{
									id: 'review-present',
									kind: 'review',
									label: 'Review present value',
									subjectSchema: source.schema,
									subjects: { source: { kind: 'input', port: 'source' } },
									outputs: { answer: optional }
								}
							],
							outputs: {
								answer: { kind: 'step', stepId: 'review-present', port: 'answer' }
							}
						},
						absent: { steps: [], outputs: { answer: { kind: 'none' } } }
					},
					outputs: { answer: optional }
				}
			],
			outputs: { answer: { ...optional, from: { kind: 'step', stepId: 'route', port: 'answer' } } }
		}
		expect(parseStudioSkillV2(branched).steps[0]?.kind).toBe('when')
		const presentation = presentSkillArtifact('skill-id', 'digest', 2, branched)
		expect(presentation.steps).toHaveLength(2)
		expect(presentation.steps[1]).toMatchObject({
			id: 'review-present',
			depth: 1,
			context: 'Check presence · present'
		})
		expect(presentation.structure).toMatchObject({ branches: 1, reviews: 1 })
		const leaked = structuredClone(branched)
		leaked.outputs.answer.from.stepId = 'inner'
		expect(() => parseStudioSkillV2(leaked)).toThrow('Bind to a preceding step')
		const missing = structuredClone(branched)
		missing.steps[0].branches.absent.outputs = {} as never
		expect(() => parseStudioSkillV2(missing)).toThrow('Every branch must bind')
	})

	test('narrows an optional artifact to one inside the present branch', () => {
		const optional = { ...source, cardinality: 'optional' as const }
		const invoke = structuredClone(program().steps[0]!)
		invoke.id = 'inspect-present'
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
						present: {
							steps: [invoke],
							outputs: {}
						},
						absent: {
							steps: [],
							outputs: {}
						}
					},
					outputs: {}
				}
			],
			outputs: {}
		}
		const parsed = parseStudioSkillV2(branched)
		expect(validateStudioSkillCapabilities(parsed, registry())).not.toContainEqual(
			expect.objectContaining({ code: 'INPUT_CONTRACT_MISMATCH' })
		)
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
		const childId = loop.steps[0].childSkillArtifactId
		const parameterized = program()
		parameterized.parametersSchema = {
			type: 'object',
			properties: { tone: { type: 'string', maxLength: 12 } },
			required: ['tone'],
			additionalProperties: false
		}
		expect(
			validateStudioSkillChildren(
				parseStudioSkillV2(loop),
				new Map([[childId, parseStudioSkillV2(parameterized)]])
			).some((issue) => issue.code === 'CHILD_PARAMETER_UNAVAILABLE')
		).toBe(true)
	})

	test('nested Skills use exact saved interfaces and reject cycles', () => {
		const childId = '12345678-1234-4234-8234-123456789abc'
		const child = parseStudioSkillV2(program())
		const parent = program()
		parent.steps[0] = {
			id: 'child',
			kind: 'skill',
			label: 'Reuse exact child',
			skillArtifactId: childId,
			skillVersion: 2,
			inputs: { source: { kind: 'input', port: 'source' } },
			parameters: {},
			outputs: { summary, details }
		} as never
		parent.outputs.summary.from.stepId = 'child'
		parent.outputs.details.from.stepId = 'child'
		expect(
			validateStudioSkillChildren(parseStudioSkillV2(parent), new Map([[childId, child]]))
		).toEqual([])
		const forgedInput = structuredClone(parent)
		forgedInput.inputs.source.schema = 'fixture:forged@1'
		expect(
			validateStudioSkillChildren(
				parseStudioSkillV2(forgedInput),
				new Map([[childId, child]])
			).some((issue) => issue.code === 'CHILD_INPUT_MISMATCH')
		).toBe(true)
		const parameterized = structuredClone(child)
		parameterized.parametersSchema = {
			type: 'object',
			properties: {
				title: { type: 'string', maxLength: 12 }
			},
			required: ['title'],
			additionalProperties: false
		}
		const wrongParameter = structuredClone(parent)
		wrongParameter.steps[0].parameters = {
			title: { kind: 'literal', value: 'This title is too long' }
		} as never
		expect(
			validateStudioSkillChildren(
				parseStudioSkillV2(wrongParameter),
				new Map([[childId, parseStudioSkillV2(parameterized)]])
			).some((issue) => issue.code === 'CHILD_PARAMETER_MISMATCH')
		).toBe(true)
		const wrong = structuredClone(parent)
		wrong.outputs = { summary: wrong.outputs.summary } as never
		wrong.steps[0].outputs = { summary } as never
		expect(
			validateStudioSkillChildren(parseStudioSkillV2(wrong), new Map([[childId, child]])).some(
				(issue) => issue.code === 'CHILD_INTERFACE_MISMATCH'
			)
		).toBe(true)
		const recursive = program()
		recursive.steps[0] = parent.steps[0] as never
		recursive.outputs.summary.from.stepId = 'child'
		recursive.outputs.details.from.stepId = 'child'
		expect(
			validateStudioSkillChildren(
				parseStudioSkillV2(recursive),
				new Map([[childId, parseStudioSkillV2(recursive)]]),
				childId
			).some((issue) => issue.code === 'CYCLE')
		).toBe(true)
	})
})
