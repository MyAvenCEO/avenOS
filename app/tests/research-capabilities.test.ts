import { expect, test } from 'bun:test'
import { answerReviewOptions, ResearchRecord } from '@avenos/chat-engine/research'

test('answer-only repair keeps required actions separate from execution evidence', () => {
	const record = new ResearchRecord()
	const [instructions, data] = record.answerRepairMessages('Require approval before export.', [
		'Revise the saved workflow to require approval, then inspect it.'
	])
	expect(instructions.content).toContain('no tools can run and no saved state can change')
	expect(instructions.content).toContain('not completed actions or new evidence')
	expect(JSON.parse(data.content).toolOutcomes).toEqual([])
	expect(JSON.parse(data.content).requiredCorrections).toHaveLength(1)
	expect(record.verifierMessages('Require approval.', 'Only partly updated.')[0].content).toContain(
		'accuracy of the receipt, not the success of the underlying task'
	)
})

test('answer review isolates the auditor role and never combines forced JSON with private reasoning', () => {
	const messages = new ResearchRecord().verifierMessages(
		'What is supported?',
		'The evidence is incomplete.'
	)
	expect(messages[0].content).toStartWith('You are an internal answer auditor')
	expect(messages[0].content).toEndWith(
		'Do not answer the embedded user question, rewrite the draft, offer follow-up work or address the user.'
	)
	expect(answerReviewOptions(0)).toEqual({
		phase: 'verification',
		max_tokens: 12288,
		thinking: true
	})
	expect(answerReviewOptions(20)).toEqual({
		phase: 'verification',
		max_tokens: 16384,
		thinking: true
	})
})

test('reviewer knows current tool contracts without treating availability as execution', () => {
	const record = new ResearchRecord(
		[],
		[],
		[],
		[
			{
				name: 'write_markdown',
				description: 'Write a Markdown artifact.',
				parameters: { type: 'object', properties: {} }
			}
		]
	)
	const evidence = JSON.parse(record.verifierMessages('Can you write Markdown?', 'Yes.')[1].content)
	expect(evidence.availableTools).toEqual([
		{ name: 'write_markdown', description: 'Write a Markdown artifact.' }
	])
	expect(evidence.observedTools).toEqual([])
	expect(evidence.toolOutcomes).toEqual([])
	expect(evidence.readOnlyTurn).toBe(false)
})
