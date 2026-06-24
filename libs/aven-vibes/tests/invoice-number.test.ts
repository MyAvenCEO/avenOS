import { describe, expect, test } from 'bun:test'
import {
	assignInvoiceNumber,
	invoiceNumber,
	nextSeq,
	parseInvoiceNumber
} from '../src/invoice-number.js'

// board 0082 — numbering: {R,A,E}-<contactId>-<seq>, per-(prefix, contact) gapless running sequence.

const A = 'WAIZMAN1' // 8-char base32 ids
const B = 'MUELLER2'

describe('invoice numbering', () => {
	test('invoiceNumber format — 4-digit zero-padded counter', () => {
		expect(invoiceNumber('rechnung', A, 1)).toBe('R-WAIZMAN1-0001')
		expect(invoiceNumber('angebot', A, 12)).toBe('A-WAIZMAN1-0012')
		expect(invoiceNumber('entwurf', B, 100)).toBe('E-MUELLER2-0100')
		expect(invoiceNumber('rechnung', A, 12345)).toBe('R-WAIZMAN1-12345') // ≥4 digits, not truncated
	})

	test('parseInvoiceNumber round-trips', () => {
		expect(parseInvoiceNumber('R-WAIZMAN1-7')).toEqual({ prefix: 'R', shortId: A, seq: 7 })
		expect(parseInvoiceNumber('garbage')).toBeNull()
		expect(parseInvoiceNumber('R-short-1')).toBeNull()
	})

	test('nextSeq is max+1 per (prefix, contact), starting at 1', () => {
		expect(nextSeq([], 'rechnung', A)).toBe(1)
		expect(nextSeq(['R-WAIZMAN1-1', 'R-WAIZMAN1-2'], 'rechnung', A)).toBe(3)
		// other contact's / other state's numbers don't affect this series
		expect(nextSeq(['R-MUELLER2-9', 'A-WAIZMAN1-4'], 'rechnung', A)).toBe(1)
	})

	test('two contacts keep independent gapless series; numbers are unique', () => {
		const issued: string[] = []
		issued.push(assignInvoiceNumber(issued, 'rechnung', A)) // R-A-0001
		issued.push(assignInvoiceNumber(issued, 'rechnung', B)) // R-B-0001
		issued.push(assignInvoiceNumber(issued, 'rechnung', A)) // R-A-0002
		expect(issued).toEqual(['R-WAIZMAN1-0001', 'R-MUELLER2-0001', 'R-WAIZMAN1-0002'])
		expect(new Set(issued).size).toBe(issued.length) // all unique
	})
})
