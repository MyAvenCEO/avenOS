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

test('busy work cannot occupy the reserved input slot and input cannot starve work', async () => {
	const permits = new LlmPermits(3)
	const a = await permits.acquire()
	const b = await permits.acquire()
	let workStarted = false
	const c = permits.acquire().then((release) => {
		workStarted = true
		return release
	})
	const input = await permits.acquire(undefined, 'interactive', 'person')
	expect(workStarted).toBe(false)
	let anotherInput = false
	const nextInput = permits.acquire(undefined, 'interactive', 'person').then((release) => {
		anotherInput = true
		return release
	})
	a()
	const releaseWork = await c
	expect(anotherInput).toBe(false)
	input()
	const releaseInput = await nextInput
	releaseWork()
	releaseInput()
	b()
})

test('one-slot providers prioritize routing but bound bursts to prevent starvation', async () => {
	const permits = new LlmPermits(1)
	const first = await permits.acquire()
	const order: string[] = []
	const work = permits.acquire().then((release) => {
		order.push('work')
		release()
	})
	const inputs = Array.from({ length: 5 }, (_, i) =>
		permits.acquire(undefined, 'interactive').then((release) => {
			order.push(`input${i}`)
			release()
		})
	)
	expect(order).toEqual([])
	first()
	await Promise.all([work, ...inputs])
	expect(order).toEqual(['input0', 'input1', 'input2', 'work', 'input3', 'input4'])
})

test('a full work queue leaves independent admission room for routing', async () => {
	const permits = new LlmPermits(1)
	const release = await permits.acquire()
	const waiting = Array.from({ length: 96 }, (_, i) =>
		permits.acquire(undefined, 'work', `owner${i % 6}`).then((done) => done())
	)
	await expect(permits.acquire(undefined, 'work', 'another')).rejects.toThrow('full')
	let routed = false
	const routing = permits.acquire(undefined, 'interactive', 'owner0').then((done) => {
		routed = true
		done()
	})
	release()
	await routing
	expect(routed).toBe(true)
	await Promise.all(waiting)
})
