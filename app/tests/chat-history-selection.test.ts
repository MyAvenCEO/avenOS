import { expect, test } from 'bun:test'
import { pageMessages, recentWireMessages } from '../src/lib/chat/history-selection'
import type { ChatMessage } from '../src/lib/chat/redpill'

const old = Array.from(
	{ length: 500 },
	(_, index): ChatMessage => ({
		role: index % 2 === 0 ? 'user' : 'assistant',
		content: index === 12 ? 'The permit was approved in June.' : `Message ${index}`
	})
)

test('a long conversation sends only recent completed messages plus the current turn', () => {
	const wire = [...old, { role: 'user' as const, content: 'Current request' }]
	const recent = recentWireMessages(wire, old.length)
	expect(recent.messages).toHaveLength(25)
	expect(recent.omitted).toBe(476)
	expect(recent.messages[0].role).toBe('user')
	expect(recent.messages.at(-1)?.content).toBe('Current request')
	expect(wire).toHaveLength(501)
})

test('recent tool calls keep their result, and the active round is never trimmed', () => {
	const prior: ChatMessage[] = [
		...old.slice(0, 30),
		{ role: 'user', content: 'Find the document' },
		{
			role: 'assistant',
			content: '',
			tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'find', arguments: '{}' } }]
		},
		{ role: 'tool', tool_call_id: 'call-1', content: 'Found the document' },
		{ role: 'assistant', content: 'It is here.' }
	]
	const active: ChatMessage[] = [
		{ role: 'user', content: 'Read it' },
		{
			role: 'assistant',
			content: '',
			tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'read', arguments: '{}' } }]
		},
		{ role: 'tool', tool_call_id: 'call-2', content: 'Full current result' }
	]
	const selected = recentWireMessages([...prior, ...active], prior.length, 4)
	expect(selected.messages.map((message) => message.role)).toEqual([
		'user',
		'assistant',
		'tool',
		'assistant',
		'user',
		'assistant',
		'tool'
	])
	expect(selected.messages.at(-1)?.content).toBe('Full current result')
})

test('older messages remain searchable and browsable in bounded newest-first pages', () => {
	const messages = old.map((message) => ({
		role: message.role as 'user' | 'assistant',
		content: message.content
	}))
	const hit = pageMessages(messages, 'permit was approved', 0, 10)
	expect(hit.total).toBe(1)
	expect(hit.rows[0].content).toContain('permit was approved')
	const first = pageMessages(messages, '', 0, 500)
	expect(first.rows).toHaveLength(20)
	expect(first.rows[0].content).toBe('Message 499')
	expect(first.hasMore).toBe(true)
	const second = pageMessages(messages, '', 20, 20)
	expect(second.rows[0].content).toBe('Message 479')
})

test('different-language or reordered search terms surface an older matching passage', () => {
	const messages = [
		{ role: 'assistant' as const, content: 'Routine owner and schedule update.' },
		{
			role: 'user' as const,
			content: 'The Pioneer permit renewal is blocked waiting on Marta’s signed Form M-4.'
		},
		{ role: 'assistant' as const, content: 'Another routine owner and schedule update.' }
	]
	const page = pageMessages(messages, 'blocker blockiert Genehmigung Pioneer', 0, 10)
	expect(page.matchMode).toBe('keywords')
	expect(page.rows[0].content).toContain('Marta’s signed Form M-4')
})

test('default history selection does not touch the old prefix of a million-message history', () => {
	const length = 1_000_001
	const wire = new Proxy({ length } as ChatMessage[], {
		get(target, key) {
			if (key === 'slice') return Array.prototype.slice
			if (key === 'length') return length
			if (typeof key === 'string' && /^\d+$/.test(key)) {
				const n = Number(key)
				if (n < length - 25) throw Error('Historical prefix was accessed')
				return { role: n % 2 ? 'assistant' : 'user', content: `Message ${n}` }
			}
			return Reflect.get(target, key)
		},
		has(_target, key) {
			return typeof key === 'string' && /^\d+$/.test(key) ? true : key === 'length'
		}
	})
	const r = recentWireMessages(wire, length - 1)
	expect(r.messages).toHaveLength(25)
	expect(r.omitted).toBe(length - 25)
})
