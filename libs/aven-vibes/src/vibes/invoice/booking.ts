import { bezeichnungFor, isValidKonto } from '../../skr.js'
import { kvList, rec, section, str } from '../_doc/map.js'
import type { DocView } from '../_doc/types.js'

// board 0069/0073 — the booking of a reconciled invoice into SKR04. A booking is a Buchungssatz with
// one or MORE debit (Soll) positions — a Splitbuchung — that all balance against a single credit
// (Haben/contra) account. Splits are needed when a single invoice mixes VAT rates, cost types,
// private vs business shares, or Skonto. Pure (no DOM): the server validates konten against the
// chart, enforces the balance, and persists a `booking` record; the client renders it.

// Confidence in the PICKED ACCOUNT(s): high (obvious/standard), medium (plausible), low (unsure /
// fallback). `none` = nothing booked. board 0080.
export type BookingConfidence = 'high' | 'medium' | 'low' | 'none'

/** One debit (Soll) position of a (possibly split) booking. */
export type BookingLine = {
	soll_konto: string | null
	soll_bezeichnung: string | null
	net_amount: number | null
	tax_amount: number | null
	gross_amount: number | null
	tax_key: string | null
	note: string | null
}

/**
 * How a position is treated for VAT. The LLM picks this; WE derive the Vorsteuer posting from it —
 * the model never picks a VAT account or amount. board 0078.
 */
export type TaxTreatment = 'vat_19' | 'vat_7' | 'reverse_charge' | 'intra_eu' | 'none'

/**
 * Special cost-type handling the system applies deterministically. `bewirtung` = restaurant/
 * entertainment: by §4 Abs.5 Nr.2 EStG the NET splits 70% deductible (6640) / 30% non-deductible
 * (6644), with the FULL input VAT still deductible. board 0079.
 */
export type CostTreatment = 'standard' | 'bewirtung'

/** One Soll position as returned by the LLM (before validation/enrichment). */
export type BookingPickLine = {
	soll_konto?: string | null
	net_amount?: number | null
	tax_amount?: number | null
	gross_amount?: number | null
	tax_key?: string | null
	tax_treatment?: TaxTreatment | null
	cost_treatment?: CostTreatment | null
	note?: string | null
}

/** What the booking LLM returns (before validation/enrichment). */
export type BookingPick = {
	/** The debit positions. A single-position booking is just `lines.length === 1`. */
	lines?: BookingPickLine[] | null
	haben_konto?: string | null
	buchungstext?: string | null
	confidence?: BookingConfidence
	reason?: string | null
	// Legacy single-line shape (still accepted if `lines` is absent):
	soll_konto?: string | null
	net_amount?: number | null
	tax_amount?: number | null
	gross_amount?: number | null
	tax_key?: string | null
}

export type BookingRecord = {
	invoice_value_id: string | null
	invoice_number: string | null
	vendor: string | null
	currency: string | null
	/** The debit (Soll) positions — always ≥1 when booked. A Splitbuchung has >1. */
	lines: BookingLine[]
	is_split: boolean
	haben_konto: string | null
	haben_bezeichnung: string | null
	/** Totals across all lines (= the Haben amount). */
	net_amount: number | null
	tax_amount: number | null
	gross_amount: number | null
	// Mirror of lines[0] for compact / legacy single-line displays + BWA fallback:
	soll_konto: string | null
	soll_bezeichnung: string | null
	tax_key: string | null
	buchungstext: string | null
	confidence: BookingConfidence
	reason: string | null
	status: 'booked' | 'unbooked'
}

const LINE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		soll_konto: { type: ['string', 'null'] },
		soll_bezeichnung: { type: ['string', 'null'] },
		net_amount: { type: ['number', 'null'] },
		tax_amount: { type: ['number', 'null'] },
		gross_amount: { type: ['number', 'null'] },
		tax_key: { type: ['string', 'null'] },
		note: { type: ['string', 'null'] }
	}
} as const

