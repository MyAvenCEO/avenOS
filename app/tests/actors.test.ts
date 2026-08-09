import { describe, expect, test } from 'bun:test'
import { Actor, functor, manifestProse } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'

/** Two tiny actors whose contracts chain: source produces what sink requires. */
function pair() {
	const source = new Actor(
		{
			id: 'source',
			name: 'Source',
			description: 'Erzeugt Dinge.',
			tags: ['test'],
			methods: [
				{
					name: 'make_thing',
					description: 'Macht ein Ding.',
					parameters: { type: 'object', properties: {} },
					produces: ['thing(T)']
				}
			]
		},
		{
			make_thing: () => ({ record: '{"ok":true}', wire: 'ein Ding gemacht' })
		}
	)
	const sink = new Actor({
		id: 'sink',
		name: 'Sink',
		description: 'Verbraucht Dinge.',
		tags: ['test'],
		methods: [],
		requires: ['thing(X)'],
		produces: ['done(X)']
	})
	const bus = new MessageBus()
	bus.register(source)
	bus.register(sink)
	return { bus, source, sink }
}

describe('actor core', () => {
	test('an envelope reaches the right handler', async () => {
		const { bus } = pair()
		const result = await bus.dispatch('test', 'make_thing', {})
		expect(result.wire).toBe('ein Ding gemacht')
	})

	test('an unknown method answers as a structured error, never throws', async () => {
		const { bus } = pair()
		const result = await bus.dispatch('test', 'no_such_method', {})
		expect(JSON.parse(result.record).ok).toBe(false)
		expect(result.wire).toContain('no_such_method')
	})

	test('edges derive from produces→requires unification', () => {
		const { bus } = pair()
		expect(bus.edges()).toEqual([{ from: 'source', to: 'sink', predicate: 'thing' }])
	})

	test('predicates unify on their functor, arguments free', () => {
		// thing(T) and thing(X) are the same functor — that IS the unification.
		expect(functor('thing(T)')).toBe(functor('thing(X)'))
	})

	test('stages place producers before consumers', () => {
		const { bus } = pair()
		const ids = bus.stages().map((stage) => stage.map((a) => a.manifest.id))
		expect(ids).toEqual([['source'], ['sink']])
	})

	test('ask() without an LLM answers with manifest prose', async () => {
		const { source } = pair()
		const answer = await source.ask('Was bist du?')
		expect(answer).toContain('Source')
		expect(answer).toContain('make_thing')
	})

	test('ask() with an LLM answers as itself, manifest as context', async () => {
		const { bus } = pair()
		let seenSystem = ''
		bus.llm = async (system, question) => {
			seenSystem = system
			return `Antwort auf: ${question}`
		}
		const answer = await bus.ask('sink', 'Was brauchst du?')
		expect(answer).toBe('Antwort auf: Was brauchst du?')
		expect(seenSystem).toContain('Sink')
		expect(seenSystem).toContain('thing(X)')
	})

	test('the manifest prose names every method and contract', () => {
		const { source } = pair()
		const prose = manifestProse(source.manifest)
		expect(prose).toContain('make_thing')
		expect(prose).toContain('thing(T)')
	})

	test('the derived tool list carries every method plus actor_ask', () => {
		const { bus } = pair()
		const names = bus.toolSpecs().map((s) => s.name)
		expect(names).toContain('make_thing')
		expect(names).toContain('actor_ask')
	})
})

