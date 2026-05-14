import { expect, test } from 'bun:test'

import { ActorRegistry } from '../src/actor-registry'

test('refuses duplicate handler registration', () => {
	const registry = new ActorRegistry()
	const handler = {
		kind: 'intent',
		activate: async () => ({ nextState: {}, contextAppends: [], commands: [] })
	}

	registry.register(handler)

	expect(() => registry.register(handler)).toThrow('Actor handler already registered for kind: intent')
})