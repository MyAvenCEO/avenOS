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
