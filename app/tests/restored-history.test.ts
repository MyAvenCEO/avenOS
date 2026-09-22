import { expect, test } from 'bun:test'
import { recentWireMessages } from '@avenos/chat-engine/history-selection'
import type { ChatMessage } from '@avenos/chat-engine/model'
import { historicalToolResult, restoredWireMessages } from '@avenos/chat-engine/restored-history'
import type { ToolCall } from '@avenos/chat-engine/tool-call'

test('restored source checklists stay in diagnostics, not in the next answer state', () => {
	const research: ToolCall = {
		id: 'old-checklist',
		name: 'research_record',
		arguments:
			'{"items":[{"requirement":"An earlier question","sources":[{"sourceId":"old-source","quoteRef":"0:0"}]}]}',
		status: 'completed',
		result: '{"ok":true,"count":1}'
	}
	const turns = [
		{
			id: 'answer',
			role: 'assistant' as const,
			content: 'Earlier answer.',
			calls: [call, research]
		}
	]
	const wire = restoredWireMessages(turns)
	expect(JSON.stringify(wire)).not.toContain('old-source')
	expect(JSON.stringify(wire)).not.toContain('research_record')
	expect(JSON.stringify(wire)).toContain('records_update')
	expect(turns[0].calls).toHaveLength(2)
})

test('live history drops only earlier research pairs, preserving text, actions and current evidence', () => {
	const prior: ChatMessage[] = [
		{ role: 'user', content: 'Earlier question' },
		{
			role: 'assistant',
			content: 'Earlier context',
			tool_calls: [
				{
					id: 'prior-audit',
					type: 'function',
					function: { name: 'research_record', arguments: '{"items":[]}' }
				},
				{
					id: 'prior-effect',
					type: 'function',
					function: { name: 'records_update', arguments: '{}' }
				}
			]
		},
		{ role: 'tool', tool_call_id: 'prior-audit', content: '{"ok":true}' },
		{ role: 'tool', tool_call_id: 'prior-effect', content: '{"ok":true,"revision":4}' }
	]
	const active: ChatMessage[] = [
		{ role: 'user', content: 'Next question' },
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'current-audit',
					type: 'function',
					function: { name: 'research_record', arguments: '{"items":[]}' }
				}
			]
		},
		{ role: 'tool', tool_call_id: 'current-audit', content: '{"ok":true}' }
	]
	const result = recentWireMessages([...prior, ...active], prior.length).messages
	expect(JSON.stringify(result)).not.toContain('prior-audit')
	expect(JSON.stringify(result)).toContain('prior-effect')
	expect(result.some((m) => m.content === 'Earlier context')).toBe(true)
	expect(result.slice(-3)).toEqual(active)
	expect(prior[1].tool_calls).toHaveLength(2)
})

const call: ToolCall = {
	id: 'synthetic-call',
	name: 'records_update',
	arguments: '{"id":"opaque-reference","revision":3}',
	status: 'completed',
	result: JSON.stringify({ ok: true, id: 'opaque-reference', revision: 4, value: 'x'.repeat(1800) })
}
test('rehydration retains exact tool results as complete paired observations', () => {
	const wire = restoredWireMessages([
		{ id: 'human', role: 'user', content: 'Update my saved record.' },
		{ id: 'answer', role: 'assistant', content: 'Updated.', calls: [call] }
	])
	expect(wire.map((item) => item.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
	expect(wire[1].tool_calls![0].id).toBe(wire[2].tool_call_id)
	expect(JSON.parse(wire[2].content)).toEqual(JSON.parse(call.result))
	expect(JSON.parse(recentWireMessages(wire, wire.length).messages[2].content)).toEqual(
		JSON.parse(call.result)
	)
})
test('unknown outcomes and missing or truncated saved results cannot masquerade as complete receipts', () => {
	for (const value of [
		{ ...call, status: 'interrupted' as const },
		{ ...call, result: '{"ok":true,"id":… Saved detail truncated' },
		{ ...call, result: JSON.stringify({ ok: true, data: 'x'.repeat(10000) }) }
	])
		expect(JSON.parse(historicalToolResult(value)).resultRetained).toBe(false)
})
test('historical tool chatter is bounded and secrets are not copied into model context', () => {
	const wire = restoredWireMessages([
		{
			id: 'answer',
			role: 'assistant',
			content: 'Done.',
			calls: Array.from({ length: 100 }, (_, index) => ({
				...call,
				id: String(index),
				arguments: '{"token":"synthetic-secret"}',
				result: '{"ok":true,"password":"synthetic-secret"}'
			}))
		}
	])
	expect(wire).toHaveLength(9)
	expect(JSON.stringify(wire)).not.toContain('synthetic-secret')
})
