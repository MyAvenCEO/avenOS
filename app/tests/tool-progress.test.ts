import { beforeAll, expect, test } from 'bun:test'
import { toolDetail, toolResultFailed } from '@avenos/chat-engine/tool-call'
import type { StreamEvent } from '../src/lib/chat/redpill'

let Chat: typeof import('../src/lib/chat/chat.svelte').Chat
beforeAll(async () => {
	;(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T) =>
		value
	Chat = (await import('../src/lib/chat/chat.svelte')).Chat
})
const specs = [
	{ name: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: {} } }
]
const stream = () => {
	let round = 0
	return async function* (): AsyncGenerator<StreamEvent> {
		if (round++ === 0) {
			yield { kind: 'tool', index: 0, id: 'call', name: 'inspect', args: '{"id":"document"}' }
			yield { kind: 'finish', reason: 'tool_calls' }
		} else {
			yield { kind: 'text', text: 'Finished.' }
			yield { kind: 'finish', reason: 'stop' }
		}
	}
}
async function until(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return
		await Bun.sleep(1)
	}
	throw Error('progress did not arrive')
}

test('tool calls become visible before completion, remain on the reply and follow their Intent', async () => {
	let finish!: () => void
	const pending = new Promise<void>((resolve) => {
		finish = resolve
	})
	const chat = new Chat(
		{},
		{
			specs,
			run: async () => {
				await pending
				return { record: '{"ok":true}', wire: 'ok' }
			}
		},
		stream()
	)
	chat.use('original')
	const sent = chat.send('Inspect this')
	await until(() => chat.activeToolCalls.length === 1)
	expect(chat.activeToolCalls[0]).toMatchObject({
		name: 'inspect',
		status: 'running',
		arguments: '{"id":"document"}'
	})
	chat.use('other')
	expect(chat.activeToolCalls).toEqual([])
	chat.use('original')
	finish()
	await sent
	expect(chat.turns.at(-1)?.calls?.[0]).toMatchObject({
		name: 'inspect',
		status: 'completed',
		result: '{"ok":true}'
	})
	expect(chat.activeToolCalls).toEqual([])
})

test('tool failures retain the attempted call even without an answer', async () => {
	const chat = new Chat(
		{},
		{
			specs,
			run: async () => {
				throw Error('Document unavailable')
			}
		},
		stream()
	)
	await chat.send('Inspect this')
	expect(chat.failure).toBe('Document unavailable')
	expect(chat.turns.at(-1)?.calls?.[0]).toMatchObject({
		status: 'failed',
		error: 'Document unavailable'
	})
})

test('stopping during a call prevents later calls in the same batch, without claiming the first was undone', async () => {
	let finish!: () => void
	const pending = new Promise<void>((resolve) => {
		finish = resolve
	})
	let executions = 0
	const chat = new Chat(
		{},
		{
			specs,
			run: async () => {
				executions++
				await pending
				return { record: '{}', wire: 'ok' }
			}
		},
		async function* () {
			yield { kind: 'tool', index: 0, id: 'first', name: 'inspect', args: '{}' }
			yield { kind: 'tool', index: 1, id: 'second', name: 'inspect', args: '{}' }
			yield { kind: 'finish', reason: 'tool_calls' }
		}
	)
	const sent = chat.send('Inspect this')
	await until(() => chat.activeToolCalls.length === 1)
	chat.stop()
	finish()
	await sent
	expect(executions).toBe(1)
	expect(chat.turns.at(-1)?.calls?.[0].status).toBe('interrupted')
	chat.resetForEnvironment()
	expect(chat.toolCalls).toEqual([])
})

test('returned tool errors are visible and diagnostic JSON redacts credential fields', () => {
	expect(toolResultFailed('{"ok":false}')).toBe(true)
	expect(toolResultFailed('{"error":"unavailable"}')).toBe(true)
	expect(toolResultFailed('{"ok":true}')).toBe(false)
	expect(toolDetail('{"nested":{"api_key":"private"},"query":"invoice"}')).not.toContain('private')
	expect(toolDetail('x'.repeat(13000))).toContain('Display truncated')
})

test('an exhausted budget leaves a visible rejected call and never executes it', async () => {
	let executed = 0
	const chat = new Chat(
		{},
		{
			specs,
			run: async () => {
				executed++
				return { record: '{}', wire: 'ok' }
			}
		},
		async function* () {
			yield { kind: 'tool', index: 0, id: 'repeat', name: 'inspect', args: '{}' }
			yield { kind: 'finish', reason: 'tool_calls' }
		}
	)
	await chat.send('Inspect')
	expect(executed).toBe(32)
	expect(chat.turns.at(-1)?.calls).toHaveLength(33)
	expect(chat.turns.at(-1)?.calls?.at(-1)).toMatchObject({
		status: 'failed',
		error: 'Not executed: retrieval/action budget exhausted.'
	})
	expect(chat.lastRequest?.messages[0].content).toContain('No retrieval or action calls remain')
})
