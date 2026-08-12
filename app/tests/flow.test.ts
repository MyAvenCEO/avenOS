import { afterEach, describe, expect, test } from 'bun:test'
import { Actor, type Manifest } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import { FlowActor } from '../src/lib/actors/flow.actor'
import { type Recipe, validateRecipe } from '../src/lib/actors/flow-recipe'

/** Every test's mesh gives its WASM runtimes back afterwards. */
const meshBuses: MessageBus[] = []
afterEach(() => {
	for (const bus of meshBuses.splice(0)) {
		for (const actor of bus.actors()) actor.dispose()
	}
})
function newBus(): MessageBus {
	const bus = new MessageBus()
	meshBuses.push(bus)
	return bus
}

/**
 * The 0137 engine proof, recipe-agnostic: a recipe is plain data, the ONE
 * generic FlowActor runs it over registered step actors via the pump, the
 * prover rejects unprovable recipes before they ever run, and holds stop
 * the chain for the world.
 */

function stepManifest(id: string, requires: string[], produces: string[], logic: string): Manifest {
	return {
		id,
		name: id,
		description: `Toy step ${id}.`,
		tags: ['step'],
		logic,
		methods: [
			{
				name: `${id}_run`,
				description: `Runs ${id}.`,
				parameters: { type: 'object', properties: {}, additionalProperties: true },
				requires,
				produces,
				event: { send: 'RUN' },
				internal: true
			}
		]
	}
}

/** wish → doubled text. */
const DOUBLE = stepManifest(
	'double',
	['wish(W)'],
	['double(D)'],
	`function initState(s) { return { last: '' } }
	function reduce(state, ev) {
		if (ev.send !== 'RUN') return state
		var t = ev.payload.wish && ev.payload.wish.text ? String(ev.payload.wish.text) : ''
		return { state: { last: t + t }, said: 'doubled', record: { ok: true, value: t + t } }
	}
	function shape() { return null }`
)

/** doubled → SHOUTED text. */
const SHOUT = stepManifest(
	'shout',
	['double(D)'],
	['shout(S)'],
	`function initState(s) { return { last: '' } }
	function reduce(state, ev) {
		if (ev.send !== 'RUN') return state
		var v = ev.payload.double && ev.payload.double.value ? String(ev.payload.double.value) : ''
		return { state: { last: v.toUpperCase() }, said: 'shouted', record: { ok: true, value: v.toUpperCase() } }
	}
	function shape() { return null }`
)

/** A hold step: asks the human once, resumes on the flow's ANSWER. */
const GATE = stepManifest(
	'gate',
	['wish(W)'],
	['gate(G)'],
	`function initState(s) { return {} }
	function reduce(state, ev) {
		if (ev.send !== 'RUN') return state
		var answered = ev.payload.answers && ev.payload.answers.text
		if (answered) {
			return { state: {}, said: 'gate open', record: { ok: true, answered: String(ev.payload.answers.text) } }
		}
		return { state: {}, said: 'gate asks', record: { ok: true, hold: true, questions: ['Really?'], phase: 'gated' } }
	}
	function shape() { return null }`
)

const TOY_RECIPE: Recipe = {
	id: 'toy',
	name: 'Toy',
	inputs: ['wish(W)'],
	steps: [
		{ actor: 'double', label: 'Double' },
		{ actor: 'shout', label: 'Shout' }
	]
}

function flowManifest(id: string): Manifest {
	return {
		id,
		name: id,
		description: `Flow ${id}.`,
		tags: ['system'],
		methods: [
			{
				name: `${id}_go`,
				description: 'Starts the flow.',
				parameters: { type: 'object', properties: { wish: { type: 'string' } } },
				event: { send: 'START' }
			},
			{
				name: `${id}_answer`,
				description: 'Answers a holding flow.',
				parameters: { type: 'object', properties: { text: { type: 'string' } } },
				event: { send: 'ANSWER' }
			}
		]
	}
}

