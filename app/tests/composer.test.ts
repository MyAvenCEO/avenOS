import { afterEach, describe, expect, test } from 'bun:test'
import { Actor, type Manifest } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import { COMPOSER_SETTINGS, ComposerActor } from '../src/lib/actors/composer.actor'
import { createComposerSteps, type StepOptions } from '../src/lib/actors/composer-steps'
import { isStaged } from '../src/lib/actors/draft-pipeline'
import { instanceWindows } from '../src/lib/actors/instance-windows'

/**
 * The composer as RECIPE #1 (0137): six step actors under the generic flow
 * engine, behaving exactly as the 0136 machine did — CLARIFY holds for the
 * human, SCOUT rules reuse before negotiate before compose, PLAN writes the
 * proofs, DRAFT⇄PROBE is the scrum cycle (three runs, the membrane error in
 * the next brief), STAGE holds for the button. Every phase is a real actor,
 * every hop a pump entry.
 */

const HABIT_LOGIC = `function initState(source) { return { count: 0 } }
function reduce(state, ev) {
	if (ev.send === 'STREAK') {
		var days = ev.payload && ev.payload.done ? ev.payload.done : []
		return {
			state: { count: days.length },
			said: 'streak of ' + days.length,
			record: { ok: true, streak: days.length }
		}
	}
	return state
}
function shape(state, rawText) { return null }`

const HABIT_DRAFT = {
	id: 'habit',
	description: 'Tracks habit streaks from done days.',
	tags: ['habit'],
	methods: [
		{
			name: 'habit_streak',
			description: 'Computes the current streak from the done days.',
			parameters: {
				type: 'object',
				properties: { done: { type: 'array', items: { type: 'string' } } }
			},
			produces: ['streak(S)'],
			event: { send: 'STREAK' }
		}
	],
	logic: HABIT_LOGIC,
	view: { content: { class: 'habit', children: [{ text: '$count' }] } },
	style: { selectors: { '.habit': { display: 'flex' } } }
}

const BROKEN_DRAFT = { ...HABIT_DRAFT, logic: 'function initState( {' }

const NO_QUESTIONS = JSON.stringify({ questions: [] })
const COMPOSE_VERDICT = JSON.stringify({
	verdict: 'compose',
	reason: 'nothing in the mesh counts streaks',
	ask: [{ actor: 'workitem', question: 'What exact payload shape do your records carry?' }]
})
const PLAN_ANSWER = JSON.stringify({
	proofs: [{ goal: 'streak(S)', seed: { done: ['mon', 'tue', 'wed'] }, expect: { streak: 3 } }]
})

/** The house exemplar the design brief quotes — a slim stand-in manifest. */
const WORKITEM_EXEMPLAR: Manifest = {
	id: 'workitem',
	name: 'Workitem',
	description: 'Keeps the task list.',
	tags: ['todo'],
	methods: [
		{
			name: 'workitem_list',
			description: 'Lists tasks.',
			parameters: { type: 'object', properties: {} },
			event: { send: 'LIST' }
		}
	]
}

interface LlmCall {
	system: string
	question: string
	settings?: Record<string, unknown>
}

interface MeshOptions {
	clarify?: string
	scout?: string
	plan?: string
	/** One design answer per scrum round, consumed in order (last one repeats). */
	drafts?: string[]
	/** Calls whose system contains this marker FAIL at the lane (ok:false). */
	failLane?: string
	steps?: StepOptions
}

/** Every test's mesh gives its WASM runtimes back afterwards. */
const meshBuses: MessageBus[] = []
afterEach(() => {
	for (const bus of meshBuses.splice(0)) {
		for (const actor of bus.actors()) actor.dispose()
	}
})

