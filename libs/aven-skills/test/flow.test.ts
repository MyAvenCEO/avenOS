import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
	ACTOR_MAPPING,
	currentStepIndex,
	EXAMPLE_FLOWS,
	EXAMPLE_RUNS,
	exampleInstance,
	FLOW_SCHEMA,
	type Flow,
	flattenFlow,
	flowDepths,
	isComposite,
	isFanIn,
	isFanOut,
	isLeaf,
	resourceSchema,
	runStateOf,
	runsForFlow,
	TOOL_SPECS,
	validateFlow
} from '../src/flow.js'

// board 0084 — clean rebuild. The engine (schema/helpers) is exercised on small inline fixtures so
// it stays independent of the shipped skills; the shipped skills are then checked one at a time.

const ajv = new Ajv({ allErrors: true, strict: false })
const validateSchema = ajv.compile(FLOW_SCHEMA)

// tiny typed builders for engine fixtures
type N = Flow['nodes'][number]
const leaf = (id: string, inputs: string[], outputs: string[], extra: Partial<N> = {}): N => ({
	id,
	name: id,
	actor: id,
	inputs,
	outputs,
	...extra
})
const mk = (id: string, nodes: N[], edges: Flow['edges']): Flow => ({
	id,
	name: id,
	description: '',
	nodes,
	edges
})

describe('flow engine', () => {
	test('every shipped skill is schema-valid + structurally sound', () => {
		expect(EXAMPLE_FLOWS.length).toBeGreaterThanOrEqual(1)
		for (const f of EXAMPLE_FLOWS) {
			expect(validateSchema(f)).toBe(true)
			expect(validateFlow(f)).toEqual([])
			expect(f.name).toBeTruthy()
		}
	})

	test('universal-first: an arbitrary non-domain flow validates + flattens', () => {
		const g = mk(
			'a-to-b',
			[leaf('mk', ['a'], ['b']), leaf('use', ['b'], ['c'])],
			[{ from: 'mk', to: 'use', resource: 'b' }]
		)
		expect(validateSchema(g)).toBe(true)
		expect(validateFlow(g)).toEqual([])
		expect(flowDepths(g).use).toBeGreaterThan(flowDepths(g).mk)
	})

	test('fan-out / fan-in helpers', () => {
		expect(isFanOut(leaf('x', ['a'], ['b', 'c']))).toBe(true)
		expect(isFanIn(leaf('y', ['a', 'b'], ['c']))).toBe(true)
		expect(isFanOut(leaf('z', ['a'], ['b']))).toBe(false)
	})

	test('composite (flowRef) + flattenFlow inline a sub-skill', () => {
		const sub = mk('sub', [leaf('s1', ['a'], ['b'])], [])
		const top = mk(
			'top',
			[
				{ id: 'c', name: 'c', flowRef: 'sub', inputs: ['a'], outputs: ['b'] },
				leaf('t', ['b'], ['c'])
			],
			[{ from: 'c', to: 't', resource: 'b' }]
		)
		expect(isComposite(top.nodes[0])).toBe(true)
		expect(isLeaf(top.nodes[1])).toBe(true)
		const flat = flattenFlow(top, [top, sub])
		expect(flat.nodes.every(isLeaf)).toBe(true)
		expect(flat.nodes.some((n) => n.id === 'c/s1')).toBe(true)
	})

	test('validateFlow flags a cycle, an orphan, and a type-incompatible edge', () => {
		expect(
			validateFlow(
				mk(
					'cyc',
					[leaf('x', ['a'], ['a']), leaf('y', ['a'], ['a'])],
					[
						{ from: 'x', to: 'y', resource: 'a' },
						{ from: 'y', to: 'x', resource: 'a' }
					]
				)
			).some((p) => /cycle/.test(p))
		).toBe(true)
		expect(
			validateFlow(
				mk(
					'orp',
					[leaf('a', ['x'], ['y']), leaf('b', ['x'], ['y']), leaf('lonely', ['z'], ['w'])],
					[{ from: 'a', to: 'b', resource: 'y' }]
				)
			).some((p) => /unreachable/.test(p))
		).toBe(true)
		expect(
			validateFlow(
				mk(
					'mis',
					[leaf('a', ['x'], ['y']), leaf('b', ['z'], ['w'])],
					[{ from: 'a', to: 'b', resource: 'y' }]
				)
			).some((p) => /b\.inputs/.test(p))
		).toBe(true)
	})

	test('flattenFlow throws on a reference cycle', () => {
		const a = mk('a', [{ id: 'n', name: 'n', flowRef: 'b', inputs: ['x'], outputs: ['y'] }], [])
		const b = mk('b', [{ id: 'm', name: 'm', flowRef: 'a', inputs: ['y'], outputs: ['x'] }], [])
		expect(() => flattenFlow(a, [a, b])).toThrow(/cycle/)
	})

	test('ACTOR_MAPPING encodes the node↔actor contract', () => {
		const froms = ACTOR_MAPPING.map((m) => m.flow)
		expect(froms).toContain('RecipeNode')
		expect(froms).toContain('Composite (flowRef)')
	})

	test('capability layer: typed ToolSpec registry', () => {
		expect(TOOL_SPECS.classify_document?.name).toBe('classify_document')
		expect(TOOL_SPECS.classify_document?.output).toBeTruthy()
	})

	test('resourceSchema links persisted kinds to the DB; ephemeral are undefined', () => {
		expect(resourceSchema('invoice')).toBe('invoice')
		expect(resourceSchema('document')).toBeUndefined()
	})
})

