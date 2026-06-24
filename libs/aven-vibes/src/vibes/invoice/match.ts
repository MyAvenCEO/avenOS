import { kvList, rec, section, str } from '../_doc/map.js'
import type { DocView } from '../_doc/types.js'
import type { TxRecord } from '../bank-statement/tx.js'

// board 0066 — reconcile an extracted INVOICE against the user's stored `tx` records: find the
// transaction that paid it. Amount is required (|tx.amount| ≈ invoice gross total, within a cent);
// counterparty-name overlap + outgoing sign raise confidence. Pure (no DOM): the server queries
// the tx table and calls this.

export type MatchConfidence = 'high' | 'medium' | 'none'

export type InvoiceMatch = {
	tx: TxRecord
	confidence: MatchConfidence
	reasons: string[]
	target: number
}

/** The gross amount an invoice should be paid for (used as the match target). */
export function invoiceTotal(invoice: unknown): number | null {
	const d = rec(invoice)
	const t = rec(d.totals)
	const cand = [t.invoice_total, d.total_outstanding, t.gross_total]
	for (const c of cand) {
		if (typeof c === 'number' && Number.isFinite(c)) return Math.abs(c)
	}
	return null
}

/** The vendor (counterparty) name on an invoice. */
export function invoiceVendor(invoice: unknown): string {
	return str(rec(rec(invoice).vendor).name)
}

function tokens(s: string): string[] {
	return s
		.toLowerCase()
		.replace(/[.,;:/\\()-]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length >= 3 && !['gmbh', 'inc', 'llc', 'ltd', 'ag', 'und', 'the'].includes(w))
}

/** Does the vendor name overlap the transaction's counterparty / description text? */
function counterpartyOverlap(vendor: string, tx: TxRecord): boolean {
	const vt = tokens(vendor)
	if (vt.length === 0) return false
	const hay = `${tx.counterparty_name ?? ''} ${tx.description ?? ''}`.toLowerCase()
	return vt.some((w) => hay.includes(w))
}

/**
 * Best transaction that pays this invoice, or null. Amount match (within €0.01) is mandatory;
 * among amount matches, prefer counterparty overlap, then an outgoing (negative) debit.
 */
export function bestInvoiceMatch(invoice: unknown, txs: TxRecord[]): InvoiceMatch | null {
	const target = invoiceTotal(invoice)
	if (target == null) return null
	const vendor = invoiceVendor(invoice)

	let best: InvoiceMatch | null = null
	let bestScore = -1
	for (const tx of txs) {
		// Amount is mandatory, but currency-aware: match the booked amount (same currency) OR the
		// FX original_amount (e.g. a USD invoice paid as a EUR debit carries the USD original_amount).
		const bookedMatch =
			typeof tx.amount === 'number' && Math.abs(Math.abs(tx.amount) - target) <= 0.01
		const fxMatch =
			typeof tx.original_amount === 'number' &&
			Math.abs(Math.abs(tx.original_amount) - target) <= 0.01
		if (!bookedMatch && !fxMatch) continue
		const reasons = [
			fxMatch && !bookedMatch
				? `Betrag ${target.toFixed(2)} (${tx.original_currency ?? 'Fremdwährung'}) stimmt überein`
				: `Betrag ${target.toFixed(2)} stimmt überein`
		]
		const cp = counterpartyOverlap(vendor, tx)
		if (cp) reasons.push(`Gegenpartei „${vendor}" erkannt`)
		const outgoing = typeof tx.amount === 'number' && tx.amount < 0
		if (outgoing) reasons.push('Ausgehende Zahlung')
		const score = 2 + (cp ? 2 : 0) + (outgoing ? 1 : 0)
		const confidence: MatchConfidence = cp ? 'high' : 'medium'
		if (score > bestScore) {
			bestScore = score
			best = { tx, confidence, reasons, target }
		}
	}
	return best
}

