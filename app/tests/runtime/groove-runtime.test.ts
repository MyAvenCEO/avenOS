import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const invokeMock = mock(() => Promise.resolve(undefined as never))

beforeEach(() => {
	invokeMock.mockClear()
	mock.module('@tauri-apps/api/core', () => ({
		invoke: invokeMock,
	}))
})

afterEach(() => {
	mock.restore()
})

describe('grooveRuntime multiplex', () => {
	test('invokes groove_runtime with op and payload', async () => {
		const { grooveRuntime } = await import('../../src/lib/runtime/groove-ipc')
		invokeMock.mockImplementation(() => Promise.resolve({ ready: true, tables: ['a'] } as never))
		const r = await grooveRuntime<{ ready: boolean; tables: string[] }>('bootstrap', {})
		expect(invokeMock).toHaveBeenCalledTimes(1)
		expect(invokeMock.mock.calls[0]).toEqual([
			'groove_runtime',
			{ op: 'bootstrap', payload: {} },
		])
		expect(r.ready).toBe(true)
		expect(r.tables).toEqual(['a'])
	})

		test('invokes intentStart through the shared groove_runtime bridge', async () => {
			const { intentStart } = await import('../../src/lib/intents/api')
			const file = new File(['hello'], 'invoice.txt', { type: 'text/plain' })
			invokeMock.mockImplementation((command, payload) => {
				if (payload?.op === 'intentStart') {
					return Promise.resolve({ type: 'ok', value: { intentId: 'intent~1' } } as never)
				}
				if (payload?.op === 'intentGet') {
					return Promise.resolve({
						id: 'intent~1',
						title: 'Intent 1',
						summary: 'summary',
						status: 'working',
						updatedAtMs: 1,
						openCommunicationCount: 0,
						artifactRefs: [],
						logs: [],
					} as never)
				}
				return Promise.resolve(undefined as never)
			})

			const result = await intentStart('hello world', [file])
			expect(invokeMock.mock.calls[0]?.[0]).toBe('groove_runtime')
			expect(invokeMock.mock.calls[0]?.[1]?.op).toBe('intentStart')
			expect(invokeMock.mock.calls[1]?.[1]).toEqual({
				op: 'intentGet',
				payload: { intentId: 'intent~1' },
			})
			expect(result?.id).toBe('intent~1')
		})
})
