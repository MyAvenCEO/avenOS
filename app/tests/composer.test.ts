import { describe, expect, test } from 'bun:test'
import { Actor, type Manifest } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import {
	COMPOSER_SETTINGS,
	ComposerActor,
	type ComposerOptions
} from '../src/lib/actors/composer.actor'
import { isStaged } from '../src/lib/actors/draft-pipeline'
import { instanceWindows } from '../src/lib/actors/instance-windows'

/**
 * The 0135 proof: a wish becomes a complete actor — but PROOFS FIRST. The
 * interview writes the measurable definition of done (Prolog goals + seeds)
 * before the model sees a line of logic; the membrane PROVES the draft on a
 * scratch bus; a valid draft runs live as a staging instance ("next");
 * Promote is button-only and returns the catalog-ready export.
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

const PLAN_ANSWER = JSON.stringify({
	proofs: [{ goal: 'streak(S)', seed: { done: ['mon', 'tue', 'wed'] }, expect: { streak: 3 } }],
	ask: [{ actor: 'workitem', question: 'What exact payload shape do your records carry?' }]
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

/** The model lane, faked: plan JSON, interview prose, and the draft. */
function mesh(
	draftAnswer: string = JSON.stringify(HABIT_DRAFT),
	planAnswer: string = PLAN_ANSWER,
	options: ComposerOptions = {}
) {
	const bus = new MessageBus()
	const calls: LlmCall[] = []
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
					const text = call.system.includes('PLAN round')
						? planAnswer
						: call.system.includes('design ONE complete avenOS actor')
							? draftAnswer
							: 'I emit flat JSON records; see my manifest.'
					return { record: JSON.stringify({ ok: true, text }), wire: text }
				}
			}
		)
	)
	bus.register(new Actor(WORKITEM_EXEMPLAR))
	const composer = new ComposerActor(bus, options)
	bus.register(composer)
	return { bus, composer, calls }
}

describe('composer (0135): interview writes the proofs FIRST', () => {
	test('compose asks caller-aware, proofs exist before the design call, kimi lane set', async () => {
		const { bus, composer, calls } = mesh()
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker with streaks' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(true)
		// the proofs landed in state — the measurable "done" for the wish
		const proofs = composer.state.proofs as { goal: string }[]
		expect(proofs.map((p) => p.goal)).toEqual(['streak(S)'])
		// ORDER: the plan round ran BEFORE the design round — proofs first
		const planIndex = calls.findIndex((c) => c.system.includes('PLAN round'))
		const designIndex = calls.findIndex((c) =>
			c.system.includes('design ONE complete avenOS actor')
		)
		expect(planIndex).toBeGreaterThanOrEqual(0)
		expect(designIndex).toBeGreaterThan(planIndex)
		// the design brief quotes the proofs AND the house exemplar verbatim
		const design = calls[designIndex]
		expect(design.question).toContain('streak(S)')
		expect(design.question).toContain('"proofs"')
		expect(design.question).toContain('Keeps the task list.')
		// caller-aware interview: the ask names the composer as asker
		const interviews = calls.filter((c) => c.system.includes('asked by "composer"'))
		expect(interviews.length).toBe(1)
		expect((composer.state.interviews as unknown[]).length).toBe(1)
		// the kimi lane: plan and design completions carry the composer settings
		for (const call of [calls[planIndex], design]) {
			expect(call.settings?.model).toBe(COMPOSER_SETTINGS.model)
			expect(call.settings?.json).toBe(true)
		}
	})
})

describe('composer (0135): the membrane — nothing invalid reaches the mesh', () => {
	test('garbage model output = structured failure, kept in state.history', async () => {
		const { bus, composer } = mesh('Sure! Here is an actor I would suggest…')
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const record = JSON.parse(result.record) as { ok: boolean; error: string }
		expect(record.ok).toBe(false)
		expect(bus.get('habit')).toBeUndefined()
		expect(composer.state.phase).toBe('failed')
		// the RETROSPECTIVE seed: the failure is KEPT, wish + error + excerpt
		const history = composer.state.history as { wish: string; error: string; excerpt: string }[]
		expect(history.length).toBe(1)
		expect(history[0].wish).toBe('a habit tracker')
		expect(history[0].excerpt).toContain('Sure!')
	})

	test('a logic syntax error fails with the exact wording, nothing staged', async () => {
		const broken = JSON.stringify({ ...HABIT_DRAFT, logic: 'function initState( {' })
		const { bus, composer } = mesh(broken)
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const record = JSON.parse(result.record) as { ok: boolean; error: string }
		expect(record.ok).toBe(false)
		expect(bus.get('habit')).toBeUndefined()
		expect((composer.state.history as unknown[]).length).toBe(1)
	})

	test('a draft that fails its OWN proof is rejected — the error names the proof', async () => {
		// the logic lies: it returns streak+1, so the proven expectation breaks
		const lying = JSON.stringify({
			...HABIT_DRAFT,
			logic: HABIT_LOGIC.replace('streak: days.length', 'streak: days.length + 1')
		})
		const { bus } = mesh(lying)
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		const record = JSON.parse(result.record) as { ok: boolean; error: string }
		expect(record.ok).toBe(false)
		expect(record.error).toContain('streak(S)')
		expect(bus.get('habit')).toBeUndefined()
	})

	test('a view violation (conditional DSL) never reaches staging', async () => {
		const badView = JSON.stringify({
			...HABIT_DRAFT,
			view: { content: { class: 'habit', children: [{ text: { $if: '$count' } }] } }
		})
		const { bus } = mesh(badView)
		const result = await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		expect(bus.get('habit')).toBeUndefined()
	})
})

