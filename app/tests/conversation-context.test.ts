import { expect, test } from 'bun:test'
import { conversationContext } from '@avenos/chat-engine/conversation-context'
import { ResearchRecord } from '@avenos/chat-engine/research'

test('checklist, verifier and repair preserve the offer and confirmation as role-labeled context', () => {
	const conversation = [
		{ role: 'user' as const, content: 'Entwirf einen ruhigen Tagesplan, nur hier im Chat.' },
		{
			role: 'assistant' as const,
			content: 'Soll der Beispielplan am 15. März nach der fiktiven Ankunft stattfinden?'
		}
	]
	const record = new ResearchRecord([], [], conversation)
	for (const messages of [
		record.checklistMessages('Genau, bitte diesen Tag verwenden.'),
		record.verifierMessages('Genau, bitte diesen Tag verwenden.', 'Hier ist dein Plan.'),
		record.answerRepairMessages('Genau, bitte diesen Tag verwenden.', ['Continue the itinerary'])
	]) {
		const data = JSON.parse(messages[1]!.content)
		expect(data.conversation).toEqual(conversation)
		expect(data.question).toBe('Genau, bitte diesen Tag verwenden.')
		expect(messages[0]!.content).toContain('not a new document-verification request')
	}
	expect(record.sources.size).toBe(0) // Earlier assistant claims are never promoted to sources.
})

test('bounded history retains the question at the end of a long offer', () => {
	const context = conversationContext(
		Array.from({ length: 50 }, (_, n) => ({
			role: 'assistant' as const,
			content: `${n}: ${'Unrelated long discussion. '.repeat(300)} Shall I build the afternoon itinerary?`
		}))
	)
	expect(context.length).toBeLessThanOrEqual(12)
	expect(context.reduce((size, item) => size + item.content.length, 0)).toBeLessThanOrEqual(16000)
	expect(context.at(-1)!.content).toStartWith('49:')
	expect(context.at(-1)!.content).toEndWith('Shall I build the afternoon itinerary?')
})