describe('execution engine', () => {
	test('emit fans out to exactly the actors whose requires unify', async () => {
		const bus = new MessageBus()
		const seen: string[] = []
		const listenerFor = (id: string) =>
			new Actor(
				{
					id,
					name: id,
					description: '',
					tags: [],
					methods: [],
					requires: ['thing(X)'],
					produces: []
				},
				{
					thing: (p) => {
						seen.push(`${id}:${p.value}`)
						return { record: '{"ok":true}', wire: 'ok' }
					}
				}
			)
		bus.register(listenerFor('a'))
		bus.register(listenerFor('b'))
		// c requires something else and must NOT receive the emit
		bus.register(
			new Actor(
				{ id: 'c', name: 'c', description: '', tags: [], methods: [], requires: ['other(Y)'] },
				{
					other: () => {
						seen.push('c')
						return { record: '{"ok":true}', wire: 'ok' }
					}
				}
			)
		)
		await bus.emit('thing(T)', { value: 1 })
		expect(seen.sort()).toEqual(['a:1', 'b:1'])
	})

	test('a mailbox processes async handlers strictly one at a time, in order', async () => {
		const log: string[] = []
		const actor = new Actor(
			{ id: 's', name: 's', description: '', tags: [], methods: [] },
			{
				slow: async (p) => {
					log.push(`start:${p.n}`)
					// The first message dawdles; without a real mailbox the second
					// would interleave and finish first.
					await new Promise((r) => setTimeout(r, p.n === 1 ? 30 : 1))
					log.push(`end:${p.n}`)
					return { record: '{"ok":true}', wire: 'ok' }
				}
			}
		)
		await Promise.all([actor.deliver('slow', { n: 1 }), actor.deliver('slow', { n: 2 })])
		expect(log).toEqual(['start:1', 'end:1', 'start:2', 'end:2'])
	})

	test('a throwing handler is contained as a structured error', async () => {
		const actor = new Actor(
			{ id: 't', name: 't', description: '', tags: [], methods: [] },
			{
				boom: () => {
					throw new Error('kaputt')
				}
			}
		)
		const result = await actor.deliver('boom', {})
		expect(JSON.parse(result.record).ok).toBe(false)
		expect(result.wire).toContain('kaputt')
	})
})

describe('backward chaining (SLD)', () => {
	const contract = (id: string, requires: string[], produces: string[]) =>
		new Actor({ id, name: id, description: '', tags: [], methods: [], requires, produces })

	test('a chain proves down to external facts', () => {
		const bus = new MessageBus()
		bus.register(contract('chat', ['utterance(T)'], ['reply(R)']))
		const proof = bus.prove('reply(R)')
		expect(proof.satisfied).toBe(true)
		expect(proof.actor).toBe('chat')
		// utterance has no producer — an external fact, satisfied as an input.
		expect(proof.children[0].external).toBe(true)
		expect(proof.children[0].satisfied).toBe(true)
	})

	test('backtracking: when the first producer cannot be satisfied, the next wins', () => {
		const bus = new MessageBus()
		// Producer 1 needs magic — provable only via a producer that needs the
		// impossible not(exists) while exists IS produced. Producer 2 needs an
		// external fact and succeeds.
		bus.register(contract('exists-maker', [], ['exists(E)']))
		bus.register(contract('broken', ['not(exists(E))'], ['goal(G)']))
		bus.register(contract('working', ['fact(F)'], ['goal(G)']))
		const proof = bus.prove('goal(G)')
		expect(proof.satisfied).toBe(true)
		expect(proof.actor).toBe('working')
	})

	test('negation as failure: not(p) holds exactly when nothing produces p', () => {
		const bus = new MessageBus()
		bus.register(contract('a', ['not(missing(M))'], ['ok(A)']))
		expect(bus.prove('ok(A)').satisfied).toBe(true)
		// Now something produces missing — the negation collapses.
		bus.register(contract('m', [], ['missing(M)']))
		expect(bus.prove('ok(A)').satisfied).toBe(false)
		expect(bus.unsatisfied('ok(A)')).toBe(true)
	})

	test('cycles terminate and read coinductively', () => {
		const bus = new MessageBus()
		bus.register(contract('hen', ['egg(E)'], ['chicken(C)']))
		bus.register(contract('egg', ['chicken(C)'], ['egg(E)']))
		expect(bus.prove('chicken(C)').satisfied).toBe(true)
	})
})

describe('supervision', () => {
	test('a handler that throws once is retried and succeeds silently', async () => {
		let calls = 0
		const actor = new Actor(
			{ id: 'flaky', name: 'flaky', description: '', tags: [], methods: [] },
			{
				work: () => {
					calls++
					if (calls === 1) throw new Error('transient')
					return { record: '{"ok":true}', wire: 'geschafft' }
				}
			}
		)
		const result = await actor.deliver('work', {})
		expect(result.wire).toBe('geschafft')
		expect(actor.failures).toBe(0)
	})

	test('a handler that keeps throwing is recorded after the retry', async () => {
		const actor = new Actor(
			{ id: 'dead', name: 'dead', description: '', tags: [], methods: [] },
			{
				work: () => {
					throw new Error('permanent')
				}
			}
		)
		const result = await actor.deliver('work', {})
		expect(JSON.parse(result.record).ok).toBe(false)
		expect(actor.failures).toBe(1)
		expect(actor.lastError).toContain('permanent')
	})
})
