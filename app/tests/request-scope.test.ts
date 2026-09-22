import { expect, test } from 'bun:test'
import { ResearchRecord } from '@avenos/chat-engine/research'

test('answer review retains Intent creation receipts rather than requesting the action again', () => {
	const record = new ResearchRecord()
	record.observe(
		'intent_create',
		JSON.stringify({ ok: true, created: 'fictional-intent', persistent: true }),
		JSON.stringify({ title: 'Rechnungen recherchieren' })
	)
	expect(record.needsReview).toBe(true)
	expect(record.toolOutcomes).toMatchObject([
		{
			name: 'intent_create',
			receipt: { created: 'fictional-intent', persistent: true },
			request: { title: 'Rechnungen recherchieren' }
		}
	])
	const messages = record.verifierMessages(
		'Mach einen neuen Intent auf. Ich möchte eine fiktive Dachterrasse planen.',
		'Ist geöffnet. Was möchtest du herausfinden?'
	)
	expect(messages[0].content).toContain('A topic is not yet a task')
	expect(messages[1].content).toContain('fictional-intent')
})
