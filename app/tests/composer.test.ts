import { afterEach, describe, expect, test } from 'bun:test'
import { Actor, type Manifest } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import { COMPOSER_SETTINGS, ComposerActor } from '../src/lib/actors/composer.actor'
import { createComposerSteps, type StepOptions } from '../src/lib/actors/composer-steps'
import { isStaged } from '../src/lib/actors/draft-pipeline'
import { instanceWindows } from '../src/lib/actors/instance-windows'

/**
 * The composer as RECIPE #1 (0137/0138): step actors under the generic flow
 * engine — CLARIFY holds for the human, SCOUT rules the verdict ladder,
 * PLAN writes the proofs, MOCKUP designs ONLY the face and holds while the
 * human iterates on it by VOICE, DRAFT designs the logic against face and
 * proofs, PROBE⇄DRAFT is the scrum cycle, STAGE holds for the button.
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

/** The LOGIC draft — no view, no style: the face comes from the mockup. */
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
	logic: HABIT_LOGIC
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

const MOCKUP_FACE = {
	view: { content: { class: 'habit', children: [{ text: '$count' }] } },
	style: { selectors: { '.habit': { display: 'flex' } } },
	sample: { count: 3 }
}
const MOCKUP_JSON = JSON.stringify(MOCKUP_FACE)
const APPROVED_JSON = JSON.stringify({ approved: true })

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
	/** One mockup answer per mockup run, consumed in order (last one repeats). */
	mockups?: string[]
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
	let mockupCall = 0
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
					const mockups = options.mockups ?? [MOCKUP_JSON, APPROVED_JSON]
					const text = call.system.includes('CLARIFY round')
						? (options.clarify ?? NO_QUESTIONS)
						: call.system.includes('SCOUT round')
							? (options.scout ?? COMPOSE_VERDICT)
							: call.system.includes('PLAN round')
								? (options.plan ?? PLAN_ANSWER)
								: call.system.includes('design ONLY the FACE')
									? mockups[
											options.mockups
												? Math.min(mockupCall++, mockups.length - 1)
												: mockupCall++ % mockups.length
										]
									: call.system.includes('design the LOGIC')
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
	const designCalls = () => calls.filter((c) => c.system.includes('design the LOGIC'))
	const mockupCalls = () => calls.filter((c) => c.system.includes('design ONLY the FACE'))
	const pumped = () => bus.traceLog.filter((e) => e.from === 'pump').map((e) => e.method)
	const stepRuns = () =>
		bus.traceLog
			.filter((e) => e.from === 'composer' && e.method.endsWith('_run'))
			.map((e) => e.method)
	const data = () => composer.state.data as Record<string, Record<string, unknown>>
	/** compose, then approve the mockup hold — the straight-through chain. */
	const through = async (wish = 'a habit tracker') => {
		const first = await bus.dispatch('test', 'compose', { wish })
		const record = JSON.parse(first.record) as { held?: string }
		if (record.held === 'mockup') {
			return await bus.dispatch('test', 'compose_answer', { text: 'passt so' })
		}
		return first
	}
	return { bus, composer, calls, designCalls, mockupCalls, pumped, stepRuns, data, through }
}

describe('composer recipe (0138): CLARIFY holds, then the MOCKUP holds', () => {
	test('a vague wish asks first; the answer leads to the mockup hold; approval stages', async () => {
		const { bus, composer, data } = mesh({
			clarify: JSON.stringify({ questions: ['Which habits?', 'Daily or weekly?'] })
		})
		const held = await bus.dispatch('test', 'compose', { wish: 'ein Habit Tracker' })
		const heldRecord = JSON.parse(held.record) as { clarifying: string[]; held: string }
		expect(heldRecord.clarifying).toEqual(['Which habits?', 'Daily or weekly?'])
		expect(heldRecord.held).toBe('clarify')
		expect(composer.state.phase).toBe('clarifying')
		// the human answers — the chain runs on and holds again at the FACE
		const atMockup = await bus.dispatch('test', 'compose_answer', {
			text: 'Meditation und Sport, täglich'
		})
		expect((JSON.parse(atMockup.record) as { held: string }).held).toBe('mockup')
		expect(composer.state.phase).toBe('mockup')
		expect(data().clarify_answer?.text).toBe('Meditation und Sport, täglich')
		expect(bus.get('habit')).toBeUndefined()
		// approval releases the face — the chain designs the logic and stages
		const staged = await bus.dispatch('test', 'compose_answer', { text: 'passt so' })
		expect((JSON.parse(staged.record) as { ok: boolean }).ok).toBe(true)
		expect(composer.state.phase).toBe('staged')
		expect(data().mockup_answer?.text).toBe('passt so')
		expect(bus.get('habit')).toBeDefined()
	})

	test('a precise wish still holds once — at the face', async () => {
		const { bus, composer, through } = mesh()
		const result = await through()
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
		expect(history.length).toBe(2)
		expect(history[0].excerpt).toContain('lane_error')
		expect(history[0].excerpt).toContain('boom upstream (504)')
		expect(String(composer.state.note)).toContain('retries are spent')
	})
})