/** The JSON Schema registered as the user's `booking` schema (Ajv-validated on write, like todos). */
export const BOOKING_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['invoice_value_id', 'status'],
	properties: {
		invoice_value_id: { type: ['string', 'null'] },
		invoice_number: { type: ['string', 'null'] },
		vendor: { type: ['string', 'null'] },
		currency: { type: ['string', 'null'] },
		lines: { type: 'array', items: LINE_SCHEMA },
		is_split: { type: 'boolean' },
		soll_konto: {
			type: ['string', 'null'],
			description: 'Debit account of the first/primary position (mirror of lines[0]).'
		},
		soll_bezeichnung: { type: ['string', 'null'] },
		haben_konto: {
			type: ['string', 'null'],
			description: 'Credit/contra account (e.g. 1800 Bank).'
		},
		haben_bezeichnung: { type: ['string', 'null'] },
		net_amount: { type: ['number', 'null'] },
		tax_amount: { type: ['number', 'null'] },
		gross_amount: { type: ['number', 'null'] },
		tax_key: {
			type: ['string', 'null'],
			description: 'Steuerschlüssel / VAT key of the primary position (mirror of lines[0]).'
		},
		buchungstext: { type: ['string', 'null'] },
		confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
		reason: { type: ['string', 'null'] },
		status: { type: 'string', enum: ['booked', 'unbooked'] }
	}
} as const

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Sum the non-null values; null only when every value is null (so "no amounts" stays null). */
function sumOrNull(values: (number | null)[]): number | null {
	const present = values.filter((v): v is number => v != null)
	return present.length ? present.reduce((s, v) => s + v, 0) : null
}

