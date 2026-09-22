import { describe, expect, test } from 'bun:test'
import { newStudioSkillV2 } from '../src/studio/edit'
import {
	executeStudioProgram,
	type StudioProgramArtifact,
	type StudioProgramHost
} from '../src/studio/program'
import type { StudioSkillPort, StudioSkillV2 } from '../src/studio/v2'

const port: StudioSkillPort = {
	schema: 'ceo.aven:schema:docs:file@1',
	type: { key: 'core.file', version: 1 },
	predicate: 'ceo.aven.docs.file(F)',
	role: 'source',
	cardinality: 'one'
}
const childId = '11111111-1111-4111-8111-111111111111'
const value = (id: string, payload = {}): StudioProgramArtifact => ({
	artifactId: id,
	typeKey: 'core.file',
	typeVersion: 1,
	payload
})
function child(): StudioSkillV2 {
	return {
		...newStudioSkillV2('Read one page'),
		inputs: { source: port },
		steps: [
			{
				id: 'read',
				label: 'Read',
				kind: 'invoke',
				capabilityId: 'ceo.aven:capability:docs:read@1',
				inputs: { source: { kind: 'input', port: 'source' } },
				parameters: {},
				outputs: { result: port }
			}
		],
		outputs: { result: { ...port, from: { kind: 'step', stepId: 'read', port: 'result' } } }
	}
}
function loop(): StudioSkillV2 {
	return {
		...newStudioSkillV2('Read every page'),
		inputs: { pages: { ...port, cardinality: 'many' } },
		steps: [
			{
				kind: 'forEach',
				id: 'pages',
				label: 'Each page',
				collection: { kind: 'input', port: 'pages' },
				itemName: 'page',
				childSkillArtifactId: childId,
				childInputs: { source: { kind: 'item', loopId: 'pages' } },
				concurrency: 2,
				failureMode: 'fail-fast',
				outputs: { result: { ...port, cardinality: 'many' } }
			}
		],
		outputs: {
			result: {
				...port,
				cardinality: 'many',
				from: { kind: 'step', stepId: 'pages', port: 'result' }
			}
		}
	}
}
function harness(
	definition: StudioSkillV2,
	ids: string[],
	childDefinition = child(),
	invoke?: StudioProgramHost['invoke'],
	signal?: AbortSignal
) {
	const calls: string[] = [],
		policies: boolean[] = []
	const run = executeStudioProgram({
		definition,
		children: new Map([[childId, childDefinition]]),
		inputs: { pages: ids },
		parameters: {},
		signal,
		host: {
			read: async (id) => value(id),
			invoke: async (request) => {
				calls.push(request.id)
				policies.push(request.allowModel)
				return invoke ? invoke(request) : { result: request.inputs.source! }
			}
		}
	})
	return { run, calls, policies }
}
describe('bounded named Studio programs', () => {
	test('input-field bindings read only the exact bound artifact payload and retain its input', async () => {
		const definition = child()
		const step = definition.steps[0] as Extract<
			(typeof definition.steps)[number],
			{ kind: 'invoke' }
		>
		step.parameters = {
			content: { kind: 'input-field', port: 'source', path: '/data/a~1b/~0text' }
		}
		let observed: unknown
		const run = (payload: Record<string, unknown>) =>
			executeStudioProgram({
				definition,
				children: new Map(),
				inputs: { source: 'file' },
				parameters: {},
				host: {
					read: async (id) => value(id, payload),
					invoke: async (request) => {
						observed = request
						return { result: request.inputs.source! }
					}
				}
			})
		await run({ data: { 'a/b': { '~text': '# Generated Markdown' } } })
		expect(observed).toMatchObject({
			parameters: { content: '# Generated Markdown' },
			inputs: { source: [{ artifactId: 'file' }] }
		})
		await expect(run({ data: {} })).rejects.toThrow('STUDIO_INPUT_FIELD_MISSING')
		step.parameters.content = { kind: 'input-field', port: 'unbound', path: '/text' }
		await expect(run({ text: 'must not be read' })).rejects.toThrow('bound input port')
	})
	test('ordered collection, exact nested child, and sealed empty collection', async () => {
		const f = harness(loop(), ['a', 'b', 'c'])
		expect((await f.run).outputs.result!.map((a) => a.artifactId)).toEqual(['a', 'b', 'c'])
		expect(f.calls).toEqual(['root.pages.0.read', 'root.pages.1.read', 'root.pages.2.read'])
		const empty = harness(loop(), [])
		expect((await empty.run).outputs).toEqual({ result: [] })
		expect(empty.calls).toEqual([])
	})
	test('parent invocation budget counts all nested calls before invoking the next one', async () => {
		const definition = loop()
		definition.policy.maxInvocations = 1
		const f = harness(definition, ['a', 'b'])
		await expect(f.run).rejects.toThrow('STUDIO_INVOCATIONS_LIMIT')
		expect(f.calls).toHaveLength(1)
	})
	test('collection and depth bounds fail before child work', async () => {
		const bounded = loop()
		bounded.policy.maxMembers = 1
		const tooMany = harness(bounded, ['a', 'b'])
		await expect(tooMany.run).rejects.toThrow('STUDIO_INPUT_BINDINGS_INVALID')
		expect(tooMany.calls).toEqual([])
		const shallow = loop()
		shallow.policy.maxDepth = 1
		const tooDeep = harness(shallow, ['a'])
		await expect(tooDeep.run).rejects.toThrow('STUDIO_DEPTH_LIMIT')
		expect(tooDeep.calls).toEqual([])
	})
	test('a child cannot widen the parent model policy', async () => {
		const nested = child()
		nested.policy.allowModel = true
		const f = harness(loop(), ['a'], nested)
		await f.run
		expect(f.policies).toEqual([false])
	})
	test('cancellation after an invocation prevents subsequent child work', async () => {
		const abort = new AbortController()
		const f = harness(
			loop(),
			['a', 'b'],
			child(),
			async (request) => {
				abort.abort()
				return { result: request.inputs.source! }
			},
			abort.signal
		)
		await expect(f.run).rejects.toThrow()
		expect(f.calls).toHaveLength(1)
	})
	test('typed output rejection does not continue to the next member', async () => {
		const f = harness(loop(), ['a', 'b'], child(), async () => ({
			result: [{ ...value('wrong'), typeKey: 'studio.email' }]
		}))
		await expect(f.run).rejects.toThrow('STUDIO_PORT_TYPE')
		expect(f.calls).toHaveLength(1)
	})
	test.each([true, false])(
		'observation branch compares actual boolean data: %s',
		async (complete) => {
			const definition: StudioSkillV2 = {
				...newStudioSkillV2('OCR only if incomplete'),
				inputs: { source: port },
				steps: [
					{
						kind: 'when',
						id: 'quality',
						label: 'Needs OCR?',
						condition: {
							kind: 'observation',
							from: { kind: 'input', port: 'source' },
							path: '/complete',
							equals: false,
							caseId: 'ocr'
						},
						branches: {
							ocr: {
								steps: child().steps,
								outputs: { result: { kind: 'step', stepId: 'read', port: 'result' } }
							},
							otherwise: { steps: [], outputs: { result: { kind: 'input', port: 'source' } } }
						},
						outputs: { result: port }
					}
				],
				outputs: { result: { ...port, from: { kind: 'step', stepId: 'quality', port: 'result' } } }
			}
			const calls: string[] = []
			const result = await executeStudioProgram({
				definition,
				children: new Map(),
				inputs: { source: 'native' },
				parameters: {},
				host: {
					read: async (id) => value(id, { complete }),
					invoke: async (request) => {
						calls.push(request.id)
						return { result: [value('ocr')] }
					}
				}
			})
			expect(result.outputs.result![0]!.artifactId).toBe(complete ? 'native' : 'ocr')
			expect(calls.length).toBe(complete ? 0 : 1)
		}
	)
})
