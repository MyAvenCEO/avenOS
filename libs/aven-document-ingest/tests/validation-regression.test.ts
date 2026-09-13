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

test('invoice line reconciliation detects extra or missing rows and preserves honest uncertainty', async () => {
	const actor = createInvoiceValidatorActor(),
		bus = new MessageBus()
	bus.register(actor)
	try {
		for (const [amounts, net, expected, outcome] of [
			[[100, 100, 100], 300, 'consistent', 'PASS'],
			[[100, 100, 100, 100], 300, 'insufficient-coverage', 'FAIL'],
			[[100, 100], 300, 'insufficient-coverage', 'FAIL'],
			[[-100, -200], -300, 'consistent', 'PASS'],
			[[100, 200, -25], 275, 'consistent', 'PASS'],
			[[100, 200, 25], 325, 'consistent', 'PASS'],
			[[100, 200], 302, 'consistent', 'PASS'],
			[[100, 200], 275, 'insufficient-coverage', 'FAIL'],
			[[100, null], 300, 'insufficient-coverage', 'UNKNOWN'],
			[[], 300, 'insufficient-coverage', 'UNKNOWN'],
			[[0], 0, 'consistent', 'PASS'],
			[
				[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
				Number.MAX_SAFE_INTEGER,
				'insufficient-coverage',
				'FAIL'
			]
		] as const) {
			const response = await bus.dispatch('test', 'document_validate_invoice', {
				candidate: {
					supplier: 'Shop',
					invoiceNumber: 'I-1',
					netMinor: net,
					taxMinor: 0,
					grossMinor: net
				},
				details: { lineItems: amounts.map((netMinor) => ({ netMinor })) }
			})
			const result = parseDocumentActorResult(response.record)
			expect(result.artifacts[0]?.payload.status).toBe(expected)
			expect(result.artifacts[0]?.payload).toMatchObject({
				rulesetVersion: 'invoice-core-v2',
				checks: expect.arrayContaining([
					{
						ruleId: 'invoice.line-net-equals-net',
						outcome,
						severity: 'warning',
						paths: expect.any(Array),
						message: expect.any(String)
					}
				])
			})
			expect(result.evidence).toEqual(
				expect.arrayContaining([expect.objectContaining({ inputRole: 'details' })])
			)
		}
	} finally {
		actor.dispose()
	}
})
