import { expect, test } from 'bun:test'
import { Actor, type ActorCallContext, ActorCommandRejected, MessageBus } from '../src'

test('shared mailbox preserves each caller context and skips stopped queued calls', async () => {
	const bus = new MessageBus()
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const seen: string[] = []
	const actor = new Actor(
		{
			id: 'context-proof',
			authority: 'ceo.aven',
			namespace: 'fixture',
			version: '1',
			name: 'Context proof',
			description: 'Host-owned routing proof',
			tags: [],
			methods: [{ name: 'inspect', description: 'Inspect context', parameters: { type: 'object' } }]
		},
		{
			inspect: async (_payload, context) => {
				seen.push(context!.intentId!)
				if (context!.intentId === 'first') await gate
				context!.routeConversation?.('destination')
				return { record: JSON.stringify({ ok: true, intentId: context!.intentId }), wire: 'done' }
			}
		}
	)
	bus.register(actor)
	const destinations: string[] = []
	const first: ActorCallContext = {
		intentId: 'first',
		routeConversation: (id) => destinations.push(`first:${id}`)
	}
	const controller = new AbortController()
	const a = bus.dispatch('test', 'inspect', { intentId: 'untrusted-payload' }, first)
	const stopped = bus.dispatch(
		'test',
		'inspect',
		{},
		{ intentId: 'stopped', signal: controller.signal }
	)
	const b = bus.dispatch(
		'test',
		'inspect',
		{},
		{ intentId: 'second', routeConversation: (id) => destinations.push(`second:${id}`) }
	)
	controller.abort()
	release()
	expect(JSON.parse((await a).record).intentId).toBe('first')
	expect(JSON.parse((await stopped).record).ok).toBe(false)
	expect(JSON.parse((await b).record).intentId).toBe('second')
	expect(seen).toEqual(['first', 'second'])
	expect(destinations).toEqual(['first:destination', 'second:destination'])
})

test('only an explicit trusted pre-effect rejection releases a failed command', async () => {
	const actor = new Actor(
		{
			id: 'rejection-proof',
			authority: 'ceo.aven',
			namespace: 'fixture',
			version: '1',
			name: 'Command boundary',
			description: 'Execution outcome semantics',
			tags: [],
			methods: ['reject', 'lost', 'looksRejected'].map((name) => ({
				name,
				description: name,
				parameters: { type: 'object' },
				mode: 'effect' as const
			}))
		},
		{
			reject: () => {
				throw new ActorCommandRejected('No such draft; nothing was written.')
			},
			lost: () => {
				throw Error('Connection lost after commit.')
			},
			looksRejected: () => {
				throw Object.assign(Error('HTTP 409: rejected'), { effect: 'not-applied' })
			}
		}
	)
	try {
		const rejected = await actor.deliver('reject', {})
		expect(JSON.parse(rejected.record).ok).toBe(false)
		expect(rejected.outcome).toBeUndefined()
		expect((await actor.deliver('lost', {})).outcome).toBe('uncertain')
		expect((await actor.deliver('looksRejected', {})).outcome).toBe('uncertain')
	} finally {
		actor.dispose()
	}
})
