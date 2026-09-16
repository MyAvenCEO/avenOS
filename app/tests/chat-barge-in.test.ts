import { beforeAll, describe, expect, test } from 'bun:test'
import type { AnonymousSpeaker } from '../src/lib/chat/anonymous-speaker'
import type { ChatMessage, StreamEvent, ToolSpec } from '../src/lib/chat/redpill'

let Chat: typeof import('../src/lib/chat/chat.svelte').Chat

beforeAll(async () => {
	;(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T) =>
		value
	Chat = (await import('../src/lib/chat/chat.svelte')).Chat
})

describe('Chat barge-in', () => {
	test('model requests use recent history while keeping active tool results across rounds', async () => {
		const requests: ChatMessage[][] = []
		const stream = async function* (messages: ChatMessage[]): AsyncGenerator<StreamEvent> {
			requests.push(messages)
			if (requests.length === 1) {
				yield { kind: 'tool', index: 0, id: 'call-1', name: 'probe', args: '{}' }
			} else {
				yield { kind: 'text', text: 'Found it.' }
			}
		}
		const chat = new Chat(
			{},
			{
				specs: [
					{ name: 'probe', description: 'probe', parameters: { type: 'object', properties: {} } }
				],
				run: async () => ({ record: '{"ok":true}', wire: 'Current result' })
			},
			stream
		)
		chat.hydrate(
			'long-intent',
			Array.from({ length: 500 }, (_, index) => ({
				id: String(index),
				role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
				content: `Old ${index}`
			}))
		)
		chat.use('long-intent')
		await chat.send('Current question')
		expect(requests).toHaveLength(2)
		expect(requests[0].length).toBeLessThanOrEqual(26)
		expect(requests[0].some((message) => message.content === 'Old 0')).toBe(false)
		expect(
			requests[1].some(
				(message) => message.tool_call_id === 'call-1' && message.content === 'Current result'
			)
		).toBe(true)
		expect(chat.messageHistory('long-intent')).toHaveLength(502)
	})

	test('older intent details can retrieve matching conversation without switching sessions', () => {
		const chat = new Chat()
		chat.hydrate('old-intent', [
			{ id: '1', role: 'user', content: 'The permit was approved in June.' },
			...Array.from({ length: 30 }, (_, index) => ({
				id: String(index + 2),
				role: 'assistant' as const,
				content: `Later message ${index}`
			}))
		])
		expect(chat.conversationMatches('old-intent', 'permit was approved')).toBe(true)
		expect(chat.conversationFor('old-intent', 'permit was approved')).toEqual([
			{ role: 'user', content: 'The permit was approved in June.' }
		])
		expect(chat.session).not.toBe('old-intent')
	})

	test('queues the final utterance until the interrupted stream has unwound', async () => {
		const speaker: AnonymousSpeaker = {
			session_id: 'session-1',
			speaker_id: 'speaker-2',
			confidence: 0.91
		}
		const stream = async function* (
			messages: ChatMessage[],
			_tools: ToolSpec[],
			signal?: AbortSignal
		): AsyncGenerator<StreamEvent> {
			const prompt = [...messages].reverse().find((message) => message.role === 'user')?.content
			if (prompt === 'first') {
				yield { kind: 'text', text: 'Opening. ' }
				await new Promise<never>((_resolve, reject) => {
					const aborted = () => reject(new Error('aborted'))
					if (signal?.aborted) aborted()
					else signal?.addEventListener('abort', aborted, { once: true })
				})
			}
			yield { kind: 'text', text: 'Follow-up reply.' }
		}
		const chat = new Chat({}, undefined, stream)
		const first = chat.send('first')
		await waitUntil(() => chat.routingReply === 'Opening. ')
		const followUp = chat.send('second', speaker)
		await Promise.all([first, followUp])

		expect(chat.turns.map((turn) => [turn.role, turn.content])).toEqual([
			['user', 'first'],
			['assistant', 'Opening. '],
			['user', 'second'],
			['assistant', 'Follow-up reply.']
		])
		expect(chat.turns[2]?.anonymousSpeaker).toEqual(speaker)
	})
})

describe('Chat environment reset', () => {
	test('discards conversations from every prior Intent session', async () => {
		const stream = async function* (): AsyncGenerator<StreamEvent> {
			yield { kind: 'text', text: 'Reply.' }
		}
		const chat = new Chat({}, undefined, stream)
		chat.use('first-intent')
		await chat.send('first')
		chat.use('second-intent')
		await chat.send('second')
		expect(chat.turns).toHaveLength(2)

		chat.resetForEnvironment()
		chat.use('first-intent')
		expect(chat.turns).toEqual([])
		chat.use('second-intent')
		expect(chat.turns).toEqual([])
		expect(chat.lastRequest).toBeNull()
	})
})

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error('condition was not reached')
}