/** The JSON Schema registered as the user's `match` schema (invoice ↔ tx reconciliation rows). */
export const MATCH_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['invoice_value_id', 'status'],
	properties: {
		invoice_value_id: { type: ['string', 'null'], description: 'data_value id of the invoice.' },
		invoice_number: { type: ['string', 'null'] },
		invoice_total: { type: ['number', 'null'] },
		currency: { type: ['string', 'null'] },
		vendor: { type: ['string', 'null'] },
		tx_dedup_key: {
			type: ['string', 'null'],
			description: 'dedup_key of the matched transaction.'
		},
		tx_amount: { type: ['number', 'null'] },
		tx_date: { type: ['string', 'null'] },
		tx_counterparty: { type: ['string', 'null'] },
		confidence: { type: 'string', enum: ['high', 'medium', 'none'] },
		reasons: { type: 'array', items: { type: 'string' } },
		status: { type: 'string', enum: ['matched', 'unmatched'] }
	}
} as const

export type MatchRecord = {
	invoice_value_id: string | null
	invoice_number: string | null
	invoice_total: number | null
	currency: string | null
	vendor: string | null
	tx_dedup_key: string | null
	tx_amount: number | null
	tx_date: string | null
	tx_counterparty: string | null
	confidence: MatchConfidence
	reasons: string[]
	status: 'matched' | 'unmatched'
}

/** Build the persisted reconciliation record (idempotency key = invoice_value_id + tx_dedup_key). */
export function buildMatchRecord(
	invoiceValueId: string | null,
	invoice: unknown,
	match: InvoiceMatch | null
): MatchRecord {
	const d = rec(invoice)
	const h = rec(d.header)
	return {
		invoice_value_id: invoiceValueId,
		invoice_number: str(h.invoice_number) || null,
		invoice_total: invoiceTotal(invoice),
		currency: str(h.currency) || null,
		vendor: invoiceVendor(invoice) || null,
		tx_dedup_key: match?.tx.dedup_key ?? null,
		tx_amount: match?.tx.amount ?? null,
		tx_date: match ? (match.tx.booking_date ?? match.tx.value_date) : null,
		tx_counterparty: match?.tx.counterparty_name ?? null,
		confidence: match?.confidence ?? 'none',
		reasons: match?.reasons ?? [],
		status: match ? 'matched' : 'unmatched'
	}
}

/** The right-hand panel: the matched transaction + the reconciliation verdict, as a DocView. */
export function mapMatchToView(match: InvoiceMatch | null, currency: string | null): DocView {
	if (!match) {
		return {
			title: 'Keine Transaktion gefunden',
			subtitle: 'Abgleich',
			sections: [
				section('Abgleich', {
					rows: kvList([['Status', 'Keine passende Buchung im Kontoauszug gefunden.']])
				})
			]
		}
	}
	const tx = match.tx
	const cur = currency ?? tx.currency
	return {
		title: 'Zahlung gefunden',
		subtitle: 'Abgleich',
		sections: [
			section('Transaktion', {
				rows: kvList([
					['Datum', tx.booking_date ?? tx.value_date],
					['Betrag', tx.amount != null ? `${tx.amount.toFixed(2)}${cur ? ` ${cur}` : ''}` : null],
					[
						'Originalbetrag',
						tx.original_amount != null
							? `${tx.original_amount.toFixed(2)}${tx.original_currency ? ` ${tx.original_currency}` : ''}`
							: null
					],
					['Gegenpartei', tx.counterparty_name ?? tx.counterparty_iban],
					['Verwendungszweck', tx.description],
					['Saldo danach', tx.balance_after != null ? tx.balance_after.toFixed(2) : null],
					['IBAN', tx.account_iban]
				])
			}),
			section('Abgleich', {
				rows: kvList([
					['Zuverlässigkeit', match.confidence === 'high' ? 'Hoch' : 'Mittel'],
					...match.reasons.map((r, i): [string, string] => [i === 0 ? 'Grund' : ' ', r])
				])
			})
		]
	}
}

/** Stable idempotency key for a reconciliation row. */
export function matchDedupKey(invoiceValueId: string | null, txKey: string | null): string {
	return `${invoiceValueId ?? '?'}::${txKey ?? 'none'}`
}