/** The invoice's printed gross total, for the Splitbuchung balance check. */
function invoiceGross(invoice: Record<string, unknown>): number | null {
	const totals = rec(invoice.totals)
	return num(totals.invoice_total) ?? num(invoice.total_outstanding)
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

/** SKR04 "Abziehbare Vorsteuer" account per VAT rate — WE pick these, never the LLM. board 0078. */
const VORSTEUER_KONTO: Record<string, string> = { '19': '1406', '7': '1401' }

// SKR04 Bewirtung accounts for the §4 Abs.5 EStG 70/30 split. board 0079.
const BEWIRTUNG_ABZIEHBAR = '6640' // Bewirtungskosten (70% abziehbar)
const BEWIRTUNG_NICHT_ABZIEHBAR = '6644' // Nicht abzugsfähige Bewirtungskosten (30%)

function treatmentLabel(
	t: TaxTreatment | null | undefined,
	rate: '19' | '7' | null
): string | null {
	if (rate) return `${rate}% Vorsteuer`
	if (t === 'reverse_charge') return 'Reverse Charge §13b'
	if (t === 'intra_eu') return 'Innergemeinschaftlicher Erwerb'
	if (t === 'none') return 'ohne Vorsteuer'
	return null
}

/**
 * Validate + enrich the LLM's pick into a persisted booking. Every Soll konto MUST be a real SKR04
 * konto (else status="unbooked"); Bezeichnungen are filled from the chart (never trusted from the
 * LLM). Supports Splitbuchungen: multiple Soll positions whose gross must sum to the invoice total
 * (the Haben amount) — if they don't balance, the discrepancy is noted in `reason`.
 */
export function buildBookingRecord(
	invoiceValueId: string | null,
	invoice: unknown,
	pick: BookingPick | null
): BookingRecord {
	const d = rec(invoice)
	const h = rec(d.header)

	// Normalize to a list of pick-lines (accept the legacy single-line shape).
	const rawLines: BookingPickLine[] =
		Array.isArray(pick?.lines) && pick.lines.length > 0
			? pick.lines
			: pick?.soll_konto != null
				? [
						{
							soll_konto: pick.soll_konto,
							net_amount: pick.net_amount,
							tax_amount: pick.tax_amount,
							gross_amount: pick.gross_amount,
							tax_key: pick.tax_key
						}
					]
				: []

	// One Soll expense position at a fixed konto + net (Bezeichnung filled from the chart).
	function mkExpenseLine(
		konto: string,
		net: number | null,
		taxKey: string | null,
		note: string | null
	): BookingLine {
		const valid = isValidKonto(konto)
		return {
			soll_konto: valid ? konto : null,
			soll_bezeichnung: valid ? bezeichnungFor(konto) : null,
			net_amount: net,
			tax_amount: null, // VAT is posted on its own Vorsteuer line, not here
			gross_amount: net, // a Soll position posts its NET to the expense account
			tax_key: taxKey,
			note
		}
	}

	// Build the EXPENSE (Soll) positions at NET, and accumulate deductible VAT per rate so we can post
	// the Abziehbare Vorsteuer ourselves (the LLM never picks a VAT account). board 0078/0079.
	const vatByRate = new Map<'19' | '7', number>()
	const expenseLines: BookingLine[] = []
	for (const l of rawLines) {
		const treatment = (l.tax_treatment ?? 'none') as TaxTreatment
		const rate: '19' | '7' | null =
			treatment === 'vat_19' ? '19' : treatment === 'vat_7' ? '7' : null
		// Resolve NET + VAT for this position: prefer explicit net; else derive from gross.
		let net = num(l.net_amount)
		let vat = num(l.tax_amount)
		const gross = num(l.gross_amount)
		if (rate) {
			const r = Number(rate) / 100
			if (net == null && gross != null) net = round2(gross / (1 + r))
			if (vat == null && net != null) vat = round2(net * r)
			if (vat != null) vatByRate.set(rate, round2((vatByRate.get(rate) ?? 0) + vat))
		} else if (net == null) {
			net = gross // no deductible VAT → the position IS the gross
		}
		const taxKey = str(l.tax_key) || treatmentLabel(treatment, rate)
		if (l.cost_treatment === 'bewirtung' && net != null) {
			// §4 Abs.5 Nr.2 EStG: 70% abziehbar (6640) / 30% nicht abziehbar (6644). The Vorsteuer
			// (accumulated above on the FULL net) stays fully deductible. board 0079.
			const abziehbar = round2(net * 0.7)
			const nicht = round2(net - abziehbar)
			expenseLines.push(
				mkExpenseLine(BEWIRTUNG_ABZIEHBAR, abziehbar, taxKey, l.note || 'Bewirtung (70% abziehbar)')
			)
			expenseLines.push(
				mkExpenseLine(BEWIRTUNG_NICHT_ABZIEHBAR, nicht, taxKey, 'Bewirtung (30% nicht abziehbar)')
			)
		} else {
			expenseLines.push(mkExpenseLine(str(l.soll_konto), net, taxKey, str(l.note) || null))
		}
	}
	// One Abziehbare-Vorsteuer Soll line per rate, with the konto taken from the SKR04 chart.
	const vatLines: BookingLine[] = [...vatByRate.entries()].map(([rate, amount]) => {
		const konto = VORSTEUER_KONTO[rate]
		const valid = isValidKonto(konto)
		return {
			soll_konto: valid ? konto : null,
			soll_bezeichnung: valid ? bezeichnungFor(konto) : null,
			net_amount: null,
			tax_amount: round2(amount),
			gross_amount: round2(amount),
			tax_key: `${rate}% Vorsteuer`,
			note: 'Abziehbare Vorsteuer'
		}
	})
	const lines: BookingLine[] = [...expenseLines, ...vatLines]

	const haben = str(pick?.haben_konto)
	const habenValid = isValidKonto(haben)
	const allKontenValid = lines.length > 0 && lines.every((l) => l.soll_konto != null)
	const booked = allKontenValid && habenValid

	const grossTotal = sumOrNull(lines.map((l) => l.gross_amount))
	const invGross = invoiceGross(d)
	// Splitbuchung invariant: the Soll positions must sum to the invoice gross (= the Haben amount).
	const balanced = grossTotal == null || invGross == null || Math.abs(grossTotal - invGross) <= 0.02
	const balanceNote = balanced
		? null
		: `Summe der Splitzeilen (${grossTotal?.toFixed(2)}) weicht vom Rechnungsbetrag (${invGross?.toFixed(2)}) ab.`

	const reasonBase = str(pick?.reason) || null
	const reason = balanceNote ? [reasonBase, balanceNote].filter(Boolean).join(' ') : reasonBase

	// Confidence in the picked ACCOUNT(s): take the LLM's self-rating, but never above 'low' when the
	// split doesn't balance, and 'none' when nothing booked. board 0080.
	const pickConf = pick?.confidence
	const confidence: BookingConfidence = !booked
		? 'none'
		: !balanced
			? 'low'
			: pickConf === 'high'
				? 'high'
				: pickConf === 'low'
					? 'low'
					: 'medium'

	const first = lines[0]
	return {
		invoice_value_id: invoiceValueId,
		invoice_number: str(h.invoice_number) || null,
		vendor: str(rec(d.vendor).name) || null,
		currency: str(h.currency) || null,
		lines,
		is_split: lines.length > 1,
		haben_konto: habenValid ? haben : null,
		haben_bezeichnung: habenValid ? bezeichnungFor(haben) : null,
		net_amount: sumOrNull(lines.map((l) => l.net_amount)),
		tax_amount: sumOrNull(lines.map((l) => l.tax_amount)),
		gross_amount: grossTotal,
		soll_konto: first?.soll_konto ?? null,
		soll_bezeichnung: first?.soll_bezeichnung ?? null,
		tax_key: first?.tax_key ?? null,
		buchungstext: str(pick?.buchungstext) || null,
		confidence,
		reason,
		status: booked ? 'booked' : 'unbooked'
	}
}

function money(n: number | null, cur: string | null): string | null {
	if (n == null) return null
	return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`
}

/** The right-hand panel: the Buchungssatz (one row per Soll position), as a DocView. */
export function mapBookingToView(booking: BookingRecord | null): DocView {
	if (!booking || booking.status !== 'booked') {
		return {
			title: 'Nicht gebucht',
			subtitle: 'Buchung',
			sections: [
				section('Buchung', {
					rows: kvList([['Status', booking?.reason || 'Kein passendes Konto gefunden.']])
				})
			]
		}
	}
	const cur = booking.currency
	const sollRows = booking.lines.map((l) => {
		const label = `${l.soll_konto} · ${l.soll_bezeichnung ?? ''}`.trim()
		const detail = [money(l.gross_amount, cur), l.tax_key].filter(Boolean).join(' · ')
		return [label, detail] as [string, string | null]
	})
	return {
		title: booking.is_split
			? `Splitbuchung · ${booking.lines.length} Positionen`
			: `${booking.soll_konto} ${booking.soll_bezeichnung ?? ''}`.trim(),
		subtitle: booking.is_split ? 'Splitbuchung (SKR04)' : 'Buchungssatz (SKR04)',
		sections: [
			section(booking.is_split ? 'Soll-Positionen' : 'Buchungssatz', {
				rows: kvList([
					...sollRows,
					['Haben', `${booking.haben_konto ?? '—'} · ${booking.haben_bezeichnung ?? ''}`.trim()],
					...(booking.is_split
						? []
						: ([['Steuerschlüssel', booking.tax_key]] as [string, string | null][])),
					['Buchungstext', booking.buchungstext]
				])
			}),
			section('Beträge', {
				rows: kvList([
					['Netto', money(booking.net_amount, cur)],
					['USt.', money(booking.tax_amount, cur)],
					['Brutto', money(booking.gross_amount, cur)]
				])
			}),
			section('Abgleich', {
				rows: kvList([
					[
						'Zuverlässigkeit',
						booking.confidence === 'high'
							? 'Hoch'
							: booking.confidence === 'low'
								? 'Niedrig'
								: 'Mittel'
					],
					['Grund', booking.reason]
				])
			})
		]
	}
}
