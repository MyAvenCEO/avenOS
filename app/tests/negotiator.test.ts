import { describe, expect, test } from 'bun:test'
import { Actor } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import { catalog } from '../src/lib/actors/catalog'
import { NegotiatorActor } from '../src/lib/actors/negotiator.actor'

/**
 * The 0131 proof: two actors whose vocabularies do not match (metric km vs
 * imperial miles) get a GENERATED bridge — interviewed via caller-aware
 * ask(), drafted by the model lane (faked here, deterministic), held
 * pending behind the human gate, and — once approved — walked by the
 * prover like any other clause.
 */

const PROXY_LOGIC = `function initState(source) { return {} }
function reduce(state, ev) {
	if (ev.send === 'TRANSLATE') {
		var m = ev.payload.metric || {}
		var miles = Math.round((m.km || 0) * 0.621371 * 100) / 100
		return {
			state: state,
			said: 'translated to ' + miles + ' miles',
			record: { ok: true, miles: miles }
		}
	}
	return state
}
function shape(state, rawText) { return null }`

const DRAFT_JSON = JSON.stringify({
	id: 'metric-imperial-proxy',
	description: 'Converts metric kilometres into imperial miles.',
	logic: PROXY_LOGIC
})

/** The model lane, faked: prose for interviews, the draft for the design call. */
function fakeLlm(bus: MessageBus, draftAnswer: string) {
	const seenSystems: string[] = []
	bus.register(
		new Actor(
			{ id: 'llm', name: 'LLM', description: 'Fake model lane.', tags: ['system'], methods: [] },
			{
				llm_complete: async (p) => {
					seenSystems.push(String(p.system ?? ''))
					const question = String(p.question ?? '')
					const text = question.includes('producerSays')
						? draftAnswer
						: 'I speak in flat JSON records; see my manifest.'
					return { record: JSON.stringify({ ok: true, text }), wire: text }
				}
			}
		)
	)
	return seenSystems
}

function mesh(draftAnswer = DRAFT_JSON) {
	const bus = new MessageBus()
	const seenSystems = fakeLlm(bus, draftAnswer)
	for (const manifest of catalog) bus.register(new Actor(manifest))
	bus.register(new NegotiatorActor(bus))
	return { bus, seenSystems }
}

describe('negotiator (0131): interview, gate, bridge, export', () => {
	test('negotiate interviews BOTH sides caller-aware and drafts — nothing registered yet', async () => {
		const { bus, seenSystems } = mesh()
		const result = await bus.dispatch('test', 'negotiate', {
			from: 'metric',
			to: 'imperial-display'
		})
		const record = JSON.parse(result.record) as { ok: boolean; draft: { id: string } }
		expect(record.ok).toBe(true)
		expect(record.draft.id).toBe('metric-imperial-proxy')
		// caller-aware ask: both interview prompts name the negotiator as asker
		const interviews = seenSystems.filter((s) => s.includes('asked by "negotiator"'))
		expect(interviews.length).toBe(2)
		// the GATE: the draft is pending, NOT in the mesh
		expect(bus.get('metric-imperial-proxy')).toBeUndefined()
	})

	test('approve registers the bridge and the prover walks producer → proxy', async () => {
		const { bus } = mesh()
		await bus.dispatch('test', 'negotiate', { from: 'metric', to: 'imperial-display' })
		const approved = await bus.dispatch('test', 'negotiator_approve', {})
		const record = JSON.parse(approved.record) as {
			ok: boolean
			registered: { uuid: string }
			code: string
		}
		expect(record.ok).toBe(true)
		expect(bus.get('metric-imperial-proxy')).toBeDefined()
		// EXPORT: catalog-ready code rides along — definitions stay code-ownable
		expect(record.code).toContain('catalog')
		expect(record.code).toContain('metric-imperial-proxy')
		expect(record.code).toContain('TRANSLATE')
		// THE BRIDGE: imperial(I) is provable now — metric measures km, the
		// generated proxy translates, the vocabularies actually meet
		const run = await bus.satisfy('imperial(I)', { km: 100 })
		expect(run.status).toBe('ok')
		const out = run.steps.at(-1)?.out as { miles: number }
		expect(out.miles).toBeCloseTo(62.14, 1)
	})

	test('the translated payload reaches the consumer through an ordinary emit', async () => {
		const { bus } = mesh()
		await bus.dispatch('test', 'negotiate', { from: 'metric', to: 'imperial-display' })
		await bus.dispatch('test', 'negotiator_approve', {})
		const run = await bus.satisfy('imperial(I)', { km: 10 })
		const translated = run.steps.at(-1)?.out as { miles: number }
		await bus.emit('imperial(I)', { miles: translated.miles }, 'test')
		const consumer = bus.get('imperial-display')
		expect(consumer?.state.miles).toBeCloseTo(6.21, 1)
	})

	test('direction does not matter — the pair is oriented by its contracts', async () => {
		const { bus } = mesh()
		// the human said it the other way around: consumer first
		const result = await bus.dispatch('test', 'negotiate', {
			from: 'imperial-display',
			to: 'metric'
		})
		const record = JSON.parse(result.record) as { ok: boolean; draft: { requires: string[] } }
		expect(record.ok).toBe(true)
		// the draft still bridges producer → consumer
		expect(record.draft.requires).toEqual(['metric(M)'])
	})

	test('reject discards the draft; approve afterwards fails structured', async () => {
		const { bus } = mesh()
		await bus.dispatch('test', 'negotiate', { from: 'metric', to: 'imperial-display' })
		const rejected = await bus.dispatch('test', 'negotiator_reject', {})
		expect((JSON.parse(rejected.record) as { ok: boolean }).ok).toBe(true)
		const approved = await bus.dispatch('test', 'negotiator_approve', {})
		expect((JSON.parse(approved.record) as { ok: boolean }).ok).toBe(false)
		expect(bus.get('metric-imperial-proxy')).toBeUndefined()
	})

	test('malformed model output = structured failure, no pending draft', async () => {
		const { bus } = mesh('Sure! Here is a proxy I would suggest…')
		const result = await bus.dispatch('test', 'negotiate', {
			from: 'metric',
			to: 'imperial-display'
		})
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		const approved = await bus.dispatch('test', 'negotiator_approve', {})
		expect((JSON.parse(approved.record) as { ok: boolean }).ok).toBe(false)
	})

	test('unknown actors and contract-less pairs fail structured', async () => {
		const { bus } = mesh()
		const unknown = await bus.dispatch('test', 'negotiate', { from: 'nope', to: 'metric' })
		expect((JSON.parse(unknown.record) as { ok: boolean }).ok).toBe(false)
		// negotiator itself produces nothing — no bridge to build FROM it
		const contractless = await bus.dispatch('test', 'negotiate', {
			from: 'negotiator',
			to: 'imperial-display'
		})
		expect((JSON.parse(contractless.record) as { ok: boolean }).ok).toBe(false)
	})
})