describe('composer recipe (0138): the face comes before the logic', () => {
	test('mockup runs before any logic design; the design brief has NO view in its schema', async () => {
		const { calls, through } = mesh()
		await through()
		const mockupIndex = calls.findIndex((c) => c.system.includes('design ONLY the FACE'))
		const designIndex = calls.findIndex((c) => c.system.includes('design the LOGIC'))
		expect(mockupIndex).toBeGreaterThanOrEqual(0)
		expect(designIndex).toBeGreaterThan(mockupIndex)
		// the logic brief: face is GIVEN, never redesigned
		expect(calls[designIndex].system).toContain('NO view')
		expect(calls[designIndex].question).toContain('"mockup"')
	})

	test('the mockup step exposes face/faceStyle/sample — the live preview state', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect(composer.state.phase).toBe('mockup')
		const mockupStep = bus.get('mockup')
		expect(mockupStep?.state.face).toEqual(MOCKUP_FACE.view)
		expect(mockupStep?.state.sample).toEqual(MOCKUP_FACE.sample)
		// the flow data carries the face for every later step
		const mockupOut = (composer.state.data as Record<string, Record<string, unknown>>).mockup
		expect(mockupOut.view).toEqual(MOCKUP_FACE.view)
	})

	test('VOICE iteration on the face: feedback re-enters the mockup, approval releases it', async () => {
		const changed = JSON.stringify({
			...MOCKUP_FACE,
			view: { content: { class: 'habit', children: [{ tag: 'h1', text: '$count' }] } }
		})
		const { bus, composer, mockupCalls } = mesh({
			mockups: [MOCKUP_JSON, changed, APPROVED_JSON]
		})
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect(composer.state.phase).toBe('mockup')
		// change request → the mockup re-runs WITH the feedback and the previous face
		const second = await bus.dispatch('test', 'compose_answer', {
			text: 'mach den Titel größer'
		})
		expect((JSON.parse(second.record) as { held: string }).held).toBe('mockup')
		expect(mockupCalls().length).toBe(2)
		expect(mockupCalls()[1].question).toContain('mach den Titel größer')
		expect(mockupCalls()[1].question).toContain('"previous"')
		// the face CHANGED on stage
		const face = bus.get('mockup')?.state.face as { content: { children: { tag?: string }[] } }
		expect(face.content.children[0].tag).toBe('h1')
		// approval → the logic is designed against the CHANGED face
		await bus.dispatch('test', 'compose_answer', { text: 'passt' })
		expect(composer.state.phase).toBe('staged')
		const staged = bus.get('habit')?.manifest.view as { content: { children: { tag?: string }[] } }
		expect(staged.content.children[0].tag).toBe('h1')
	})

	test('an invalid face never holds — it re-enters with the validator error in the brief', async () => {
		const badFace = JSON.stringify({
			...MOCKUP_FACE,
			view: { content: { class: 'habit', children: [{ text: 'done? yes: no' }] } }
		})
		const { bus, composer, mockupCalls } = mesh({
			mockups: [badFace, MOCKUP_JSON, APPROVED_JSON]
		})
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		// the second mockup call carried the exact validator error as retry
		expect(mockupCalls().length).toBe(2)
		expect(mockupCalls()[1].question).toContain('"retry"')
		expect(mockupCalls()[1].question).toContain('Ternary')
		// and the run holds on the VALID face, one failure in the history
		expect(composer.state.phase).toBe('mockup')
		expect((composer.state.history as unknown[]).length).toBe(1)
	})
})