/** The model lane, faked and routed by the brief markers of each phase. */
function mesh(options: MeshOptions = {}) {
	const bus = new MessageBus()
	meshBuses.push(bus)
	const calls: LlmCall[] = []
	let designCall = 0
	bus.register(
		new Actor(
			{ id: 'llm', name: 'LLM', description: 'Fake model lane.', tags: ['system'], methods: [] },
			{
				llm_complete: async (p) => {
					const call: LlmCall = {
						system: String(p.system ?? ''),
						question: String(p.question ?? ''),
						...(p.settings ? { settings: p.settings as Record<string, unknown> } : {})
					}
					calls.push(call)
					if (options.failLane && call.system.includes(options.failLane)) {
						return {
							record: JSON.stringify({ ok: false, error: 'boom upstream (504)' }),
							wire: 'boom upstream (504)'
						}
					}
					const drafts = options.drafts ?? [JSON.stringify(HABIT_DRAFT)]
					const text = call.system.includes('CLARIFY round')
						? (options.clarify ?? NO_QUESTIONS)
						: call.system.includes('SCOUT round')
							? (options.scout ?? COMPOSE_VERDICT)
							: call.system.includes('PLAN round')
								? (options.plan ?? PLAN_ANSWER)
								: call.system.includes('design ONE complete avenOS actor')
									? drafts[Math.min(designCall++, drafts.length - 1)]
									: 'I emit flat JSON records; see my manifest.'
					return { record: JSON.stringify({ ok: true, text }), wire: text }
				}
			}
		)
	)
	bus.register(new Actor(WORKITEM_EXEMPLAR))
	for (const step of createComposerSteps(bus, options.steps ?? {})) bus.register(step)
	const composer = new ComposerActor(bus)
	bus.register(composer)
	const designCalls = () =>
		calls.filter((c) => c.system.includes('design ONE complete avenOS actor'))
	const pumped = () => bus.traceLog.filter((e) => e.from === 'pump').map((e) => e.method)
	const stepRuns = () =>
		bus.traceLog
			.filter((e) => e.from === 'composer' && e.method.endsWith('_run'))
			.map((e) => e.method)
	const data = () => composer.state.data as Record<string, Record<string, unknown>>
	return { bus, composer, calls, designCalls, pumped, stepRuns, data }
}

