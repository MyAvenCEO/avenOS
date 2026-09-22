import { expect, test } from 'bun:test'
import {
	type OpenItem,
	rankInvoiceTransactions,
	type StatementTransaction
} from '@avenos/document-ingest'
import { shouldSuggestReconciliation } from '../src/lib/artifacts/reconciliation-review'

const invoice: OpenItem = {
	businessKey: 'cedar-1234',
	businessKeyBasis: 'supplier-invoice-number',
	documentKind: 'invoice',
	direction: 'payable',
	supplierName: 'Cedar Services',
	supplierIbans: [],
	invoiceNumber: 'CD-1234',
	orderNumber: null,
	issueDate: '2026-07-22',
	dueDate: null,
	currency: 'EUR',
	grossMinor: 10026,
	amountDueMinor: 10026,
	amountPaidMinor: null,
	references: ['CD-1234'],
	validationStatus: 'consistent',
	summary: 'Fictional software invoice'
}
const booking: StatementTransaction = {
	dedupKey: 'tx-1',
	dedupBasis: 'provider-id',
	accountRef: 'fictional',
	providerTransactionId: 'tx-1',
	bookingDate: '2026-07-22',
	valueDate: null,
	title: 'Newsletter',
	amountMinor: -1500,
	currency: 'EUR',
	counterpartyName: 'Other Company',
	counterpartyIban: null,
	description: 'Subscription',
	originalAmountMinor: null,
	originalCurrency: null,
	exchangeRate: null,
	fxSurchargeMinor: null,
	foreignExchangeFeeBps: null,
	balanceAfterMinor: null,
	sourceRow: null,
	sourceOrdinal: 0,
	statementValidationStatus: 'consistent',
	statementCoverage: 'verified'
}
const candidate = (fields: Partial<StatementTransaction> = {}) =>
	rankInvoiceTransactions(invoice, [{ ...booking, ...fields }])[0]!

test('a top-ranked unrelated booking remains inspectable but does not create unsolicited review', () => {
	const match = candidate()
	expect(match.rank).toBe(1)
	expect(match.rankScore).toBeGreaterThan(0) // Same date and debit are not sufficient.
	expect(shouldSuggestReconciliation(match)).toBe(false)
})

test('positive invoice/payment evidence may request review, but never accepts a relationship', () => {
	for (const fields of [
		{ counterpartyName: 'Cedar Services' },
		{ description: 'CD-1234' },
		{ amountMinor: -10026 }
	])
		expect(shouldSuggestReconciliation(candidate(fields))).toBe(true)
	expect(shouldSuggestReconciliation(candidate({ amountMinor: 10026 }))).toBe(false)
	expect(
		shouldSuggestReconciliation({ ...candidate({ amountMinor: -10026 }), recommendation: 'reject' })
	).toBe(false)
})
