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
})
