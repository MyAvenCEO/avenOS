import { expect, test } from 'bun:test'
import { type QueuedInput, waitingInputs } from '@avenos/chat-engine/queued-inputs'
import { responseInputsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'

const input = (patch: Partial<QueuedInput> = {}): QueuedInput => ({
	session: 'garden',
	context: 'A synthetic community garden',
	calls: [],
	claimed: false,
	user: {
		id: crypto.randomUUID(),
		role: 'user',
		content: 'An independently invented contribution'
	},
	...patch
})

test('takes only the waiting prefix, preserving original messages and identity', () => {
	const running = input({ claimed: true }),
		first = input(),
		second = input()
	const batch = waitingInputs([running, first, second])
	expect(batch).toEqual([first, second])
	expect(batch[0]).toBe(first)
	expect(first.claimed).toBe(false) // selection is pure; the host claims synchronously
	for (const boundary of [
		input({ session: 'workshop' }),
		input({ context: 'Changed host context' }),
		input({
			contextReferences: [{ kind: 'intent', id: 'paper-workshop', title: 'Paper workshop' }]
		}),
		input({
			user: {
				...first.user,
				inputAdmission: { intentId: 'other', destination: 'existing', confirmed: true }
			}
		}),
		input({
			user: {
				...first.user,
				anonymousSpeaker: { session_id: 'room', speaker_id: 'guest', confidence: 0.9 }
			}
		})
	])
		expect(waitingInputs([running, first, boundary, second])).toEqual([first])
})

test('bounds the group without dropping or starving an oversized first contribution', () => {
	const many = Array.from({ length: 20 }, () => input())
	expect(waitingInputs(many)).toEqual(many.slice(0, 16))
	const long = input({ user: { id: 'long', role: 'user', content: 'x'.repeat(32_000) } })
	expect(waitingInputs([long, ...many])).toEqual([long])
	long.user.content += 'x'
	expect(waitingInputs([long, ...many])).toEqual([long])
	long.claimed = true
	expect(waitingInputs([long, ...many])).toEqual(many.slice(0, 16))
})

test('answer association round trips without accepting malformed or user-authored metadata', () => {
	const reply = {
		id: 'answer',
		role: 'assistant' as const,
		content: 'Answer',
		inReplyTo: ['first', 'second']
	}
	expect(responseInputsFromPayload(turnPayload(reply))).toEqual(['first', 'second'])
	expect(turnPayload({ ...reply, role: 'user' }).inReplyTo).toBeUndefined()
	for (const invalid of [
		[],
		['same', 'same'],
		[12],
		[''],
		['x'.repeat(161)],
		Array.from({ length: 17 }, (_, i) => String(i))
	]) {
		expect(responseInputsFromPayload({ inReplyTo: invalid })).toBeUndefined()
		expect(turnPayload({ ...reply, inReplyTo: invalid as string[] })).not.toHaveProperty(
			'inReplyTo'
		)
	}
})
