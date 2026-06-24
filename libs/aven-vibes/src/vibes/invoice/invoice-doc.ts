import { kvList, money, rec, section, str } from '../_doc/map.js'
import type { DocView } from '../_doc/types.js'

// board 0082 — an OUTGOING invoice document we author (vs. the ingested `invoice` doctype). Holds the
// number, state (entwurf/angebot/rechnung), version, the customer (contact) ref, a snapshot of the
// seller (the user's Stammdaten), the line items, and the auto-calculated VAT totals. Pure (no DOM):
// totals math + §14-UStG required-field check + a DocView mapper. Each edit persists a NEW version row.

export type InvoiceState = 'entwurf' | 'angebot' | 'rechnung'

export type InvoiceLine = {
	description: string
	quantity: number
	unit_price: number
	/** German VAT rate in percent: 19, 7 or 0. */
	vat_rate: number
}

export type RateTotal = { rate: number; net: number; vat: number }
export type InvoiceTotals = {
	by_rate: RateTotal[]
	net_total: number
	vat_total: number
	gross_total: number
}

export type Party = {
	name: string | null
	legal_form?: string | null
	street: string | null
	zip: string | null
	city: string | null
	country?: string | null
	vat_id: string | null
	tax_number?: string | null
	iban?: string | null
	bic?: string | null
	bank_name?: string | null
	register_court?: string | null
	register_number?: string | null
	managing_director?: string | null
}

export type InvoiceDoc = {
	number: string
	state: InvoiceState
	version: number
	contact_short_id: string | null
	contact_value_id: string | null
	issue_date: string | null
	service_date: string | null
	/** Liefer-/Leistungszeitraum (free text: a single date or a range). board 0082. */
	service_period: string | null
	seller: Party | null
	buyer: Party | null
	lines: InvoiceLine[]
	totals: InvoiceTotals | null
	currency: string | null
	note: string | null
	/** content hash of the rendered PDF in the PRIVATE store. */
	pdf_file_hash: string | null
	supersedes: string | null
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

/** Group line items by VAT rate and compute per-rate net/vat + grand net/vat/gross. */
export function computeInvoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
	const byRate = new Map<number, number>() // rate -> net
	for (const l of lines) {
		const qty = Number.isFinite(l.quantity) ? l.quantity : 0
		const price = Number.isFinite(l.unit_price) ? l.unit_price : 0
		const rate = Number.isFinite(l.vat_rate) ? l.vat_rate : 0
		byRate.set(rate, round2((byRate.get(rate) ?? 0) + qty * price))
	}
	const by_rate: RateTotal[] = [...byRate.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([rate, net]) => ({ rate, net: round2(net), vat: round2((net * rate) / 100) }))
	const net_total = round2(by_rate.reduce((s, r) => s + r.net, 0))
	const vat_total = round2(by_rate.reduce((s, r) => s + r.vat, 0))
	return { by_rate, net_total, vat_total, gross_total: round2(net_total + vat_total) }
}

const LINE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		description: { type: 'string' },
		quantity: { type: 'number' },
		unit_price: { type: 'number' },
		vat_rate: { type: 'number' }
	}
} as const

const PARTY_SCHEMA = {
	type: ['object', 'null'],
	additionalProperties: true
} as const

/** The JSON Schema registered as the user's `invoice_doc` schema (Ajv-validated on write). */
export const INVOICE_DOC_SCHEMA = {
	type: 'object',
	additionalProperties: true,
	required: ['number', 'state'],
	properties: {
		number: { type: 'string' },
		state: { type: 'string', enum: ['entwurf', 'angebot', 'rechnung'] },
		version: { type: 'number' },
		contact_short_id: { type: ['string', 'null'] },
		contact_value_id: { type: ['string', 'null'] },
		issue_date: { type: ['string', 'null'] },
		service_date: { type: ['string', 'null'] },
		service_period: { type: ['string', 'null'] },
		seller: PARTY_SCHEMA,
		buyer: PARTY_SCHEMA,
		lines: { type: 'array', items: LINE_SCHEMA },
		totals: { type: ['object', 'null'], additionalProperties: true },
		currency: { type: ['string', 'null'] },
		note: { type: ['string', 'null'] },
		pdf_file_hash: { type: ['string', 'null'] },
		supersedes: { type: ['string', 'null'] }
	}
} as const

// The fields a §14-UStG-compliant Rechnung needs; missing ones are HITL'd back to the human.
const REQUIRED: { key: string; label: string; get: (d: InvoiceDoc) => unknown }[] = [
	{ key: 'seller.name', label: 'Name des leistenden Unternehmers', get: (d) => d.seller?.name },
	{
		key: 'seller.street',
		label: 'Anschrift (Straße) des Unternehmers',
		get: (d) => d.seller?.street
	},
	{ key: 'seller.city', label: 'Anschrift (Ort) des Unternehmers', get: (d) => d.seller?.city },
	{
		key: 'seller.tax_id',
		label: 'USt-IdNr. oder Steuernummer des Unternehmers',
		get: (d) => d.seller?.vat_id || d.seller?.tax_number
	},
	{ key: 'buyer.name', label: 'Name des Leistungsempfängers', get: (d) => d.buyer?.name },
	{ key: 'buyer.street', label: 'Anschrift (Straße) des Empfängers', get: (d) => d.buyer?.street },
	{ key: 'buyer.city', label: 'Anschrift (Ort) des Empfängers', get: (d) => d.buyer?.city },
	{ key: 'issue_date', label: 'Rechnungsdatum (Ausstellungsdatum)', get: (d) => d.issue_date },
	{ key: 'number', label: 'Fortlaufende Rechnungsnummer', get: (d) => d.number },
	{
		key: 'lines',
		label: 'Mindestens eine Position (Menge + Bezeichnung)',
		get: (d) => d.lines?.length
	}
]