describe('flow engine (0137): a recipe is data, the engine is generic', () => {
	test('the one FlowActor runs any recipe over registered steps, data flowing by key', async () => {
		const bus = newBus()
		bus.register(new Actor(DOUBLE))
		bus.register(new Actor(SHOUT))
		const flow = new FlowActor(bus, flowManifest('toy'), TOY_RECIPE)
		bus.register(flow)
		const result = await bus.dispatch('test', 'toy_go', { wish: 'ha' })
		expect((JSON.parse(result.record) as { ok: boolean; done: boolean }).done).toBe(true)
		expect(flow.state.phase).toBe('done')
		// data flowed step to step, keyed by actor id
		const data = flow.state.data as Record<string, { value?: string }>
		expect(data.double?.value).toBe('haha')
		expect(data.shout?.value).toBe('HAHA')
		// every hop is a pump entry; the step dispatches are in the biography too
		const pump = bus.traceLog.filter((e) => e.from === 'pump').map((e) => e.method)
		expect(pump.every((m) => m === 'STEP' || m === 'STEP_DONE')).toBe(true)
		const runs = bus.traceLog
			.filter((e) => e.from === 'toy' && e.method.endsWith('_run'))
			.map((e) => e.method)
		expect(runs).toEqual(['double_run', 'shout_run'])
		// the stepper is real state
		const rows = flow.state.stepRows as { mark: string; label: string }[]
		expect(rows.map((r) => r.label)).toEqual(['Double', 'Shout'])
		expect(rows.every((r) => r.mark === '✓')).toBe(true)
	})

	test('a hold step stops the pump; ANSWER resumes with the text in flow data', async () => {
		const bus = newBus()
		bus.register(new Actor(GATE))
		bus.register(new Actor(DOUBLE))
		const recipe: Recipe = {
			id: 'gated',
			name: 'Gated',
			inputs: ['wish(W)'],
			steps: [
				{ actor: 'gate', label: 'Gate', hold: 'human' },
				{ actor: 'double', label: 'Double' }
			]
		}
		const flow = new FlowActor(bus, flowManifest('gated'), recipe)
		bus.register(flow)
		const held = await bus.dispatch('test', 'gated_go', { wish: 'hi' })
		const heldRecord = JSON.parse(held.record) as { clarifying: string[]; held: string }
		expect(heldRecord.clarifying).toEqual(['Really?'])
		expect(heldRecord.held).toBe('gate')
		expect(flow.state.phase).toBe('gated')
		expect(flow.state.holding).toBe(true)
		const resumed = await bus.dispatch('test', 'gated_answer', { text: 'yes really' })
		expect((JSON.parse(resumed.record) as { ok: boolean }).ok).toBe(true)
		expect(flow.state.phase).toBe('done')
		// ONE hold round: the gate is not re-run — the answer lands in flow data
		expect((flow.state.data as Record<string, { text?: string }>).answers?.text).toBe('yes really')
		expect((flow.state.data as Record<string, { value?: string }>).double?.value).toBe('hihi')
	})

	test('missing declared inputs never start the chain', async () => {
		const bus = newBus()
		bus.register(new Actor(DOUBLE))
		bus.register(new Actor(SHOUT))
		const flow = new FlowActor(bus, flowManifest('toy'), TOY_RECIPE)
		bus.register(flow)
		const result = await bus.dispatch('test', 'toy_go', { wish: '   ' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		expect(bus.traceLog.filter((e) => e.from === 'pump').length).toBe(0)
	})
})

describe('flow engine (0137): the prover judges the recipe before it runs', () => {
	test('a step requiring what nothing prior produces is rejected, named', () => {
		const bus = newBus()
		bus.register(new Actor(DOUBLE))
		bus.register(new Actor(SHOUT))
		const backwards: Recipe = {
			id: 'backwards',
			name: 'Backwards',
			inputs: ['wish(W)'],
			steps: [
				{ actor: 'shout' }, // requires double(D) — nothing produced it yet
				{ actor: 'double' }
			]
		}
		const problem = validateRecipe(bus, backwards)
		expect(problem?.step).toBe('shout')
		expect(problem?.predicate).toBe('double')
		// and the engine refuses to even construct on an unprovable recipe
		expect(() => new FlowActor(bus, flowManifest('backwards'), backwards)).toThrow(/not provable/)
	})

	test('an unknown step actor is rejected', () => {
		const bus = newBus()
		const ghost: Recipe = {
			id: 'ghost',
			name: 'Ghost',
			inputs: [],
			steps: [{ actor: 'nobody' }]
		}
		expect(validateRecipe(bus, ghost)?.reason).toContain('no actor')
	})

	test('an onFail target outside the recipe is rejected', () => {
		const bus = newBus()
		bus.register(new Actor(DOUBLE))
		const bad: Recipe = {
			id: 'bad',
			name: 'Bad',
			inputs: ['wish(W)'],
			steps: [{ actor: 'double', onFail: { backTo: 'elsewhere', maxRuns: 3 } }]
		}
		expect(validateRecipe(bus, bad)?.reason).toContain('elsewhere')
	})
})
