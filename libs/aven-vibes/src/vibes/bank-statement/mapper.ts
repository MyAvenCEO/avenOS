import { arr, columns, kvList, money, partyCard, rec, row, section, txt } from '../_doc/map.js'
import type { DocSection, DocView } from '../_doc/types.js'

// Map a raw extracted BANK STATEMENT (doctype.json schema) → the generic DocView. board 0064.

export function mapBankStatementToView(raw: unknown): DocView {
	const d = rec(raw)
	const ov = rec(d.account_overview)
	const cur = (d.currency as string | null) ?? null
	const sections: DocSection[] = []

	sections.push(
		section('Auszug', {
			rows: kvList([
				['Art', d.statement_kind],
				['Auszug-Nr.', d.statement_id],
				['Zeitraum von', d.period_start],
				['Zeitraum bis', d.period_end],
				['Währung', cur],
				['Eröffnungssaldo', d.opening_balance != null ? money(d.opening_balance, cur) : null],
				['Schlusssaldo', d.closing_balance != null ? money(d.closing_balance, cur) : null]
			])
		})
	)

	sections.push(
		section('Kontoinhaber / Institut', {
			cards: [partyCard('Kontoinhaber', d.account_holder), partyCard('Institut', d.institution)]
		})
	)

	sections.push(
		section('Kontodaten', {
			rows: kvList([
				['IBAN', ov.iban],
				['BIC', ov.bic],
				['Kontonummer', ov.account_number],
				['Bankleitzahl', ov.domestic_bank_code],
				['Produkt', ov.product_name],
				['Karte', ov.card_last_four ? `•••• ${txt(ov.card_last_four)}` : null]
			])
		})
	)

	const txns = arr(d.transactions)
	sections.push(
		section('Buchungen', {
			columns: txns.length
				? columns([['Buchung'], ['Wert'], ['Verwendungszweck'], ['Betrag', true], ['Saldo', true]])
				: [],
			tableRows: txns.map((rawT) => {
				const tn = rec(rawT)
				const party = tn.counterparty_name || tn.counterparty_iban
				const desc = [party, tn.title, tn.description].filter(Boolean).join(' — ') || txt(party)
				return row(
					[
						tn.booking_date,
						tn.value_date,
						desc,
						money(tn.amount, cur),
						money(tn.balance_after, cur)
					],
					[false, false, false, true, true]
				)
			})
		})
	)

	const holder = txt(rec(d.account_holder).name)
	return {
		title: holder === '—' ? 'Kontoauszug' : holder,
		subtitle: 'Kontoauszug',
		sections
	}
}
