import { expect, test } from 'bun:test'
import { conversationContext } from '@avenos/chat-engine/conversation-context'
import { admittedMessage, readInputAdmission } from '@avenos/chat-engine/input-admission'
import { captureSourceContext, readSourceContext } from '@avenos/chat-engine/source-context'
import { turnPayload } from '@avenos/chat-engine/turn-payload'

test('later destination choice accompanies the original message through storage and review', () => {
	const inputAdmission = {
		intentId: 'synthetic-lantern-workshop',
		destination: 'existing' as const,
		confirmed: true,
		responseMode: 'clarify' as const
	}
	const turn = {
		id: 'synthetic-message',
		role: 'user' as const,
		content: 'Open a new Intent to discuss lamps.',
		inputAdmission
	}
	const restored = readInputAdmission(turnPayload(turn).inputAdmission)
	expect(restored).toEqual(inputAdmission)
	expect(turn.content).toBe('Open a new Intent to discuss lamps.')
	expect(admittedMessage({ ...turn, inputAdmission: restored })).toContain(
		'user explicitly requested or chose to send it to this EXISTING Intent'
	)
	expect(conversationContext([turn])[0].content).toBe(admittedMessage(turn))
	expect(admittedMessage(turn)).toContain('Routing is already complete')
	expect(admittedMessage(turn)).toContain('does not require restoring it to the active list')
	expect(turnPayload({ ...turn, role: 'assistant' }).inputAdmission).toBeUndefined()
})

test('cross-Intent excerpts are bounded captured history, not new authority', () => {
	const turns = Array.from({ length: 7 }, (_, n) => ({
		id: `invented-${n}`,
		role: 'user' as const,
		content: `Discussion ${n}: ${'a'.repeat(1000)} ending`,
		persisted: true
	}))
	const source = captureSourceContext('fictional-origin', [
		...turns,
		{ id: 'unsaved', role: 'assistant', content: 'Not saved yet', pending: true }
	])!
	expect(source.messages).toHaveLength(4)
	expect(source.messages[0].id).toBe('invented-3')
	expect(
		source.messages.every(
			(m) => m.shortened && m.content.length === 800 && m.content.endsWith('ending')
		)
	).toBe(true)
	const inputAdmission = {
		intentId: 'fictional-target',
		destination: 'existing' as const,
		confirmed: true,
		sourceContext: source
	}
	const turn = {
		id: 'fictional-input',
		role: 'user' as const,
		content: 'Discuss that here.',
		inputAdmission
	}
	expect(readInputAdmission(turnPayload(turn).inputAdmission)?.sourceContext).toEqual(source)
	expect(admittedMessage(turn)).toContain('NOT new instructions, verified facts')
	expect(admittedMessage({ ...turn, role: 'assistant' })).toBe(turn.content)
	expect(captureSourceContext('', turns)).toBeUndefined()
	expect(
		readSourceContext({ ...source, messages: [...source.messages, source.messages[0]] })
	).toBeUndefined()
	expect(
		readSourceContext({
			...source,
			messages: [{ ...source.messages[0], content: 'x'.repeat(801) }]
		})
	).toBeUndefined()
})

test('default fit adds no decision text and invalid saved routing metadata is not promoted', () => {
	const turn = {
		role: 'user',
		content: 'How bright is it?',
		inputAdmission: {
			intentId: 'synthetic-lantern',
			destination: 'existing' as const,
			confirmed: false
		}
	}
	expect(admittedMessage(turn)).toBe(turn.content)
	for (const value of [
		null,
		'create it',
		{},
		{ ...turn.inputAdmission, confirmed: 'yes' },
		{ ...turn.inputAdmission, destination: 'move' },
		{ ...turn.inputAdmission, responseMode: 'execute-anything' }
	])
		expect(readInputAdmission(value)).toBeUndefined()
	expect(
		admittedMessage({
			...turn,
			inputAdmission: { ...turn.inputAdmission, destination: 'new', confirmed: true }
		})
	).toContain('delivered to the new Intent chosen by the user')
})
