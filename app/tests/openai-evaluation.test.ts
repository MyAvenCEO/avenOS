import { expect, test } from 'bun:test'
import { evaluationInput } from '../e2e/openai-evaluation'
import type { ChatMessage } from '../src/lib/chat/redpill'

test('evaluation preserves call IDs and native reasoning across tool results', () => {
	const native = [
		{ type: 'reasoning', id: 'r1', encrypted_content: 'opaque-reasoning', summary: [] },
		{
			type: 'function_call',
			call_id: 'c1',
			name: 'calculate',
			arguments: '{"currency":"EUR","amounts":[150,-50]}'
		}
	]
	const cached = new Map([['c1', native]])
	const messages: ChatMessage[] = [
		{ role: 'system', content: 'Use supplied evidence.' },
		{ role: 'user', content: 'Calculate the refund balance.' },
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'c1',
					type: 'function',
					function: { name: 'calculate', arguments: '{"currency":"EUR","amounts":[150,-50]}' }
				}
			]
		},
		{ role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"totalMinor":100}' }
	]
	expect(evaluationInput(messages, cached)).toEqual([
		{ role: 'system', content: 'Use supplied evidence.' },
		{ role: 'user', content: 'Calculate the refund balance.' },
		...native,
		{ type: 'function_call_output', call_id: 'c1', output: '{"ok":true,"totalMinor":100}' }
	])
	const firstCall = messages[2].tool_calls?.[0]
	if (!firstCall) throw Error('Missing test call')
	firstCall.function.arguments = '{"notice":"Superseded checklist"}'
	expect(evaluationInput(messages, cached)[3]).toMatchObject({
		type: 'function_call',
		arguments: '{"notice":"Superseded checklist"}'
	})
	evaluationInput([{ role: 'user', content: 'New independent case.' }], cached)
	expect(cached.size).toBe(0)
})

test('evaluation accepts Qwen history without inventing reasoning or losing parallel calls', () => {
	const calls = ['a', 'b'].map((id) => ({
		id,
		type: 'function' as const,
		function: { name: 'workspace_read', arguments: JSON.stringify({ kind: 'document', id }) }
	}))
	const input = evaluationInput(
		[
			{ role: 'assistant', content: 'I will read both sources.', tool_calls: calls },
			{ role: 'tool', tool_call_id: 'a', content: 'Source A' },
			{ role: 'tool', tool_call_id: 'b', content: 'Source B' }
		],
		new Map()
	)
	expect(input).toHaveLength(5)
	expect(input[1]).toMatchObject({ type: 'function_call', call_id: 'a' })
	expect(input[2]).toMatchObject({ type: 'function_call', call_id: 'b' })
	expect(input[4]).toMatchObject({ type: 'function_call_output', call_id: 'b', output: 'Source B' })
	expect(() => evaluationInput([{ role: 'tool', content: 'Orphan' }], new Map())).toThrow('call ID')
})
