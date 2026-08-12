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

/**
 * The model as a service actor, faked for tests (0130): the bus derives its
 * lane from the registered `llm` actor — no ambient function anywhere.
 */
function registerFakeLlm(
	bus: MessageBus,
	answer: (system: string, question: string, settings?: Record<string, unknown>) => string
) {
	bus.register(
		new Actor(
			{
				id: 'llm',
				name: 'LLM',
				description: 'Fake model lane.',
				tags: ['system'],
				methods: []
			},
			{
				llm_complete: async (p) => {
					const text = answer(
						String(p.system ?? ''),
						String(p.question ?? ''),
						(p.settings as Record<string, unknown>) ?? undefined
					)
					return { record: JSON.stringify({ ok: true, text }), wire: text }
				}
			}
		)
	)
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
		registerFakeLlm(bus, (system, question) => {
			seenSystem = system
			return `Antwort auf: ${question}`
		})
		const answer = await bus.ask('sink', 'Was brauchst du?', 'scheduler')
		expect(answer).toBe('Antwort auf: Was brauchst du?')
		expect(seenSystem).toContain('Sink')
		expect(seenSystem).toContain('thing(X)')
		// caller-aware (Ask Protocol): the answer may depend on WHO asks
		expect(seenSystem).toContain('scheduler')
		expect(bus.traceLog.find((e) => e.kind === 'ask')?.from).toBe('scheduler')
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

describe('term unification (0128)', () => {
	test('variables bind, constants must match', async () => {
		const { unify, unifiable } = await import('../src/lib/actors/term')
		expect(unify('intent(M, hoch)', 'intent(X, hoch)')).not.toBeNull()
		expect(unify('intent(M, hoch)', 'intent(X, niedrig)')).toBeNull()
		const bound = unify('intent(M, hoch)', 'intent(X, Class)')
		expect(bound?.Class).toBe('hoch')
		expect(unifiable('interrupted()', 'interrupted()')).toBe(true)
	})

	test('ROUTING uses the same rule: mismatched constants never arrive', async () => {
		const bus = new MessageBus()
		const seen: string[] = []
		bus.register(
			new Actor(
				{
					id: 'done-only',
					name: '',
					description: '',
					tags: [],
					methods: [],
					requires: ['status(erledigt)']
				},
				{
					status: () => {
						seen.push('done-only')
						return { record: '{"ok":true}', wire: 'ok' }
					}
				}
			)
		)
		await bus.emit('status(offen)', {})
		expect(seen).toEqual([])
		await bus.emit('status(erledigt)', {})
		expect(seen).toEqual(['done-only'])
	})

	test('prove() selects producers by unification and carries bindings', () => {
		const bus = new MessageBus()
		const c = (id: string, req: string[], prod: string[]) =>
			new Actor({
				id,
				name: id,
				description: '',
				tags: [],
				methods: [],
				requires: req,
				produces: prod
			})
		bus.register(c('low', [], ['intent(M, niedrig)']))
		bus.register(c('high', [], ['intent(M, hoch)']))
		const proof = bus.prove('intent(X, hoch)')
		expect(proof.satisfied).toBe(true)
		expect(proof.actor).toBe('high')
	})
})

describe('registry actor (0128)', () => {
	test('registry_list names every registered actor', async () => {
		const bus = new MessageBus()
		bus.register(new Actor({ id: 'a', name: 'A', description: '', tags: [], methods: [] }))
		const { RegistryActor } = await import('../src/lib/actors/registry.actor')
		bus.register(new RegistryActor(bus))
		const result = await bus.dispatch('test', 'registry_list', {})
		expect(result.wire).toContain('a')
		expect(result.wire).toContain('registry')
	})

	test('the registry cannot create, change or delete actors', async () => {
		const { RegistryActor } = await import('../src/lib/actors/registry.actor')
		const bus = new MessageBus()
		bus.register(new RegistryActor(bus))
		const tools = bus.toolSpecs().map((t) => t.name)
		expect(tools).toContain('registry_list')
		// the engine has no manual gateway: goals run through real tools/voice
		expect(tools).not.toContain('goal_run')
		expect(tools).not.toContain('actor_create')
		expect(tools).not.toContain('actor_update')
		expect(tools).not.toContain('actor_delete')
	})
})

describe('trace (0128)', () => {
	test('the bus records sends, emits and asks', async () => {
		const bus = new MessageBus()
		const actor = new Actor(
			{
				id: 't',
				name: 'T',
				description: 'Testactor.',
				tags: [],
				methods: [],
				requires: ['ping(P)']
			},
			{ ping: () => ({ record: '{"ok":true}', wire: 'pong' }) }
		)
		bus.register(actor)
		await bus.emit('ping(P)', {})
		await bus.ask('t', 'Wer bist du?')
		const kinds = bus.traceLog.map((e) => e.kind)
		expect(kinds).toContain('emit')
		expect(kinds).toContain('send')
		expect(kinds).toContain('ask')
		const send = bus.traceLog.find((e) => e.kind === 'send')
		expect(send?.to).toBe('t')
		expect(send?.ok).toBe(true)
	})
})

describe('execution engine (0129)', () => {
	/** A producer whose clause-body handler is named after what it produces. */
	function producer(
		id: string,
		requires: string[],
		produces: string,
		body: (p: Record<string, unknown>) => { record: string; wire: string }
	) {
		return new Actor(
			{
				id,
				name: id,
				description: `Erzeugt ${produces}.`,
				tags: ['test'],
				methods: [],
				requires,
				produces: [produces]
			},
			{ [functor(produces)]: body }
		)
	}

	test('a two-step chain executes with value passing', async () => {
		const bus = new MessageBus()
		bus.register(
			producer('quelle', [], 'fact(X)', () => ({
				record: JSON.stringify({ ok: true, wert: 5 }),
				wire: 'Fakt erzeugt'
			}))
		)
		bus.register(
			producer('rechner', ['fact(X)'], 'result(Y)', (p) => {
				const fact = p.fact as { wert: number }
				return {
					record: JSON.stringify({ ok: true, wert: fact.wert * 2 }),
					wire: 'verdoppelt'
				}
			})
		)
		const run = await bus.satisfy('result(Y)')
		expect(run.status).toBe('ok')
		const last = run.steps.at(-1)
		expect(last?.actor).toBe('rechner')
		// The second actor received the first actor's output through the contract.
		expect((last?.in.fact as { wert: number }).wert).toBe(5)
		expect((last?.out as { wert: number }).wert).toBe(10)
	})

	test('runtime backtracking abandons a failing producer and records both attempts', async () => {
		const bus = new MessageBus()
		// Registered FIRST, so it is the first candidate — and it always throws.
		bus.register(
			producer('kaputt', [], 'result(Y)', () => {
				throw new Error('immer kaputt')
			})
		)
		bus.register(
			producer('heil', [], 'result(Y)', () => ({
				record: JSON.stringify({ ok: true, wert: 1 }),
				wire: 'geht'
			}))
		)
		const run = await bus.satisfy('result(Y)')
		expect(run.status).toBe('ok')
		const attempts = run.steps.filter((s) => s.predicate === 'result(Y)')
		expect(attempts.length).toBe(2)
		expect(attempts[0].actor).toBe('kaputt')
		expect(attempts[0].ok).toBe(false)
		expect(attempts[0].attempt).toBe(1)
		expect(attempts[1].actor).toBe('heil')
		expect(attempts[1].ok).toBe(true)
		expect(attempts[1].attempt).toBe(2)
	})

	test('an llm:true actor with no handlers executes via the injected LLM', async () => {
		const bus = new MessageBus()
		let seenSystem = ''
		let seenPayload = ''
		registerFakeLlm(bus, (system, question) => {
			seenSystem = system
			seenPayload = question
			return '{"termin":"Dienstag 14 Uhr"}'
		})
		bus.register(
			new Actor({
				id: 'kalender',
				name: 'Kalender',
				description: 'Erstellt Termine aus Anfragen.',
				tags: ['created'],
				methods: [],
				requires: ['anfrage(A)'],
				produces: ['termin(T)'],
				llm: true
			})
		)
		const run = await bus.satisfy('termin(T)', { anfrage: { text: 'Zahnarzt Dienstag' } })
		expect(run.status).toBe('ok')
		// The manifest description IS the instruction, the fact payload the input.
		expect(seenSystem).toContain('Erstellt Termine aus Anfragen.')
		expect(seenPayload).toContain('Zahnarzt Dienstag')
		const last = run.steps.at(-1)
		expect(last?.actor).toBe('kalender')
		expect((last?.out as { termin: string }).termin).toBe('Dienstag 14 Uhr')
	})

	test('an llm:true actor without an llm actor in the mesh fails structured, not thrown', async () => {
		const bus = new MessageBus()
		bus.register(
			new Actor({
				id: 'kalender',
				name: 'Kalender',
				description: 'Erstellt Termine.',
				tags: [],
				methods: [],
				requires: [],
				produces: ['termin(T)'],
				llm: true
			})
		)
		const run = await bus.satisfy('termin(T)')
		expect(run.status).toBe('failed')
		const last = run.steps.at(-1)
		expect(last?.ok).toBe(false)
		expect(JSON.stringify(last?.out)).toContain('no llm actor')
	})

	test('a run records goal, status and per-step state', async () => {
		const bus = new MessageBus()
		bus.register(
			producer('quelle', [], 'fact(X)', () => ({
				record: JSON.stringify({ ok: true, wert: 5 }),
				wire: 'Fakt'
			}))
		)
		const run = await bus.satisfy('fact(X)')
		expect(run.goal).toBe('fact(X)')
		expect(run.status).toBe('ok')
		expect(run.steps.length).toBe(1)
		const step = run.steps[0]
		expect(step.actor).toBe('quelle')
		expect(step.predicate).toBe('fact(X)')
		expect(step.in).toEqual({})
		expect(step.ok).toBe(true)
		expect(typeof step.duration).toBe('number')
		expect(bus.runs().map((r) => r.id)).toContain(run.id)
	})
})

describe('per-actor llm lane (manifest llm settings)', () => {
	test('an llm actor with its own settings hands them to the injected model', async () => {
		const bus = new MessageBus()
		let seen: unknown = null
		registerFakeLlm(bus, (_system, _question, settings) => {
			seen = settings
			return '{"summary":"done"}'
		})
		bus.register(
			new Actor({
				id: 'summarizer',
				name: 'Summarizer',
				description: 'Summarizes text.',
				tags: [],
				methods: [],
				requires: [],
				produces: ['summary(S)'],
				llm: { model: 'moonshotai/kimi-k3', temperature: 0.2 }
			})
		)
		const run = await bus.satisfy('summary(S)')
		expect(run.status).toBe('ok')
		expect(seen).toEqual({ model: 'moonshotai/kimi-k3', temperature: 0.2, json: true })
	})

	test('llm true still executes on the default lane', async () => {
		const bus = new MessageBus()
		let seen: unknown = 'untouched'
		registerFakeLlm(bus, (_system, _question, settings) => {
			seen = settings
			return '{"ok":true}'
		})
		bus.register(
			new Actor({
				id: 'plain',
				name: 'Plain',
				description: 'Plain llm actor.',
				tags: [],
				methods: [],
				requires: [],
				produces: ['thing(T)'],
				llm: true
			})
		)
		const run = await bus.satisfy('thing(T)')
		expect(run.status).toBe('ok')
		// true normalizes to empty settings — the injected lane's defaults apply;
		// the execution lane always asks for enforced JSON on top.
		expect(seen).toEqual({ json: true })
	})
})

describe('catalog (code is the source of truth, reduced — 0130)', () => {
	test('the demo actors are gone and every entry is logic + views', async () => {
		const { catalog } = await import('../src/lib/actors/catalog')
		const { validateStyleDef, validateViewDef } = await import('@avenos/aven-ui')
		const ids = catalog.map((m) => m.id)
		for (const gone of ['calendar', 'habits', 'notes']) {
			expect(ids).not.toContain(gone)
		}
		// whatever the catalog declares must arrive as logic + validating views
		for (const manifest of catalog) {
			expect(typeof manifest.logic).toBe('string')
			expect(manifest.view).toBeDefined()
			// biome-ignore lint/style/noNonNullAssertion: asserted above
			expect(() => validateViewDef(manifest.view!)).not.toThrow()
			expect(() => validateStyleDef(manifest.style ?? {})).not.toThrow()
		}
	})

	test('a successful llm execution is remembered by a record-keeping actor', async () => {
		const bus = new MessageBus()
		registerFakeLlm(bus, () => '{"when":"Tuesday 14:00","what":"dentist"}')
		const kept: unknown[] = []
		class Keeper extends Actor {
			remember(out: unknown) {
				kept.push(out)
			}
		}
		bus.register(
			new Keeper({
				id: 'cal',
				name: 'Calendar',
				description: 'Keeps appointments.',
				tags: [],
				methods: [],
				requires: ['request(R)'],
				produces: ['appointment(A)'],
				llm: true
			})
		)
		const run = await bus.satisfy('appointment(A)', { request: { text: 'dentist tuesday 2pm' } })
		expect(run.status).toBe('ok')
		expect(kept.length).toBe(1)
		expect((kept[0] as { what: string }).what).toBe('dentist')
	})
})

describe('the biography is complete: UI clicks and dispatches speak names', () => {
	test('a UI event reduces through the sandbox AND lands in the trace', async () => {
		const bus = new MessageBus()
		const actor = new Actor({
			id: 'todo',
			name: 'Todo',
			description: 'Keeps todos.',
			tags: [],
			methods: [],
			logic: `
				function initState() { return { n: 0 } }
				function reduce(state, ev) { return { n: state.n + 1 } }
				function shape() { return null }
			`
		})
		bus.register(actor)
		await bus.uiEvent('ui', actor.uuid, { send: 'BUMP' })
		expect(actor.state.n).toBe(1)
		const entry = bus.traceLog.find((e) => e.method === 'BUMP')
		expect(entry?.from).toBe('ui')
		// the trace speaks names, never uuids
		expect(entry?.to).toBe('todo')
	})

	test('dispatch traces the instance name, not the uuid', async () => {
		const bus = new MessageBus()
		bus.register(
			new Actor(
				{ id: 'a', name: 'A', description: '', tags: [], methods: [] },
				{ ping: () => ({ record: '{"ok":true}', wire: 'pong' }) }
			)
		)
		await bus.dispatch('test', 'ping', {})
		const entry = bus.traceLog.find((e) => e.method === 'ping')
		expect(entry?.to).toBe('a')
	})
})

describe('runs ARE trace entries (merged biography)', () => {
	test('every executed step lands in the trace carrying its run id', async () => {
		const bus = new MessageBus()
		bus.register(
			new Actor(
				{
					id: 'quelle',
					name: 'Quelle',
					description: 'Produces facts.',
					tags: [],
					methods: [],
					requires: [],
					produces: ['fact(X)']
				},
				{ fact: () => ({ record: '{"ok":true,"wert":5}', wire: 'ok' }) }
			)
		)
		const run = await bus.satisfy('fact(X)')
		const steps = bus.traceLog.filter((e) => e.kind === 'step')
		expect(steps.length).toBe(run.steps.length)
		expect(steps.every((e) => e.run === run.id)).toBe(true)
		expect(steps[0]?.to).toBe('quelle')
		expect(steps[0]?.method).toBe('fact(X)')
	})
})

describe('the membrane seam (0130): actors shape their own model text', () => {
	function shaper(shapeBody: string) {
		// A real logic actor: shape() runs IN the sandbox, not on a subclass.
		return new Actor({
			id: 'shaping',
			name: 'Shaping',
			description: 'Shapes its own model output.',
			tags: [],
			methods: [],
			requires: [],
			produces: ['thing(T)'],
			llm: true,
			logic: `
				function initState() { return {} }
				function reduce(state, ev) { return state }
				function shape(state, rawText) { ${shapeBody} }
			`
		})
	}

	test('the sandbox-side shape wins over host extraction', async () => {
		const bus = new MessageBus()
		registerFakeLlm(bus, () => 'model prose the host must never parse {"x":1}')
		bus.register(shaper('return { state: { shaped: true, saw: rawText.slice(0, 11) } }'))
		// host extraction would have found {"x":1} — the actor's shape decides instead
		bus.extractJson = () => {
			throw new Error('the host must not parse model text for a shaping actor')
		}
		const run = await bus.satisfy('thing(T)')
		expect(run.status).toBe('ok')
		expect(JSON.stringify(run.steps.at(-1)?.out)).toContain('shaped')
		expect(JSON.stringify(run.steps.at(-1)?.out)).toContain('model prose')
	})

	test('malformed model output = structured failure, no state applied', async () => {
		const bus = new MessageBus()
		registerFakeLlm(bus, () => 'garbage that is not ops')
		bus.register(shaper('return null'))
		const run = await bus.satisfy('thing(T)')
		expect(run.status).toBe('failed')
		expect(JSON.stringify(run.steps.at(-1)?.out)).toContain('did not shape')
	})
})

describe('one primitive (0130): declared events serve tools, UI and the proof engine', () => {
	const TODO_LOGIC = `
		function initState(source) { return { items: [], n: 0 } }
		function reduce(state, ev) {
			if (ev.send === 'CREATE') {
				var items = state.items.concat([{ id: 'x' + (state.n + 1), title: ev.payload.title }])
				return {
					state: { items: items, n: state.n + 1 },
					said: 'created ' + ev.payload.title,
					record: { ok: true, created: items[items.length - 1] }
				}
			}
			return state
		}
		function shape(state, raw) { return null }
	`

	function todoActor() {
		// No subclass, no special class: ONE Actor — logic in the manifest is
		// all it takes.
		return new Actor({
			id: 'todo',
			name: 'Todo',
			description: 'Keeps todos.',
			tags: [],
			methods: [
				{
					name: 'todo_create',
					description: 'Creates one todo.',
					parameters: { type: 'object', properties: { title: { type: 'string' } } },
					produces: ['todo(T)'],
					event: { send: 'CREATE' }
				}
			],
			logic: TODO_LOGIC
		})
	}

	test('the generic adapter speaks what the sandbox said', async () => {
		const bus = new MessageBus()
		bus.register(todoActor())
		const result = await bus.dispatch('test', 'todo_create', { title: 'Milk' })
		expect(result.wire).toBe('created Milk')
		expect(JSON.parse(result.record)).toEqual({ ok: true, created: { id: 'x1', title: 'Milk' } })
	})

	test('the SAME declared event is the Prolog clause: satisfy() lands in the sandbox', async () => {
		const bus = new MessageBus()
		const actor = todoActor()
		bus.register(actor)
		const run = await bus.satisfy('todo(T)', { title: 'Bread' })
		expect(run.status).toBe('ok')
		expect((actor.state.items as { title: string }[])[0]?.title).toBe('Bread')
		// no llm was needed anywhere: the clause body was the deterministic reducer
		expect(bus.traceLog.filter((e) => e.kind === 'step').length).toBe(run.steps.length)
	})
})

describe('json extraction from model text', () => {
	test('survives the observed failure shapes', async () => {
		const { extractJsonObject } = await import('../src/lib/chat/redpill')
		// clean object
		expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
		// prose apology spliced between a broken and a good object (seen live)
		const spliced =
			'{"id":"habit-stre ak-hub"} I apologize—let me provide the correct manifest cleanly: ' +
			'{"id":"habit-hub","name":"Habit Hub","description":"Keeps one record per habit."}'
		expect((extractJsonObject(spliced) as { id: string }).id).toBe('habit-hub')
		// markdown fences + trailing chatter
		expect(extractJsonObject('```json\n{"ping":"pong"}\n```\nHope this helps!')).toEqual({
			ping: 'pong'
		})
		// trailing comma healed
		expect(extractJsonObject('{"a":[1,2,],}')).toEqual({ a: [1, 2] })
		// nothing parseable
		expect(extractJsonObject('no json here')).toBeNull()
	})
})