describe('composer recipe (0137): CLARIFY holds for the human', () => {
	test('a vague wish returns questions and HOLDS — compose_answer resumes to staged', async () => {
		const { bus, composer, pumped, data } = mesh({
			clarify: JSON.stringify({ questions: ['Which habits?', 'Daily or weekly?'] })
		})
		const held = await bus.dispatch('test', 'compose', { wish: 'ein Habit Tracker' })
		const heldRecord = JSON.parse(held.record) as { ok: boolean; clarifying: string[] }
		expect(heldRecord.clarifying).toEqual(['Which habits?', 'Daily or weekly?'])
		expect(held.wire).toContain('Which habits?')
		// the machine HOLDS: only the clarify hop ran, nothing exists yet
		expect(composer.state.phase).toBe('clarifying')
		expect(pumped().length).toBe(2)
		expect(bus.get('habit')).toBeUndefined()
		// the human answers by voice — the chain resumes and runs to staged
		const resumed = await bus.dispatch('test', 'compose_answer', {
			text: 'Meditation und Sport, täglich'
		})
		expect((JSON.parse(resumed.record) as { ok: boolean }).ok).toBe(true)
		expect(composer.state.phase).toBe('staged')
		expect(data().answers?.text).toBe('Meditation und Sport, täglich')
		expect(bus.get('habit')).toBeDefined()
	})

	test('a precise wish (no questions) chains straight through to staged', async () => {
		const { bus, composer } = mesh()
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker with streaks' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(true)
		expect(composer.state.phase).toBe('staged')
		expect(bus.get('habit')).toBeDefined()
	})

	test('compose_answer outside a hold fails structured', async () => {
		const { bus } = mesh()
		const result = await bus.dispatch('test', 'compose_answer', { text: 'hello?' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
	})

	test('a LANE failure is visible, not silent: the real cause lands in the history', async () => {
		const { bus, composer } = mesh({ failLane: 'PLAN round' })
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		expect(composer.state.phase).toBe('failed')
		const history = composer.state.history as { excerpt: string }[]
		expect(history.length).toBe(1)
		expect(history[0].excerpt).toContain('lane_error')
		expect(history[0].excerpt).toContain('boom upstream (504)')
		// and the note tells the truth — this was no three-round scrum
		expect(String(composer.state.note)).toContain('died before drafting')
	})
})

describe('composer recipe (0137): phases are real actors, pumped and traced', () => {
	test('every phase is its own pump hop AND its own step dispatch in the biography', async () => {
		const { bus, pumped, stepRuns } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect(pumped().every((m) => m === 'STEP' || m === 'STEP_DONE')).toBe(true)
		expect(stepRuns()).toEqual([
			'clarify_run',
			'scout_run',
			'plan_run',
			'draft_run',
			'probe_run',
			'stage_run'
		])
	})

	test('the stepper rides in real flow state: all marks proven after staging', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const rows = composer.state.stepRows as { mark: string; label: string }[]
		expect(rows.map((r) => r.label)).toEqual([
			'Clarify',
			'Scout',
			'Plan',
			'Draft',
			'Probe',
			'Stage'
		])
		expect(rows.every((r) => r.mark === '✓')).toBe(true)
	})

	test('a step actor is independently dispatchable — plan alone writes proofs', async () => {
		const { bus } = mesh()
		const result = await bus.dispatch('test', 'plan_run', {
			wish: { text: 'a habit tracker' },
			scout: { interviews: [] }
		})
		const record = JSON.parse(result.record) as { ok: boolean; proofs: { goal: string }[] }
		expect(record.ok).toBe(true)
		expect(record.proofs.map((p) => p.goal)).toEqual(['streak(S)'])
	})

	test('proofs come BEFORE the design call, and the brief quotes proofs + exemplar', async () => {
		const { bus, calls, data } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const planIndex = calls.findIndex((c) => c.system.includes('PLAN round'))
		const designIndex = calls.findIndex((c) =>
			c.system.includes('design ONE complete avenOS actor')
		)
		expect(planIndex).toBeGreaterThanOrEqual(0)
		expect(designIndex).toBeGreaterThan(planIndex)
		const design = calls[designIndex]
		expect(design.question).toContain('streak(S)')
		expect(design.question).toContain('"proofs"')
		expect(design.question).toContain('Keeps the task list.')
		// caller-aware mesh interview from the SCOUT step
		expect(calls.some((c) => c.system.includes('asked by "composer"'))).toBe(true)
		expect(((data().scout?.interviews ?? []) as unknown[]).length).toBe(1)
		// the kimi lane on every composer completion
		for (const call of [calls[planIndex], design]) {
			expect(call.settings?.model).toBe(COMPOSER_SETTINGS.model)
			expect(call.settings?.json).toBe(true)
		}
	})
})

describe('composer recipe (0137): the SCOUT verdict ladder', () => {
	test('reuse spawns the instance DIRECTLY — no draft, no staging', async () => {
		const { bus, composer, stepRuns } = mesh({
			scout: JSON.stringify({
				verdict: 'reuse',
				reason: 'the task list already tracks daily items',
				reuse: { template: 'workitem', name: 'habits' }
			})
		})
		bus.spawnable('workitem', () => new Actor(WORKITEM_EXEMPLAR))
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const record = JSON.parse(result.record) as { ok: boolean; reused: { name: string } }
		expect(record.ok).toBe(true)
		expect(record.reused.name).toBe('habits')
		expect(bus.get('habits')).toBeDefined()
		expect(composer.state.phase).toBe('reused')
		// the ladder stopped at its second rung: nothing was designed
		expect(stepRuns()).toEqual(['clarify_run', 'scout_run'])
		expect(bus.get('habit')).toBeUndefined()
	})

	test('negotiate advises the bridge — no draft, no staging', async () => {
		const { bus, composer } = mesh({
			scout: JSON.stringify({
				verdict: 'negotiate',
				reason: 'metric and imperial-display cover it but do not meet',
				negotiate: { from: 'metric', to: 'imperial-display' }
			})
		})
		const result = await bus.dispatch('test', 'compose', { wish: 'show km as miles' })
		const record = JSON.parse(result.record) as { ok: boolean; negotiate: { from: string } }
		expect(record.ok).toBe(true)
		expect(record.negotiate.from).toBe('metric')
		expect(result.wire).toContain('negotiate')
		expect(composer.state.phase).toBe('negotiate')
		expect(bus.get('habit')).toBeUndefined()
	})
})

describe('composer recipe (0137): DRAFT ⇄ PROBE is the declared scrum cycle', () => {
	test('a membrane failure re-enters DRAFT with the error in the brief; round 2 stages', async () => {
		const { bus, composer, designCalls } = mesh({
			drafts: [JSON.stringify(BROKEN_DRAFT), JSON.stringify(HABIT_DRAFT)]
		})
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(true)
		expect(composer.state.phase).toBe('staged')
		expect(bus.get('habit')).toBeDefined()
		// two design rounds ran; the second brief carried the exact error
		expect(designCalls().length).toBe(2)
		const history = composer.state.history as { error: string }[]
		expect(history.length).toBe(1)
		expect(designCalls()[1].question).toContain('"retry"')
		expect(designCalls()[1].question).toContain(JSON.stringify(history[0].error).slice(1, 30))
	})

	test('three failed rounds = structured failure with the full history', async () => {
		const { bus, composer, designCalls } = mesh({
			drafts: [JSON.stringify(BROKEN_DRAFT)]
		})
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		expect(composer.state.phase).toBe('failed')
		expect((composer.state.history as unknown[]).length).toBe(3)
		expect(designCalls().length).toBe(3)
		expect(bus.get('habit')).toBeUndefined()
		// the stepper shows where it died, and the note owns the spent rounds
		const rows = composer.state.stepRows as { mark: string }[]
		expect(rows.some((r) => r.mark === '✕')).toBe(true)
		expect(String(composer.state.note)).toContain('three rounds')
	})
})

describe('composer recipe (0137): Stop stops the pumping', () => {
	test('an aborted pump signal halts the chain between phases — nothing staged', async () => {
		const controller = new AbortController()
		controller.abort()
		const { bus, composer, pumped } = mesh()
		bus.pumpSignal = () => controller.signal
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		// START itself committed (running), but the pump never ran a step
		expect((JSON.parse(result.record) as { next?: unknown }).next).toBeDefined()
		expect(pumped()).toEqual([])
		expect(composer.state.phase).toBe('running')
		expect(bus.get('habit')).toBeUndefined()
	})

	test('the work signal reaches the model lane of the steps — an abort ends the run', async () => {
		const controller = new AbortController()
		let sawSignal = false
		const bus = new MessageBus()
		meshBuses.push(bus)
		bus.register(
			new Actor(
				{ id: 'llm', name: 'LLM', description: 'Fake model lane.', tags: ['system'], methods: [] },
				{
					llm_complete: async (p) => {
						const signal = (p.settings as { signal?: AbortSignal } | undefined)?.signal
						sawSignal = signal !== undefined
						await new Promise((_, reject) => {
							if (signal?.aborted) return reject(new Error('aborted'))
							signal?.addEventListener('abort', () => reject(new Error('aborted')), {
								once: true
							})
						})
						return { record: '', wire: '' }
					}
				}
			)
		)
		bus.register(new Actor(WORKITEM_EXEMPLAR))
		for (const step of createComposerSteps(bus, { signal: () => controller.signal })) {
			bus.register(step)
		}
		// the pump stays open on purpose: the signal must reach the LANE itself
		const composer = new ComposerActor(bus)
		bus.register(composer)
		const pending = bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		controller.abort()
		await pending
		expect(sawSignal).toBe(true)
		expect(bus.get('habit')).toBeUndefined()
		expect(composer.state.phase).not.toBe('staged')
	})
})

describe('composer recipe (0137): staging stays live, promote stays button-only', () => {
	test('the staged instance is a REAL tagged actor, usable via dispatch', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const habit = bus.get('habit')
		expect(habit).toBeDefined()
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(isStaged(habit!.uuid)).toBe(true)
		const staged = composer.state.staged as { uuid: string; id: string }
		expect(staged.id).toBe('habit')
		const run = await bus.dispatch('test', 'habit_streak', { done: ['a', 'b'] })
		expect((JSON.parse(run.record) as { streak: number }).streak).toBe(2)
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(instanceWindows(habit!.manifest, habit!.instanceName).length).toBe(1)
	})

	test('no promote/discard tool exists; step entries stay engine-only', () => {
		const { bus } = mesh()
		const names = bus.toolSpecs().map((t) => t.name)
		expect(names).toContain('compose')
		expect(names).toContain('compose_answer')
		expect(names.some((n) => n.includes('promote'))).toBe(false)
		expect(names.some((n) => n.includes('discard'))).toBe(false)
		// the six steps are dispatchable, but never voice tools
		expect(names.some((n) => n.endsWith('_run'))).toBe(false)
	})

	test('PROMOTE drops the tag and exports; DISCARD disposes', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		// biome-ignore lint/style/noNonNullAssertion: staged above
		const uuid = bus.get('habit')!.uuid
		const promoted = await composer.applyEvent({ send: 'PROMOTE' })
		const record = promoted.record as { ok: boolean; code: string }
		expect(record.ok).toBe(true)
		expect(bus.get('habit')).toBeDefined()
		expect(isStaged(uuid)).toBe(false)
		expect(record.code).toContain('catalog')
		expect(record.code).toContain('habit_streak')
		expect((composer.state.produced as unknown[]).length).toBe(1)
		// a second run stages again; DISCARD takes it away for good
		await bus.dispatch('test', 'compose', { wish: 'another habit tracker' })
		const discarded = await composer.applyEvent({ send: 'DISCARD' })
		expect((discarded.record as { ok: boolean }).ok).toBe(true)
	})

	test('PROMOTE without a staged draft fails structured', async () => {
		const { composer } = mesh()
		const outcome = await composer.applyEvent({ send: 'PROMOTE' })
		expect((outcome.record as { ok: boolean }).ok).toBe(false)
	})
})
