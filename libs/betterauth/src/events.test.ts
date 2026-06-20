import { expect, test } from 'bun:test'
import { type ChangeEvent, publish, subscribe } from './events'

// The realtime invalidation contract the SSE stream + every mutation rely on: a published
// event reaches that user's subscribers, is isolated per user, and stops after unsubscribe.
// board 0055.
test('events_publish_on_mutation', () => {
	const a: ChangeEvent[] = []
	const b: ChangeEvent[] = []
	const offA = subscribe('user-a', (e) => a.push(e))
	const offB = subscribe('user-b', (e) => b.push(e))

	// A mutation publishes to the owning user only.
	publish('user-a', { entity: 'data' })
	expect(a).toEqual([{ entity: 'data' }])
	expect(b).toEqual([]) // isolation: user-b never sees user-a's change

	publish('user-b', { entity: 'billing' })
	expect(b).toEqual([{ entity: 'billing' }])
	expect(a).toHaveLength(1) // unchanged

	// Unsubscribe stops delivery; publishing to nobody is a safe no-op.
	offA()
	publish('user-a', { entity: 'usage' })
	expect(a).toHaveLength(1)
	publish(null, { entity: 'data' }) // missing user → no throw

	offB()
})
