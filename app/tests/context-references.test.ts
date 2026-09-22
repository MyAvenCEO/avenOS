import { expect, test } from 'bun:test'
import {
	captureContextReferences,
	contextReferencesMessage
} from '@avenos/chat-engine/context-references'
import { ResearchRecord } from '@avenos/chat-engine/research'

test('writer and auditor keep the captured identity instead of following mutable display state', () => {
	const source = [
		{ kind: 'intent' as const, id: crypto.randomUUID(), title: 'Fictional kite workshop' }
	]
	const captured = captureContextReferences(source)
	const record = new ResearchRecord([], [], [], [], undefined, {
		intentId: 'current-workshop',
		references: captured
	})
	source[0].title = 'Later screen selection'
	captured[0].title = 'Later caller mutation'
	const review = JSON.parse(
		record.verifierMessages('Which workshop?', 'Fictional kite workshop')[1].content
	)
	const repair = JSON.parse(record.answerRepairMessages('Which workshop?', [])[1].content)
	expect(review.contextReferences).toEqual(repair.contextReferences)
	expect(review.conversationIntentId).toBe('current-workshop')
	expect(repair.conversationIntentId).toBe('current-workshop')
	expect(review.contextReferences[0].title).toBe('Fictional kite workshop')
	expect(contextReferencesMessage(record.contextReferences)).toContain(
		JSON.stringify({ conversationIntentId: null, contextReferences: review.contextReferences })
	)
})

test('context references reject ambiguous identities and unbounded host material', () => {
	const entry = {
		kind: 'intent' as const,
		id: crypto.randomUUID(),
		title: 'Fictional paper archive'
	}
	for (const values of [
		[entry, { ...entry, title: 'Different title for the same ID' }],
		[{ ...entry, title: '' }],
		[{ ...entry, title: 'a'.repeat(161) }],
		[{ ...entry, id: 'a'.repeat(201) }],
		Array.from({ length: 65 }, () => ({ ...entry, id: crypto.randomUUID() }))
	])
		expect(() => captureContextReferences(values)).toThrow()
	expect(captureContextReferences()).toEqual([])
})
