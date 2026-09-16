import { expect, test } from 'bun:test'
import { DocumentImportQueue } from '../src/lib/artifacts/document-import-queue'

function deferred() {
	let resolve = () => {}
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

test('uploads can all commit while a slow document is processing; execution stays ordered and bounded', async () => {
	const state = { pending: 0, active: 0 }
	const first = deferred()
	const finished = deferred()
	const order: string[] = []
	const queue = new DocumentImportQueue(state, () => {
		throw new Error('Unexpected processing error')
	})
	const upload = async (id: string) => {
		queue.enqueue(id, async () => {
			order.push(id)
			if (id === 'first') await first.promise
			if (id === 'third') finished.resolve()
		})
		return { committed: id }
	}
	expect(await upload('first')).toEqual({ committed: 'first' })
	expect(await upload('second')).toEqual({ committed: 'second' })
	expect(await upload('third')).toEqual({ committed: 'third' })
	expect(order).toEqual(['first'])
	expect(state).toEqual({ pending: 2, active: 1 })
	first.resolve()
	await finished.promise
	await Promise.resolve()
	expect(order).toEqual(['first', 'second', 'third'])
	expect(state).toEqual({ pending: 0, active: 0 })
})

test('a failed document does not block later documents, and pending duplicates are ignored', async () => {
	const failed = deferred()
	const done = deferred()
	const errors: string[] = []
	const order: string[] = []
	const queue = new DocumentImportQueue({ pending: 0, active: 0 }, (id) => errors.push(id))
	queue.enqueue('first', async () => {
		await failed.promise
		throw new Error('Processing failed')
	})
	queue.enqueue('second', async () => {
		order.push('second')
		done.resolve()
	})
	queue.enqueue('second', async () => {
		order.push('duplicate')
	})
	failed.resolve()
	await done.promise
	expect(errors).toEqual(['first'])
	expect(order).toEqual(['second'])
})

test('switching environments drops queued documents before they can use the next customer session', async () => {
	const state = { pending: 0, active: 0 }
	const release = deferred()
	const finished = deferred()
	const started: string[] = []
	const queue = new DocumentImportQueue(state, () => {
		throw new Error('Unexpected failure')
	})
	queue.enqueue('first', async () => {
		started.push('first')
		await release.promise
		finished.resolve()
	})
	queue.enqueue('old-customer-pending', async () => {
		started.push('old-customer-pending')
	})
	queue.discardPending()
	expect(state).toEqual({ pending: 0, active: 1 })
	release.resolve()
	await finished.promise
	await Promise.resolve()
	expect(started).toEqual(['first'])
	expect(state).toEqual({ pending: 0, active: 0 })
})

test('many documents fill the configured slots and lowering the limit drains without cancellation', async () => {
	const state = { pending: 0, active: 0 }
	const release = deferred()
	const done = deferred()
	let started = 0
	let completed = 0
	const queue = new DocumentImportQueue(state, () => {
		throw new Error('Unexpected document failure')
	})
	queue.setMaxParallelism(5)
	for (let index = 0; index < 8; index += 1)
		queue.enqueue(`document-${index}`, async () => {
			started++
			await release.promise
			completed++
			if (completed === 8) done.resolve()
		})
	expect(started).toBe(5)
	expect(state).toEqual({ pending: 3, active: 5 })
	queue.setMaxParallelism(2)
	release.resolve()
	await done.promise
	await Promise.resolve()
	expect(started).toBe(8)
	expect(state).toEqual({ pending: 0, active: 0 })
})