describe('doc-ingest skill', () => {
	const doc = EXAMPLE_FLOWS.find((f) => f.id === 'doc-ingest') as Flow

	test('is ingest (store → fs) then classify (LLM)', () => {
		expect(doc.nodes.map((n) => n.id)).toEqual(['ingest', 'classify'])
		expect(doc.edges).toEqual([expect.objectContaining({ from: 'ingest', to: 'classify' })])
		const ingest = doc.nodes.find((n) => n.id === 'ingest')!
		const classify = doc.nodes.find((n) => n.id === 'classify')!
		expect(ingest.tools).toContain('sparkWriteBytes')
		expect(classify.llm?.model).toBeTruthy()
		expect(classify.tools).toContain('classify_document')
		expect(classify.system_prompt).toBeTruthy()
	})

	test('lays out ingest → classify in columns', () => {
		const d = flowDepths(doc)
		expect(d.ingest).toBe(0)
		expect(d.classify).toBe(1)
	})

	test('carries the actor fields (supervision / triggers / edge.kind)', () => {
		expect((doc.triggers?.length ?? 0) > 0).toBe(true)
		expect(doc.nodes.every((n) => !!n.supervision)).toBe(true)
		expect(doc.edges.every((e) => !!e.kind)).toBe(true)
	})
})

describe('runs', () => {
	test('the doc-ingest run traces ingest → classify with a vibe', () => {
		const run = EXAMPLE_RUNS.find((r) => r.flowId === 'doc-ingest')!
		expect(run.trace.map((s) => s.nodeId)).toEqual(['ingest', 'classify'])
		expect(run.trace.find((s) => s.nodeId === 'classify')!.vibe).toBe('bookkeeping')
		expect(currentStepIndex(run)).toBe(run.trace.length - 1)
		expect(runStateOf(run, 'classify')).toBe('done')
		expect(runsForFlow('doc-ingest').length).toBeGreaterThanOrEqual(1)
	})

	test('exampleInstance assigns a state to every node', () => {
		const f = EXAMPLE_FLOWS[0]
		const inst = exampleInstance(f)
		expect(Object.keys(inst.nodeStates).sort()).toEqual(f.nodes.map((n) => n.id).sort())
	})
})
