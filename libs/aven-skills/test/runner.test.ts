import { describe, expect, test } from 'bun:test'
import type { Flow } from '../src/flow'
import { type ActorRegistry, runFlow } from '../src/runner/runner'

// A generic 2-node flow (ingest → classify shape), driven by STUB actors — proves the runner is
// flow-agnostic: it only resolves actors from the registry + threads resources. board 0089.
const flow: Flow = {
	id: 'test-flow',
	name: 'Test',
	description: '',
	nodes: [
		{ id: 'a', name: 'Store', actor: 'store', inputs: ['file'], outputs: ['document'] },
		{ id: 'b', name: 'Classify', actor: 'classify', inputs: ['document'], outputs: ['document'] }
	],
	edges: [{ from: 'a', to: 'b', resource: 'document', message: 'document' }]
}

describe('generic flow runner (board 0089)', () => {
	test('runs nodes in order, threads resources, returns a done FlowRun + outputs', async () => {
		const actors: ActorRegistry = {
			store: async ({ inputs }) => ({ document: { sha: `h(${inputs.file})` } }),
			classify: async ({ inputs }) => ({
				document: { ...(inputs.document as object), kind: 'invoice' }
			})
		}
		const { run, outputs } = await runFlow(flow, {
			actors,
			runId: 'r1',
			now: () => 'T',
			input: { file: 'bytes' }
		})
		expect(run.status).toBe('done')
		expect(run.trace.map((s) => [s.nodeId, s.state])).toEqual([
			['a', 'done'],
			['b', 'done']
		])
		expect(outputs.document).toEqual({ sha: 'h(bytes)', kind: 'invoice' })
	})

	test('an unregistered actor → error FlowRun, run halts', async () => {
		const { run } = await runFlow(flow, { actors: { store: async () => ({ document: {} }) }, runId: 'r2', now: () => 'T', input: { file: 'b' } })
		expect(run.status).toBe('error')
		expect(run.trace.at(-1)?.state).toBe('error')
		expect(run.trace.at(-1)?.message).toContain('no actor registered for "classify"')
	})

	test('an actor that throws → error FlowRun', async () => {
		const actors: ActorRegistry = {
			store: async () => {
				throw new Error('disk full')
			},
			classify: async () => ({ document: {} })
		}
		const { run } = await runFlow(flow, { actors, runId: 'r3', now: () => 'T', input: { file: 'b' } })
		expect(run.status).toBe('error')
		expect(run.trace[0]?.message).toBe('disk full')
	})

	test('a node `vibe` → step.vibe/vibeData + onStep fires per step (board 0091)', async () => {
		const vibeFlow: Flow = {
			id: 'vf',
			name: 'VF',
			description: '',
			nodes: [
				{ id: 'a', name: 'Store', actor: 'store', inputs: ['file'], outputs: ['document'] },
				{
					id: 'b',
					name: 'Classify',
					actor: 'classify',
					inputs: ['document'],
					outputs: ['document'],
					vibe: 'bookkeeping'
				}
			],
			edges: [{ from: 'a', to: 'b', resource: 'document', message: 'document' }]
		}
		const seen: { id: string; vibe?: string }[] = []
		const { run } = await runFlow(vibeFlow, {
			actors: {
				store: async ({ inputs }) => ({ document: { sha: `h(${inputs.file})` } }),
				classify: async ({ inputs }) => ({ document: { ...(inputs.document as object), kind: 'invoice' } })
			},
			runId: 'r4',
			now: () => 'T',
			input: { file: 'b' },
			onStep: (s) => seen.push({ id: s.nodeId, vibe: s.vibe })
		})
		expect(seen).toEqual([
			{ id: 'a', vibe: undefined },
			{ id: 'b', vibe: 'bookkeeping' }
		])
		const bStep = run.trace.find((s) => s.nodeId === 'b')
		expect(bStep?.vibe).toBe('bookkeeping')
		expect(bStep?.vibeData).toEqual({ sha: 'h(b)', kind: 'invoice' })
	})
})
