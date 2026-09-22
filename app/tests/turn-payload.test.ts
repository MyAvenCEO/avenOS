import { expect, test } from 'bun:test'
import { historicalToolResult } from '@avenos/chat-engine/restored-history'
import type { ToolCall } from '@avenos/chat-engine/tool-call'
import { callsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'

const call: ToolCall = {
	id: 'call',
	name: 'studio_edit_definition',
	arguments: '{"token":"private-token","edit":{"kind":"rename","name":"Invoice index"}}',
	result: '{"ok":false,"error":"Invalid definition"}',
	status: 'failed',
	durationMs: 3
}
test('failed tool outcomes survive transcript persistence without credential fields', () => {
	const payload = turnPayload({
		id: 'reply',
		role: 'assistant',
		content: 'The edit failed.',
		calls: [call]
	})
	expect(JSON.stringify(payload)).not.toContain('private-token')
	expect(callsFromPayload(payload)).toMatchObject([
		{ name: call.name, status: 'failed', durationMs: 3 }
	])
	expect(callsFromPayload(payload)[0].result).toContain('Invalid definition')
})
test('saved diagnostics stay below the customer contribution byte limit and mark truncation', () => {
	const payload = turnPayload({
		id: 'reply',
		role: 'assistant',
		content: 'Failed.',
		calls: Array.from({ length: 500 }, (_, i) => ({
			...call,
			id: String(i),
			result: '界'.repeat(30_000)
		}))
	})
	expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(64 * 1024)
	expect(payload.toolCallCount).toBe(500)
	expect(payload.toolCallsTruncated).toBe(true)
	expect(JSON.parse(historicalToolResult(callsFromPayload(payload)[0])).resultRetained).toBe(false)
	expect(callsFromPayload(payload).at(-1)?.id).toBe('499')
})

test('saved recent outcomes retain complete JSON beyond the old display excerpt limit', () => {
	const record = {
		ok: true,
		tasks: [{ id: 'synthetic-reference', revision: 2, title: 'x'.repeat(1700) }]
	}
	const payload = turnPayload({
		id: 'reply',
		role: 'assistant',
		content: 'Saved.',
		calls: [{ ...call, status: 'completed', result: JSON.stringify(record) }]
	})
	expect(JSON.parse(callsFromPayload(payload)[0].result)).toEqual(record)
})
test('restoration never presents persisted running calls as live execution', () => {
	expect(
		callsFromPayload({
			toolCalls: [null, { ...call, status: 'running' }, { ...call, durationMs: -1 }, call]
		})
	).toEqual([call])
})

test('large earlier results do not erase later tool outcomes', () => {
	const calls = Array.from({ length: 40 }, (_, i) => ({
		...call,
		id: `synthetic-${i}`,
		result: '界'.repeat(30_000)
	}))
	calls[39] = { ...calls[39]!, result: '{"ok":false,"error":"Final write rejected"}' }
	const payload = turnPayload({ id: 'reply', role: 'assistant', content: '', calls })
	const restored = callsFromPayload(payload)
	expect(restored).toHaveLength(40)
	expect(restored.at(-1)?.result).toContain('Final write rejected')
	expect(payload.toolCallsTruncated).toBe(false)
	expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(64 * 1024)
})
