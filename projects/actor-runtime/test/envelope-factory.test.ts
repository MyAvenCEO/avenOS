import { expect, test } from 'bun:test'

import { makeEnvelope } from '../src/envelope-factory'

test('makeEnvelope maps actor fields and preserves explicit ids', () => {
	const availableAt = new Date('2026-05-12T00:00:00.000Z')
	const envelope = makeEnvelope({
		from: 'actor/source',
		to: 'actor/target',
		type: 'demo',
		payload: { ok: true },
		correlationId: 'corr-1',
		causationId: 'cause-1',
		availableAt
	})

	expect(envelope.id).toBeString()
	expect(envelope.fromActor).toBe('actor/source')
	expect(envelope.toActor).toBe('actor/target')
	expect(envelope.type).toBe('demo')
	expect(envelope.payload).toEqual({ ok: true })
	expect(envelope.correlationId).toBe('corr-1')
	expect(envelope.causationId).toBe('cause-1')
	expect(envelope.availableAt).toBe(availableAt)
})

test('makeEnvelope generates ids when omitted', () => {
	const envelope = makeEnvelope({
		from: 'actor/source',
		to: 'actor/target',
		type: 'demo',
		payload: null
	})

	expect(envelope.id).toBeString()
	expect(envelope.correlationId).toBeString()
	if (typeof envelope.id === 'string' && typeof envelope.correlationId === 'string') {
		expect(envelope.id.length).toBeGreaterThan(0)
		expect(envelope.correlationId.length).toBeGreaterThan(0)
	}
})