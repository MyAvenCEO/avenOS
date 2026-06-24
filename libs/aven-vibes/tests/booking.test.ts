import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import { getAccount, isValidKonto, SKR04_ACCOUNTS, skrForPrompt } from '../src/skr.js'
import { BOOKING_SCHEMA, buildBookingRecord } from '../src/vibes/invoice/booking.js'

// board 0069 — the SKR04 chart loads, account lookup works, and a booking validates against schema.

const ajv = new Ajv({ allErrors: true, strict: false })
const validateBooking = ajv.compile(BOOKING_SCHEMA)

const INVOICE = {
	vendor: { name: 'Cursor' },
	header: { invoice_number: 'C-1', currency: 'USD' },
	totals: { invoice_total: 100, tax_total: 0 }
}

describe('SKR04 chart + booking', () => {
	test('chart has 1598 accounts and lookups work', () => {
		expect(SKR04_ACCOUNTS.length).toBe(1598)
		const known = SKR04_ACCOUNTS[0].konto
		expect(getAccount(known)?.konto).toBe(known)
		expect(isValidKonto(known)).toBe(true)
		expect(isValidKonto('99999999')).toBe(false)
		expect(getAccount('99999999')).toBeUndefined()
		// prompt text is non-empty and one line per account
		expect(skrForPrompt().split('\n').length).toBe(1598)
	})

	test('buildBookingRecord validates + enriches from the chart (valid konten → booked)', () => {
		const soll = SKR04_ACCOUNTS.find((a) => a.konto.startsWith('6')) ?? SKR04_ACCOUNTS[0]
		const haben = SKR04_ACCOUNTS.find((a) => a.konto.startsWith('1')) ?? SKR04_ACCOUNTS[1]
		const rec = buildBookingRecord('inv-1', INVOICE, {
			soll_konto: soll.konto,
			haben_konto: haben.konto,
			net_amount: 100,
			tax_amount: 0,
			gross_amount: 100,
			tax_key: 'Reverse Charge §13b',
			buchungstext: 'Cursor Subscription',
			confidence: 'high',
			reason: 'SaaS-Abo'
		})
		expect(rec.status).toBe('booked')
		expect(rec.soll_konto).toBe(soll.konto)
		expect(rec.soll_bezeichnung).toBe(soll.bezeichnung) // filled from the chart, not the LLM
		expect(validateBooking(rec)).toBe(true)
	})

	test('an invalid soll_konto → unbooked, still schema-valid', () => {
		const rec = buildBookingRecord('inv-2', INVOICE, {
			soll_konto: '99999999',
			haben_konto: '1800',
			confidence: 'high',
			reason: 'x'
		})
		expect(rec.status).toBe('unbooked')
		expect(rec.soll_konto).toBeNull()
		expect(validateBooking(rec)).toBe(true)
	})

	test('domestic 19% VAT → the system posts an Abziehbare Vorsteuer (1406) line itself', () => {
		const six = SKR04_ACCOUNTS.filter((a) => a.konto.startsWith('6'))
		const vatInvoice = {
			vendor: { name: 'Inland GmbH' },
			header: { invoice_number: 'D-1', currency: 'EUR' },
			totals: { invoice_total: 119 }
		}
		const rec = buildBookingRecord('inv-vat', vatInvoice, {
			haben_konto: '1800',
			confidence: 'high',
			reason: 'Bürobedarf',
			lines: [{ soll_konto: six[0].konto, net_amount: 100, tax_treatment: 'vat_19' }]
		})
		expect(rec.status).toBe('booked')
		expect(rec.lines.length).toBe(2) // expense + Vorsteuer
		expect(rec.lines[0].soll_konto).toBe(six[0].konto)
		expect(rec.lines[0].gross_amount).toBe(100) // expense posts NET
		const vat = rec.lines[1]
		expect(vat.soll_konto).toBe('1406') // system-chosen Vorsteuer account
		expect(vat.tax_amount).toBe(19)
		expect(rec.net_amount).toBe(100)
		expect(rec.tax_amount).toBe(19)
		expect(rec.gross_amount).toBe(119) // net + VAT == invoice total
		expect(rec.confidence).toBe('high') // balanced
		expect(validateBooking(rec)).toBe(true)
	})

	test('mixed 19% + 7% → two expense lines + two Vorsteuer lines (1406 + 1401)', () => {
		const six = SKR04_ACCOUNTS.filter((a) => a.konto.startsWith('6'))
		const mixed = {
			vendor: { name: 'Metro' },
			header: { invoice_number: 'M-1', currency: 'EUR' },
			totals: { invoice_total: 172.5 } // 100 + 19 + 50 + 3.5
		}
		const rec = buildBookingRecord('inv-mixed', mixed, {
			haben_konto: '1800',
			confidence: 'high',
			reason: 'gemischte Steuersätze',
			lines: [
				{ soll_konto: six[0].konto, net_amount: 100, tax_treatment: 'vat_19', note: 'Papier' },
				{ soll_konto: six[1].konto, net_amount: 50, tax_treatment: 'vat_7', note: 'Bücher' }
			]
		})
		expect(rec.status).toBe('booked')
		expect(rec.is_split).toBe(true)
		expect(rec.lines.length).toBe(4)
		const vatKonten = rec.lines.map((l) => l.soll_konto)
		expect(vatKonten).toContain('1406')
		expect(vatKonten).toContain('1401')
		expect(rec.net_amount).toBe(150)
		expect(rec.tax_amount).toBe(22.5)
		expect(rec.gross_amount).toBe(172.5)
		expect(validateBooking(rec)).toBe(true)
	})

	test('Bewirtung (restaurant) → §4 Abs.5 70/30 split (6640 + 6644) + full Vorsteuer', () => {
		const restaurant = {
			vendor: { name: "Pogner's Restaurant" },
			header: { invoice_number: '66493', currency: 'EUR' },
			totals: { invoice_total: 115.6 }
		}
		const rec = buildBookingRecord('inv-bew', restaurant, {
			haben_konto: '1800',
			confidence: 'high',
			reason: 'Bewirtung',
			lines: [
				{
					soll_konto: '6640',
					net_amount: 97.14,
					tax_amount: 18.46,
					tax_treatment: 'vat_19',
					cost_treatment: 'bewirtung'
				}
			]
		})
		expect(rec.status).toBe('booked')
		const konten = rec.lines.map((l) => l.soll_konto)
		expect(konten).toContain('6640') // 70% abziehbar
		expect(konten).toContain('6644') // 30% nicht abziehbar
		expect(konten).toContain('1406') // full Vorsteuer
		expect(rec.lines.find((l) => l.soll_konto === '6640')?.gross_amount).toBe(68)
		expect(rec.lines.find((l) => l.soll_konto === '6644')?.gross_amount).toBe(29.14)
		expect(rec.gross_amount).toBe(115.6) // balances to the invoice total
		expect(validateBooking(rec)).toBe(true)
	})

	test('reverse charge §13b → NO Vorsteuer line, books at net', () => {
		const six = SKR04_ACCOUNTS.filter((a) => a.konto.startsWith('6'))
		const rc = {
			vendor: { name: 'Cursor' },
			header: { invoice_number: 'C-9', currency: 'EUR' },
			totals: { invoice_total: 86.5 }
		}
		const rec = buildBookingRecord('inv-rc', rc, {
			haben_konto: '1800',
			confidence: 'high',
			reason: 'SaaS §13b',
			lines: [{ soll_konto: six[0].konto, net_amount: 86.5, tax_treatment: 'reverse_charge' }]
		})
		expect(rec.status).toBe('booked')
		expect(rec.lines.length).toBe(1) // no VAT line
		expect(rec.tax_amount).toBeNull()
		expect(rec.gross_amount).toBe(86.5)
		expect(validateBooking(rec)).toBe(true)
	})
})
