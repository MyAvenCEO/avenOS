import { expect, test } from 'bun:test'
import { currentTimeContext } from '@avenos/chat-engine/current-time'
import { ResearchRecord } from '@avenos/chat-engine/research'

test('local date, UTC time and named timezone stay distinct around midnight', () => {
	const date = new Date('2026-09-17T22:30:00Z')
	expect(currentTimeContext(date, 'Europe/Berlin')).toContain(
		'2026-09-18 00:30:00 GMT+02:00; Friday; timezone Europe/Berlin'
	)
	expect(currentTimeContext(date, 'Europe/Berlin')).toContain('UTC: 2026-09-17T22:30:00.000Z')
	expect(currentTimeContext(date, 'America/New_York')).toContain('2026-09-17 18:30:00 GMT-04:00')
})
test('daylight saving transitions use the offset at the supplied instant', () => {
	expect(currentTimeContext(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin')).toContain(
		'01:30:00 GMT+01:00'
	)
	expect(currentTimeContext(new Date('2026-03-29T01:30:00Z'), 'Europe/Berlin')).toContain(
		'03:30:00 GMT+02:00'
	)
})
test('independent verification and answer repair also receive fresh trusted time', () => {
	const record = new ResearchRecord()
	for (const messages of [
		record.verifierMessages('When?', 'Yesterday'),
		record.answerRepairMessages('When?', ['Check the date'])
	]) {
		expect(messages[0]!.content).toContain('CURRENT DEVICE TIME')
		expect(messages[0]!.content).toContain(new Date().toISOString().slice(0, 10))
		expect(messages[0]!.content).toContain('Source dates remain historical facts')
	}
})
