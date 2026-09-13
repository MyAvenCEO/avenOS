import type { PlanRunnerClient } from '@avenos/actors'
import { expect, test, vi } from 'vitest'
import {
	DocumentExecutionRouter,
	documentRunStartRequest,
	RemoteDocumentExecutionHost
} from '../src/execution'

const source = { artifactId: '11111111-1111-4111-8111-111111111111', originalName: 'invoice.pdf' }
test('a rejected first remote start leaves a failed presentation', async () => {
	const host = new RemoteDocumentExecutionHost({
		start: async () => {
			throw new Error('start refused')
		}
	} as unknown as PlanRunnerClient)
	await expect(host.start(documentRunStartRequest(source, 'server'))).rejects.toThrow(
		'start refused'
	)
	expect(host.status(source.artifactId)).toMatchObject({
		state: 'failed',
		summary: expect.stringContaining('start refused')
	})
})
test('router reports source resolution and synchronous host failures', async () => {
	const host = {
		executionEnvironment: 'local' as const,
		start: () => {
			throw new Error('source unavailable')
		},
		status: () => undefined
	}
	const remote = new RemoteDocumentExecutionHost({} as PlanRunnerClient)
	const router = new DocumentExecutionRouter({ local: host, server: remote })
	expect(await router.start(documentRunStartRequest(source, 'local'))).toMatchObject({
		state: 'failed',
		summary: 'source unavailable'
	})
	expect(router.status(source.artifactId)?.state).toBe('failed')
})
test('cancellation requested during admission reaches the admitted server run', async () => {
	let admit!: (value: unknown) => void
	const runId = crypto.randomUUID()
	const cancel = vi.fn(async () => ({ runId, state: 'cancelled' }))
	const host = new RemoteDocumentExecutionHost(
		{
			start: () =>
				new Promise((resolve) => {
					admit = resolve
				}),
			cancel,
			status: async () => ({ state: 'cancelled' })
		} as unknown as PlanRunnerClient,
		1
	)
	const pending = host.start(documentRunStartRequest(source, 'server'))
	await host.cancel(source.artifactId)
	admit({ runId, state: 'accepted' })
	expect((await pending).state).toBe('failed')
	expect(cancel).toHaveBeenCalledWith(runId, expect.any(String))
})

test('retry after refused admission can reattempt admission', async () => {
	const host = new RemoteDocumentExecutionHost({
		start: async () => {
			throw new Error('offline')
		}
	} as unknown as PlanRunnerClient)
	await expect(host.start(documentRunStartRequest(source, 'server'))).rejects.toThrow('offline')
	await expect(host.retry(source.artifactId)).resolves.toBeUndefined()
})
test('retrying a monitoring failure does not retry the still-running execution', async () => {
	const runId = crypto.randomUUID()
	let available = false
	const retry = vi.fn()
	const host = new RemoteDocumentExecutionHost(
		{
			start: async () => ({ runId }),
			status: async () => {
				if (!available) throw new Error('monitor disconnected')
				return { state: 'running' }
			},
			retry
		} as unknown as PlanRunnerClient,
		1
	)
	await expect(host.start(documentRunStartRequest(source, 'server'))).rejects.toThrow(
		'disconnected'
	)
	available = true
	await host.retry(source.artifactId)
	expect(retry).not.toHaveBeenCalled()
})
