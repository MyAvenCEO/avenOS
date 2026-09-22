import { expect, test } from 'bun:test'
import { capturePriorActions } from '@avenos/chat-engine/prior-actions'
import { type QueuedInput, waitingInputs } from '@avenos/chat-engine/queued-inputs'
import { ResearchRecord } from '@avenos/chat-engine/research'

const receipt = {
	turnId: 'earlier-turn',
	runId: 'earlier-run',
	invocationId: 'old-invocation',
	ordinal: 1,
	name: 'todo_create',
	arguments: '{"title":"Sort costume buttons"}',
	result: '{"ok":true,"task":{"id":"existing-task","title":"Sort costume buttons","revision":1}}'
}

test('prior committed actions are copied whole, distinct from current calls and available to review and repair', () => {
	const captured = capturePriorActions([receipt])
	expect(captured).toEqual([receipt])
	expect(captured[0]).not.toBe(receipt)
	const record = new ResearchRecord([], [], [], [], undefined, { priorActions: captured })
	expect(record.needsReview).toBe(true)
	for (const messages of [
		record.verifierMessages('Edit that request', 'Updated'),
		record.answerRepairMessages('Edit that request', ['Report the prior effect accurately'])
	]) {
		expect(messages[0].content).toContain('Those actions already happened')
		const data = JSON.parse(messages[1].content)
		expect(data.priorActions).toEqual([receipt])
		expect(data.toolOutcomes).toEqual([])
		expect(data.priorToolOutcomes.observations).toEqual([])
	}
	expect(record.observedTools.size).toBe(0)
})

test('invalid, duplicate or oversized replacement receipts fail rather than silently losing old effects', () => {
	for (const receipts of [
		[receipt, receipt],
		[{ ...receipt, ordinal: -1 }],
		[{ ...receipt, result: '€'.repeat(100_000) }],
		Array.from({ length: 65 }, (_, n) => ({ ...receipt, invocationId: `invocation-${n}` }))
	])
		expect(() => capturePriorActions(receipts)).toThrow()
	expect(capturePriorActions()).toEqual([])
})

test('replacement actions cannot be coalesced into another queued message', () => {
	const first: QueuedInput = {
		session: 's',
		context: '',
		calls: [],
		claimed: false,
		user: { id: 'user-1', role: 'user', content: 'Edit my request' },
		priorActions: [receipt]
	}
	const next = { ...first, user: { ...first.user, id: 'user-2', content: 'Another request' } }
	expect(waitingInputs([first, next])).toEqual([first])
	expect(waitingInputs([{ ...first, priorActions: [] }, next])).toHaveLength(1)
})