/** §14 UStG: which required fields are still missing (labels) — drives the HITL prompt. */
export function requiredFieldsMissing(doc: InvoiceDoc): string[] {
	return REQUIRED.filter((r) => {
		const v = r.get(doc)
		return v == null || v === '' || v === 0
	}).map((r) => r.label)
}

const STATE_LABEL: Record<InvoiceState, string> = {
	entwurf: 'Entwurf',
	angebot: 'Angebot',
	rechnung: 'Rechnung'
}

function partyLines(p: Party | null): string | null {
	if (!p) return null
	return [
		p.name,
		p.street,
		[p.zip, p.city].filter(Boolean).join(' '),
		p.vat_id ? `USt-IdNr. ${p.vat_id}` : null
	]
		.filter(Boolean)
		.join(' · ')
}

// Map our authored Party → the ingested-invoice doctype party shape (what `partyCard` reads), so the
// outgoing invoice renders through the SAME generic doc-view template as an extracted invoice.
function partyToDoctype(p: Party | null): Record<string, unknown> | null {
	if (!p) return null
	// Geschäftsbrief identifiers (Steuernummer, HRB, Registergericht, Geschäftsführer) → partyCard.
	const identifiers = [
		{ label_printed: 'Steuernr.', value: p.tax_number },
		{ label_printed: 'Registergericht', value: p.register_court },
		{ label_printed: 'Handelsregister', value: p.register_number },
		{ label_printed: 'Geschäftsführer', value: p.managing_director }
	].filter((i) => typeof i.value === 'string' && i.value)
	return {
		name: [p.name, p.legal_form].filter(Boolean).join(' ') || null,
		street: p.street,
		postal_code: p.zip,
		city: p.city,
		country: p.country,
		tax_id: p.vat_id ?? null,
		bank: p.iban ? { iban: p.iban, bic: p.bic } : null,
		identifiers
	}
}

/**
 * Convert an authored `InvoiceDoc` into the ingested-invoice doctype shape (header / vendor / buyer /
 * statements / totals), so `mapInvoiceToView` renders it with the full Beleg + Parteien + Positionen +
 * Summen layout — identical to an extracted invoice. board 0082.
 */
export function invoiceDocToDoctype(doc: InvoiceDoc): Record<string, unknown> {
	const totals = doc.totals ?? computeInvoiceTotals(doc.lines ?? [])
	return {
		header: {
			document_kind: STATE_LABEL[doc.state as InvoiceState] ?? 'Rechnung',
			invoice_number: doc.number,
			issue_date: doc.issue_date,
			currency: doc.currency ?? 'EUR'
		},
		vendor: partyToDoctype(doc.seller),
		buyer: partyToDoctype(doc.buyer),
		statements: [
			{
				section_title: 'Positionen',
				// §14 UStG: the Leistungszeitraum is mandatory — fall back to "= Rechnungsdatum".
				service_period: doc.service_period ?? doc.service_date ?? 'entspricht dem Rechnungsdatum',
				line_items: (doc.lines ?? []).map((l, i) => ({
					position: i + 1,
					description: l.description,
					quantity: l.quantity,
					unit_price: l.unit_price,
					tax_rate_percent: l.vat_rate,
					amount: round2((l.quantity || 0) * (l.unit_price || 0))
				}))
			}
		],
		totals: {
			net_total: totals.net_total,
			tax_total: totals.vat_total,
			invoice_total: totals.gross_total
		}
	}
}

/** The invoice-document detail view (number, parties, positions, totals), as a DocView. */
export function mapInvoiceDocToView(doc: InvoiceDoc | Record<string, unknown> | null): DocView {
	const d = rec(doc) as unknown as InvoiceDoc
	const cur = str((d as Record<string, unknown>).currency) || 'EUR'
	const totals = d.totals ?? (Array.isArray(d.lines) ? computeInvoiceTotals(d.lines) : null)
	const rateRows = (totals?.by_rate ?? []).map((r): [string, string | null] => [
		`Netto ${r.rate}%`,
		`${money(r.net, cur)} (USt ${money(r.vat, cur)})`
	])
	const lineRows = (d.lines ?? []).map((l): [string, string | null] => [
		`${l.quantity}× ${l.description}`,
		money(round2((l.quantity || 0) * (l.unit_price || 0)), cur)
	])
	return {
		title: d.number || '—',
		subtitle: `${STATE_LABEL[d.state as InvoiceState] ?? d.state} · v${d.version ?? 1}`,
		sections: [
			section('Parteien', {
				rows: kvList([
					['Von', partyLines(d.seller)],
					['An', partyLines(d.buyer)],
					['Datum', str((d as Record<string, unknown>).issue_date) || null]
				])
			}),
			section('Positionen', { rows: kvList(lineRows) }),
			section('Summen', {
				rows: kvList([
					...rateRows,
					['Netto gesamt', money(totals?.net_total ?? null, cur)],
					['USt. gesamt', money(totals?.vat_total ?? null, cur)],
					['Rechnungsbetrag', money(totals?.gross_total ?? null, cur)]
				])
			})
		]
	}
}
