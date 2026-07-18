import { arr, columns, kvList, money, partyCard, rec, row, section, txt } from '../_doc/map.js'
import type { DocRow, DocSection, DocView } from '../_doc/types.js'

// Map a raw extracted INVOICE (doctype.json schema) → the generic DocView. board 0064.

const NUM_FLAGS = [false, false, true, false, true, true, true]

/** One invoice position → a table row (same shape for line_items and line_groups[].rows). */
function lineItemRow(rawLi: unknown, cur: string | null): DocRow {
	const li = rec(rawLi)
	const name = [li.title, li.description].filter(Boolean).join(' — ')
	return row(
		[
			li.position,
			name || txt(li.description),
			li.quantity,
			li.quantity_unit,
			money(li.unit_price, cur),
			li.tax_rate_percent,
			money(li.amount, cur)
		],
		NUM_FLAGS
	)
}

/** Every position in a statement: flat line_items PLUS each line_group (a title row + its rows),
 *  so nothing is dropped no matter which structure the model used. */
function statementRows(s: Record<string, unknown>, cur: string | null): DocRow[] {
	const rows: DocRow[] = []
	for (const li of arr(s.line_items)) rows.push(lineItemRow(li, cur))
	for (const rawGroup of arr(s.line_groups)) {
		const g = rec(rawGroup)
		const groupTitle = [g.title, g.context].filter(Boolean).join(' · ')
		if (groupTitle) rows.push(row(['', groupTitle, '', '', '', '', ''], NUM_FLAGS))
		for (const r of arr(g.rows)) rows.push(lineItemRow(r, cur))
	}
	return rows
}

export function mapInvoiceToView(raw: unknown): DocView {
	const d = rec(raw)
	const h = rec(d.header)
	const t = rec(d.totals)
	const cur = (h.currency as string | null) ?? null
	const sections: DocSection[] = []

	sections.push(
		section('Beleg', {
			rows: kvList([
				['Belegart', h.document_kind],
				['Rechnungs-Nr.', h.invoice_number],
				['Auftrag / Projekt', h.order_number],
				['Kundennr.', h.customer_number],
				['Ausstellungsdatum', h.issue_date],
				['Fällig', h.due_date],
				['Währung', cur]
			])
		})
	)

	sections.push(
		section('Parteien', { cards: [partyCard('Lieferant', d.vendor), partyCard('Käufer', d.buyer)] })
	)

	for (const rawStmt of arr(d.statements)) {
		const s = rec(rawStmt)
		sections.push(
			section(txt(s.section_title) === '—' ? 'Positionen' : String(s.section_title), {
				rows: s.service_period ? kvList([['Leistungszeitraum', s.service_period]]) : [],
				columns: columns([
					['Pos.'],
					['Bezeichnung'],
					['Menge', true],
					['ME'],
					['Einzelpreis', true],
					['USt %', true],
					['Betrag', true]
				]),
				tableRows: statementRows(s, cur)
			})
		)
	}

	const pays = arr(d.payments)
	sections.push(
		section('Summen', {
			rows: kvList([
				['Zwischensumme (netto)', t.subtotal != null ? money(t.subtotal, cur) : null],
				['USt. gesamt', t.tax_total != null ? money(t.tax_total, cur) : null],
				['Rechnungsbetrag', t.invoice_total != null ? money(t.invoice_total, cur) : null],
				['Offener Betrag', d.total_outstanding != null ? money(d.total_outstanding, cur) : null]
			]),
			columns: pays.length ? columns([['Zahlung'], ['Datum'], ['Betrag', true]]) : [],
			tableRows: pays.map((rawP) => {
				const p = rec(rawP)
				return row([p.method ?? 'Zahlung', p.date, money(p.amount, cur)], [false, false, true])
			})
		})
	)

	const num = txt(h.invoice_number)
	return { title: num === '—' ? 'Rechnung' : num, subtitle: 'Rechnung', sections }
}
