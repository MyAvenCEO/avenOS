import { expect, test } from 'vitest'
import { LlmPermits } from '../src/lib/server/llm-permits.js'

test('cancelled waiters leave capacity for the next request in FIFO order', async () => {
	const permits = new LlmPermits(1)
	const releaseFirst = await permits.acquire()
	const controller = new AbortController()
	const cancelled = permits.acquire(controller.signal)
	const next = permits.acquire()
	controller.abort()
	await expect(cancelled).rejects.toThrow('cancelled')
	releaseFirst()
	const releaseNext = await next
	releaseFirst() // A duplicate release cannot free the next request's slot.
	let admitted = false
	const last = permits.acquire().then((release) => {
		admitted = true
		release()
	})
	await Promise.resolve()
	expect(admitted).toBe(false)
	releaseNext()
	await last
	expect(admitted).toBe(true)
})
