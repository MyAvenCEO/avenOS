import { MessageBus } from '@avenos/actors'
import { expect, test } from 'vitest'
import { createInvoiceValidatorActor } from '../src/actors/invoice-validator'
import { parseDocumentActorResult } from '../src/results'

test('known arithmetic disagreement is inconsistent while absent amounts remain unknown', async () => {
	const actor = createInvoiceValidatorActor(),
		bus = new MessageBus()
	bus.register(actor)
	try {
		expect(actor.handles('toString')).toBe(false)
		for (const [taxMinor, status] of [
			[1900, 'inconsistent'],
			[null, 'insufficient-coverage']
		] as const) {
			const result = await bus.dispatch('test', 'document_validate_invoice', {
				candidate: {
					supplier: 'Shop',
					invoiceNumber: 'I-1',
					netMinor: 10000,
					taxMinor,
					grossMinor: 190000
				}
			})
			expect(parseDocumentActorResult(result.record).artifacts[0]?.payload.status).toBe(status)
		}
	} finally {
		actor.dispose()
	}
})