describe('composer (0135): staging — the draft runs live as "next"', () => {
	test('a valid draft is a REAL tagged instance, usable via dispatch', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker with streaks' })
		const habit = bus.get('habit')
		expect(habit).toBeDefined()
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(isStaged(habit!.uuid)).toBe(true)
		// the composer still holds it pending
		const staged = composer.state.staged as { uuid: string; id: string }
		expect(staged.id).toBe('habit')
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(staged.uuid).toBe(habit!.uuid)
		// USABLE: the staged instance answers its tools like any actor
		const run = await bus.dispatch('test', 'habit_streak', { done: ['a', 'b'] })
		expect((JSON.parse(run.record) as { streak: number }).streak).toBe(2)
		// windows are derivable through the existing instance-window mechanic
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(instanceWindows(habit!.manifest, habit!.instanceName).length).toBe(1)
	})
})

describe('composer (0135): promote and discard are button-only', () => {
	test('no promote/discard tool exists — the model cannot promote', () => {
		const { bus } = mesh()
		const names = bus.toolSpecs().map((t) => t.name)
		expect(names).toContain('compose')
		expect(names.some((n) => n.includes('promote'))).toBe(false)
		expect(names.some((n) => n.includes('discard'))).toBe(false)
	})

	test('PROMOTE drops the staging tag and returns the catalog-ready export', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		// biome-ignore lint/style/noNonNullAssertion: staged above
		const uuid = bus.get('habit')!.uuid
		const outcome = await composer.applyEvent({ send: 'PROMOTE' })
		const record = outcome.record as { ok: boolean; code: string }
		expect(record.ok).toBe(true)
		// production: still registered, no longer staged
		expect(bus.get('habit')).toBeDefined()
		expect(isStaged(uuid)).toBe(false)
		// the export: catalog-ready, committing it makes the actor permanent
		expect(record.code).toContain('catalog')
		expect(record.code).toContain('habit_streak')
		expect(composer.state.staged).toBeNull()
		expect((composer.state.produced as unknown[]).length).toBe(1)
	})

	test('DISCARD disposes the staging instance for good', async () => {
		const { bus, composer } = mesh()
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		// biome-ignore lint/style/noNonNullAssertion: staged above
		const uuid = bus.get('habit')!.uuid
		const outcome = await composer.applyEvent({ send: 'DISCARD' })
		expect((outcome.record as { ok: boolean }).ok).toBe(true)
		expect(bus.get('habit')).toBeUndefined()
		expect(isStaged(uuid)).toBe(false)
		expect(composer.state.staged).toBeNull()
	})

	test('PROMOTE without a staged draft fails structured', async () => {
		const { composer } = mesh()
		// wait for the sandbox to boot before poking the reducer directly
		const outcome = await composer.applyEvent({ send: 'PROMOTE' })
		expect((outcome.record as { ok: boolean }).ok).toBe(false)
	})
})

describe('composer (0135): Stop stops the PROCESS, and progress is visible', () => {
	test('the turn signal reaches the lane; abort = structured failure, kept in history', async () => {
		const controller = new AbortController()
		const bus = new MessageBus()
		let sawSignal = false
		bus.register(
			new Actor(
				{ id: 'llm', name: 'LLM', description: 'Fake model lane.', tags: ['system'], methods: [] },
				{
					llm_complete: async (p) => {
						const signal = (p.settings as { signal?: AbortSignal } | undefined)?.signal
						sawSignal = signal !== undefined
						// like a real fetch: never resolves, rejects on abort
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
		const composer = new ComposerActor(bus, { signal: () => controller.signal })
		bus.register(composer)
		const pending = bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		controller.abort()
		const result = await pending
		expect(sawSignal).toBe(true)
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		// the process ENDED — structured failure, nothing staged, history kept
		expect(composer.state.phase).toBe('failed')
		expect((composer.state.history as unknown[]).length).toBe(1)
		expect(bus.get('habit')).toBeUndefined()
	})

	test('progress lines flow through the caps while the compose runs', async () => {
		const notes: string[] = []
		const { bus } = mesh(undefined, undefined, { onProgress: (note) => notes.push(note) })
		await bus.dispatch('test', 'compose', { wish: 'a habit tracker' })
		expect(notes.some((n) => n.includes('proofs'))).toBe(true)
		expect(notes.some((n) => n.includes('designs'))).toBe(true)
		expect(notes.some((n) => n.includes('interviews workitem'))).toBe(true)
		expect(notes.some((n) => n.includes('Membrane'))).toBe(true)
	})
})
