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
		// approval is BUTTON-ONLY: no tool exists — the HUD button applies the event
		expect(bus.toolSpecs().some((t) => t.name === 'negotiator_approve')).toBe(false)
		const negotiator = bus.get('negotiator')
		// biome-ignore lint/style/noNonNullAssertion: registered in mesh()
		const approvedOutcome = await negotiator!.applyEvent({ send: 'APPROVE' })
		const record = approvedOutcome.record as {
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
		// biome-ignore lint/style/noNonNullAssertion: registered in mesh()
		await bus.get('negotiator')!.applyEvent({ send: 'APPROVE' })
		const run = await bus.satisfy('imperial(I)', { km: 10 })
		const translated = run.steps.at(-1)?.out as { miles: number }
		await bus.emit('imperial(I)', { miles: translated.miles }, 'test')
		const consumer = bus.get('imperial-display')
		expect(consumer?.state.display).toBe('6.21')
		expect(consumer?.state.unit).toBe('mi')
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
		// biome-ignore lint/style/noNonNullAssertion: registered in mesh()
		const negotiator = bus.get('negotiator')!
		const rejected = await negotiator.applyEvent({ send: 'REJECT' })
		expect((rejected.record as { ok: boolean }).ok).toBe(true)
		const approved = await negotiator.applyEvent({ send: 'APPROVE' })
		expect((approved.record as { ok: boolean }).ok).toBe(false)
		expect(bus.get('metric-imperial-proxy')).toBeUndefined()
	})

	test('malformed model output = structured failure, no pending draft', async () => {
		const { bus } = mesh('Sure! Here is a proxy I would suggest…')
		const result = await bus.dispatch('test', 'negotiate', {
			from: 'metric',
			to: 'imperial-display'
		})
		expect((JSON.parse(result.record) as { ok: boolean }).ok).toBe(false)
		// biome-ignore lint/style/noNonNullAssertion: registered in mesh()
		const approved = await bus.get('negotiator')!.applyEvent({ send: 'APPROVE' })
		expect((approved.record as { ok: boolean }).ok).toBe(false)
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

describe('the human gate (universal HITL): held messages resolve by button only', () => {
	test('a hitl entry is HELD on dispatch; confirm executes, voice cannot', async () => {
		const bus = new MessageBus()
		const heldSeen: string[] = []
		bus.onHold = (h) => heldSeen.push(h.id)
		bus.register(
			new Actor({
				id: 'todo',
				name: 'Todo',
				description: 'Keeps todos.',
				tags: [],
				logic: `
					function initState() { return { items: ['a', 'b'] } }
					function reduce(state, ev) {
						if (ev.send === 'DELETE') {
							return { state: { items: [] }, said: 'deleted all', record: { ok: true } }
						}
						return state
					}
					function shape() { return null }
				`,
				methods: [
					{
						name: 'todo_delete',
						description: 'Deletes everything.',
						parameters: { type: 'object', properties: {} },
						event: { send: 'DELETE' },
						hitl: 'Delete everything irreversibly'
					}
				]
			})
		)
		const held = await bus.dispatch('chat', 'todo_delete', {})
		const heldRecord = JSON.parse(held.record) as { ok: boolean; held: string }
		expect(heldRecord.held).toBe(heldSeen[0])
		expect(held.wire).toContain('voice cannot confirm')
		// NOT executed yet (a no-op event awaits the boot and reads the state)
		// biome-ignore lint/style/noNonNullAssertion: registered above
		const before = await bus.get('todo')!.applyEvent({ send: 'NOOP' })
		expect(before.state.items).toEqual(['a', 'b'])
		// there is no confirm tool the model could call
		expect(bus.toolSpecs().some((t) => t.name.includes('confirm'))).toBe(false)
		// the button press executes the held message
		const result = await bus.confirmHeld(heldRecord.held)
		expect(result.wire).toBe('deleted all')
		expect(bus.get('todo')?.state.items).toEqual([])
	})

	test('reject drops the held message; a second confirm finds nothing', async () => {
		const bus = new MessageBus()
		bus.onHold = () => {}
		bus.register(
			new Actor({
				id: 'todo',
				name: 'Todo',
				description: 'Keeps todos.',
				tags: [],
				logic: `
					function initState() { return { items: ['a'] } }
					function reduce(state, ev) {
						if (ev.send === 'DELETE') return { state: { items: [] }, said: 'gone', record: { ok: true } }
						return state
					}
					function shape() { return null }
				`,
				methods: [
					{
						name: 'todo_delete',
						description: 'Deletes everything.',
						parameters: { type: 'object', properties: {} },
						event: { send: 'DELETE' },
						hitl: 'Delete everything'
					}
				]
			})
		)
		const held = await bus.dispatch('chat', 'todo_delete', {})
		const id = (JSON.parse(held.record) as { held: string }).held
		bus.rejectHeld(id)
		// biome-ignore lint/style/noNonNullAssertion: registered above
		const after = await bus.get('todo')!.applyEvent({ send: 'NOOP' })
		expect(after.state.items).toEqual(['a'])
		const nothing = await bus.confirmHeld(id)
		expect((JSON.parse(nothing.record) as { ok: boolean }).ok).toBe(false)
	})

	test('without a HUD (no onHold), the gate stays open for tests — no silent loss', async () => {
		const bus = new MessageBus()
		bus.register(
			new Actor({
				id: 'todo',
				name: 'Todo',
				description: 'Keeps todos.',
				tags: [],
				logic: `
					function initState() { return { items: ['a'] } }
					function reduce(state, ev) {
						if (ev.send === 'DELETE') return { state: { items: [] }, said: 'gone', record: { ok: true } }
						return state
					}
					function shape() { return null }
				`,
				methods: [
					{
						name: 'todo_delete',
						description: 'Deletes everything.',
						parameters: { type: 'object', properties: {} },
						event: { send: 'DELETE' },
						hitl: 'Delete everything'
					}
				]
			})
		)
		// headless: no HUD wired — the dispatch executes directly (tests, scripts)
		const result = await bus.dispatch('chat', 'todo_delete', {})
		expect(result.wire).toBe('gone')
	})
})
