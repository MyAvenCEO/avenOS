import { describe, expect, test } from 'bun:test'
import { computeInvoiceTotals, requiredFieldsMissing } from '../src/vibes/invoice/invoice-doc.js'
import type { InvoiceDoc } from '../src/vibes/invoice/invoice-doc.js'

// board 0082 — VAT auto-calculation per rate + §14-UStG required-field check.

describe('invoice totals', () => {
	test('mixed 19% + 7% → per-rate net/vat + grand net/vat/gross', () => {
		const t = computeInvoiceTotals([
			{ description: 'Beratung', quantity: 1, unit_price: 100, vat_rate: 19 },
			{ description: 'Buch', quantity: 1, unit_price: 50, vat_rate: 7 }
		])
		expect(t.by_rate).toEqual([
			{ rate: 19, net: 100, vat: 19 },
			{ rate: 7, net: 50, vat: 3.5 }
		])
		expect(t.net_total).toBe(150)
		expect(t.vat_total).toBe(22.5)
		expect(t.gross_total).toBe(172.5)
	})

	test('quantities multiply and same-rate lines aggregate', () => {
		const t = computeInvoiceTotals([
			{ description: 'Stunde', quantity: 3, unit_price: 90, vat_rate: 19 },
			{ description: 'Pauschale', quantity: 1, unit_price: 30, vat_rate: 19 }
		])
		expect(t.by_rate).toEqual([{ rate: 19, net: 300, vat: 57 }])
		expect(t.gross_total).toBe(357)
	})

	test('requiredFieldsMissing flags an incomplete invoice (§14 UStG)', () => {
		const doc = {
			number: 'R-WAIZMAN1-1',
			state: 'rechnung',
			version: 1,
			seller: { name: 'Meine GmbH', street: 'Weg 1', city: 'Berlin', vat_id: 'DE123' },
			buyer: { name: null, street: null, city: null, vat_id: null },
			issue_date: '2026-01-10',
			lines: []
		} as unknown as InvoiceDoc
		const missing = requiredFieldsMissing(doc)
		expect(missing.some((m) => m.includes('Empfängers'))).toBe(true) // buyer name/address
		expect(missing.some((m) => m.includes('Position'))).toBe(true) // no line items
		// a complete invoice has nothing missing
		const complete = {
			...doc,
			buyer: { name: 'Kunde AG', street: 'Str 2', city: 'Köln', vat_id: 'DE9' },
			lines: [{ description: 'X', quantity: 1, unit_price: 10, vat_rate: 19 }]
		} as unknown as InvoiceDoc
		expect(requiredFieldsMissing(complete)).toEqual([])
	})
})