describe('composer recipe (0137): phases are real actors, pumped and traced', () => {
	test('every phase is its own pump hop AND its own step dispatch in the biography', async () => {
		const { pumped, stepRuns, through } = mesh()
		await through()
		expect(pumped().every((m) => m === 'STEP' || m === 'STEP_DONE')).toBe(true)
		expect(stepRuns()).toEqual([
			'clarify_run',
			'scout_run',
			'plan_run',
			'mockup_run',
			'mockup_run',
			'draft_run',
			'probe_run',
			'stage_run'
		])
	})

	test('the stepper rides in real flow state: all marks proven after staging', async () => {
		const { composer, through } = mesh()
		await through()
		const rows = composer.state.stepRows as { mark: string; label: string }[]
		expect(rows.map((r) => r.label)).toEqual([
			'Clarify',
			'Scout',
			'Plan',
			'Mockup',
			'Draft',
			'Probe',
			'Stage'
		])
		expect(rows.every((r) => r.mark === '✓')).toBe(true)
	})

	test('the derived graph shows the flow FED by its steps, and the step chain itself', () => {
		const { bus } = mesh()
		const edges = bus.edges()
		// every step feeds the composer — no hand-wiring, pure contracts
		for (const step of ['clarify', 'scout', 'plan', 'mockup', 'draft', 'probe', 'stage']) {
			expect(edges.some((e) => e.from === step && e.to === 'composer')).toBe(true)
		}
		// and the chain between the steps is visible too
		expect(edges.some((e) => e.from === 'plan' && e.to === 'draft')).toBe(true)
		expect(edges.some((e) => e.from === 'mockup' && e.to === 'draft')).toBe(true)
		expect(edges.some((e) => e.from === 'draft' && e.to === 'probe')).toBe(true)
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
		const { calls, data, through } = mesh()
		await through()
		const planIndex = calls.findIndex((c) => c.system.includes('PLAN round'))
		const designIndex = calls.findIndex((c) => c.system.includes('design the LOGIC'))
		expect(planIndex).toBeGreaterThanOrEqual(0)
		expect(designIndex).toBeGreaterThan(planIndex)
		const design = calls[designIndex]
		expect(design.question).toContain('streak(S)')
		expect(design.question).toContain('"proofs"')
		expect(design.question).toContain('Keeps the task list.')
		expect(calls.some((c) => c.system.includes('asked by "composer"'))).toBe(true)
		expect(((data().scout?.interviews ?? []) as unknown[]).length).toBe(1)
		for (const call of [calls[planIndex], design]) {
			expect(call.settings?.model).toBe(COMPOSER_SETTINGS.model)
			expect(call.settings?.json).toBe(true)
		}
	})
})

describe('composer recipe (0137): the SCOUT verdict ladder', () => {
	test('reuse spawns the instance DIRECTLY — no mockup, no draft, no staging', async () => {
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
		const { bus, composer, designCalls, through } = mesh({
			drafts: [JSON.stringify(BROKEN_DRAFT), JSON.stringify(HABIT_DRAFT)]
		})
		const result = await through()
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(true)
		expect(composer.state.phase).toBe('staged')
		expect(bus.get('habit')).toBeDefined()
		expect(designCalls().length).toBe(2)
		const history = composer.state.history as { error: string }[]
		expect(history.length).toBe(1)
		expect(designCalls()[1].question).toContain('"retry"')
		expect(designCalls()[1].question).toContain(JSON.stringify(history[0].error).slice(1, 30))
		// the stepper wears the round HONESTLY: only the re-entered step counts
		const rows = composer.state.stepRows as { label: string }[]
		expect(rows.some((r) => r.label === 'Draft 2/3')).toBe(true)
		expect(rows.some((r) => r.label.startsWith('Plan '))).toBe(false)
	})

	test('three failed rounds = structured failure with the full history', async () => {
		const { bus, composer, designCalls, through } = mesh({
			drafts: [JSON.stringify(BROKEN_DRAFT)]
		})
		const result = await through()
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		expect(composer.state.phase).toBe('failed')
		expect((composer.state.history as unknown[]).length).toBe(3)
		expect(designCalls().length).toBe(3)
		expect(bus.get('habit')).toBeUndefined()
		const rows = composer.state.stepRows as { mark: string }[]
		expect(rows.some((r) => r.mark === '✕')).toBe(true)
		expect(String(composer.state.note)).toContain('retries are spent')
	})
})

describe('composer recipe (0137): Stop stops the pumping', () => {
	test('an aborted pump signal halts the chain between phases — nothing staged', async () => {
		const controller = new AbortController()
		controller.abort()
		const { bus, composer, pumped } = mesh()
		bus.pumpSignal = () => controller.signal
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
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

describe('composer recipe (0138): staging wears the mockup, promote stays button-only', () => {
	test('the staged instance is REAL, tagged, usable — and carries the mockup face', async () => {
		const { bus, composer, through } = mesh()
		await through()
		const habit = bus.get('habit')
		expect(habit).toBeDefined()
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(isStaged(habit!.uuid)).toBe(true)
		const staged = composer.state.staged as { uuid: string; id: string }
		expect(staged.id).toBe('habit')
		const run = await bus.dispatch('test', 'habit_streak', { done: ['a', 'b'] })
		expect((JSON.parse(run.record) as { streak: number }).streak).toBe(2)
		// THE FACE: the staged manifest wears the approved mockup
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(habit!.manifest.view).toEqual(MOCKUP_FACE.view)
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
		expect(names.some((n) => n.endsWith('_run'))).toBe(false)
	})

	test('PROMOTE drops the tag and exports; DISCARD disposes', async () => {
		const { bus, composer, through } = mesh()
		await through()
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
		await through('another habit tracker')
		const discarded = await composer.applyEvent({ send: 'DISCARD' })
		expect((discarded.record as { ok: boolean }).ok).toBe(true)
	})

	test('PROMOTE without a staged draft fails structured', async () => {
		const { composer } = mesh()
		const outcome = await composer.applyEvent({ send: 'PROMOTE' })
		expect((outcome.record as { ok: boolean }).ok).toBe(false)
	})
})
