import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import type { TxRecord } from '../src/vibes/bank-statement/tx.js'
import { bestInvoiceMatch, buildMatchRecord, MATCH_SCHEMA } from '../src/vibes/invoice/match.js'

// board 0066 — invoice ↔ tx reconciliation: amount-required match, counterparty raises confidence,
// no amount match → null, and the persisted record validates against MATCH_SCHEMA.

const ajv = new Ajv({ allErrors: true, strict: false })
const validateMatch = ajv.compile(MATCH_SCHEMA)

const INVOICE = {
	vendor: { name: 'Hetzner Online GmbH' },
	header: { invoice_number: 'R-100', currency: 'EUR' },
	totals: { invoice_total: 42.5 }
}

function tx(p: Partial<TxRecord>): TxRecord {
	return {
		dedup_key: p.dedup_key ?? 'k',
		booking_date: p.booking_date ?? null,
		value_date: p.value_date ?? null,
		amount: p.amount ?? null,
		currency: p.currency ?? 'EUR',
		original_amount: p.original_amount ?? null,
		original_currency: p.original_currency ?? null,
		exchange_rate: p.exchange_rate ?? null,
		description: p.description ?? null,
		counterparty_name: p.counterparty_name ?? null,
		counterparty_iban: p.counterparty_iban ?? null,
		balance_after: p.balance_after ?? null,
		account_iban: p.account_iban ?? null,
		statement_id: p.statement_id ?? null,
		source_value_id: p.source_value_id ?? null
	}
}

describe('invoice ↔ tx matching', () => {
	test('matches on amount; counterparty overlap → high confidence', () => {
		const txs = [
			tx({ dedup_key: 'a', amount: -10, description: 'Rewe' }),
			tx({
				dedup_key: 'b',
				amount: -42.5,
				counterparty_name: 'Hetzner Online GmbH',
				booking_date: '2026-04-22'
			})
		]
		const m = bestInvoiceMatch(INVOICE, txs)
		expect(m).not.toBeNull()
		expect(m?.tx.dedup_key).toBe('b')
		expect(m?.confidence).toBe('high')
	})

	test('amount-only match → medium confidence', () => {
		const txs = [tx({ dedup_key: 'c', amount: -42.5, description: 'SEPA Lastschrift' })]
		const m = bestInvoiceMatch(INVOICE, txs)
		expect(m?.dedup_key === undefined)
		expect(m?.confidence).toBe('medium')
	})

	test('cross-currency: USD invoice matches a EUR debit via original_amount', () => {
		const usdInvoice = {
			vendor: { name: 'Cursor' },
			header: { invoice_number: 'C-1', currency: 'USD' },
			totals: { invoice_total: 464.1 }
		}
		const txs = [
			// EUR debit of 428.50, but the original USD charge was 464.10 → must match
			tx({
				dedup_key: 'fx',
				amount: -428.5,
				currency: 'EUR',
				original_amount: -464.1,
				original_currency: 'USD',
				counterparty_name: 'Cursor'
			})
		]
		const m = bestInvoiceMatch(usdInvoice, txs)
		expect(m?.tx.dedup_key).toBe('fx')
	})

	test('no amount match → null', () => {
		const txs = [tx({ dedup_key: 'd', amount: -99.99, counterparty_name: 'Hetzner Online GmbH' })]
		expect(bestInvoiceMatch(INVOICE, txs)).toBeNull()
	})

	test('buildMatchRecord validates against MATCH_SCHEMA (matched + unmatched)', () => {
		const matched = buildMatchRecord(
			'inv-1',
			INVOICE,
			bestInvoiceMatch(INVOICE, [
				tx({ dedup_key: 'b', amount: -42.5, counterparty_name: 'Hetzner' })
			])
		)
		expect(matched.status).toBe('matched')
		expect(validateMatch(matched)).toBe(true)

		const unmatched = buildMatchRecord('inv-2', INVOICE, null)
		expect(unmatched.status).toBe('unmatched')
		expect(validateMatch(unmatched)).toBe(true)
	})
})
