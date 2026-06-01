function pad2(n) {
	return n < 10 ? '0' + n : String(n)
}

function fmtDate(s) {
	if (!s || !String(s).trim()) return ''
	var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
	if (m) {
		var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
		if (!isNaN(d.getTime())) {
			return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear()
		}
	}
	return String(s).trim()
}

function groupThousands(whole) {
	var s = String(whole)
	if (s.length <= 3) return s
	var out = ''
	var count = 0
	for (var i = s.length - 1; i >= 0; i--) {
		out = s.charAt(i) + out
		count++
		if (count === 3 && i > 0) {
			out = '.' + out
			count = 0
		}
	}
	return out
}

function fmtMoney(n, currency) {
	var cur = currency || 'EUR'
	if (n == null || isNaN(Number(n))) return '–'
	var num = Number(n)
	var sign = num < 0 ? '-' : ''
	var abs = Math.abs(num)
	var parts = abs.toFixed(2).split('.')
	return sign + groupThousands(parts[0]) + ',' + parts[1] + ' ' + cur
}

function fmtNum(n) {
	if (n == null || isNaN(Number(n))) return '–'
	var num = Number(n)
	var sign = num < 0 ? '-' : ''
	var abs = Math.abs(num)
	var parts = abs.toFixed(2).split('.')
	return sign + groupThousands(parts[0]) + ',' + parts[1]
}

function isRecord(x) {
	return typeof x === 'object' && x !== null && !Array.isArray(x)
}

var STATEMENT_KIND_LABELS = {
	periodic_account_statement: 'Kontoauszug (periodisch)',
	fee_or_service_statement: 'Gebühren- / Serviceauszug',
	credit_card_statement: 'Kreditkartenabrechnung',
	savings_account_statement: 'Sparkontoauszug',
	other: 'Sonstiges',
}

function statementKindLabel(k) {
	if (k == null || typeof k !== 'string' || !k.trim()) return 'Kontoauszug'
	return STATEMENT_KIND_LABELS[k] || k.replace(/_/g, ' ')
}

function pushField(target, label, val, cur, money, nowrap) {
	if (val == null) return
	if (typeof val === 'number' && isNaN(val)) return
	var shown =
		money && typeof val === 'number'
			? fmtMoney(val, cur)
			: typeof val === 'string'
				? val
				: String(val)
	if (typeof shown === 'string' && !shown.trim()) return
	target.push({
		val: shown,
		label: label,
		cellClass: nowrap ? 'bs-field-cell bs-field-cell--nowrap' : 'bs-field-cell',
	})
}

function buildPartyCard(roleTitle, party, footer) {
	party = party || {}
	var lines = []
	var contact = typeof party.contact_name === 'string' ? party.contact_name.trim() : ''
	if (contact) lines.push({ cls: 'muted', text: 'Ansprechpartner: ' + contact })
	var street = typeof party.street === 'string' ? party.street : ''
	var pc = typeof party.postal_code === 'string' ? party.postal_code : ''
	var city = typeof party.city === 'string' ? party.city : ''
	var country = typeof party.country === 'string' ? party.country : ''
	var plzCity = [pc, city].filter(Boolean).join(' ')
	if (street) lines.push({ cls: 'line', text: street })
	if (plzCity) lines.push({ cls: 'line', text: plzCity })
	if (country) lines.push({ cls: 'muted', text: country })
	if (typeof party.email === 'string' && party.email) lines.push({ cls: 'muted', text: party.email })
	if (typeof party.phone === 'string' && party.phone) lines.push({ cls: 'muted', text: party.phone })
	var tax = party.tax_id
	if (typeof tax === 'string' && tax.trim()) lines.push({ cls: 'muted', text: tax.trim() })
	if (footer) lines.push({ cls: 'muted', text: footer })
	return { role: roleTitle, name: party.name || '–', lines: lines }
}

function buildRows(transactions, cur) {
	return (Array.isArray(transactions) ? transactions : []).map(function (raw) {
		if (!isRecord(raw)) raw = {}
		var title = typeof raw.title === 'string' ? raw.title.trim() : ''
		var desc = typeof raw.description === 'string' ? raw.description.trim() : ''
		var amt = raw.amount
		var amtNum = typeof amt === 'number' && !isNaN(amt) ? amt : null
		var amtCls = amtNum != null && amtNum < 0 ? 'num num--neg' : 'num'
		var fxBits = []
		if (raw.original_amount != null && raw.original_currency) {
			fxBits.push(
				fmtMoney(raw.original_amount, String(raw.original_currency)) +
					' · Kurs ' +
					(raw.exchange_rate != null ? raw.exchange_rate : '–'),
			)
		}
		if (raw.fx_surcharge_eur != null && typeof raw.fx_surcharge_eur === 'number') {
			fxBits.push('FX-Gebühr EUR ' + fmtMoney(raw.fx_surcharge_eur, cur))
		}
		if (
			raw.foreign_exchange_fee_percent != null &&
			typeof raw.foreign_exchange_fee_percent === 'number'
		) {
			fxBits.push(fmtNum(raw.foreign_exchange_fee_percent) + '% Umrechnung')
		}
		var bal = raw.balance_after
		var rate = raw.exchange_rate
		return {
			booking: fmtDate(raw.booking_date),
			value: fmtDate(raw.value_date),
			descTitle: title,
			descBody: desc,
			fx: fxBits.length ? fxBits.join(' · ') : '',
			amount: fmtMoney(amt, cur),
			amountClass: amtCls,
			balance: bal != null && typeof bal === 'number' ? fmtMoney(bal, cur) : '–',
			rate: rate != null && String(rate).trim() ? String(rate) : '–',
		}
	})
}

var COLUMNS = [
	{ label: 'Buchungsdatum', cls: '' },
	{ label: 'Wertstellung', cls: '' },
	{ label: 'Verwendungszweck', cls: '' },
	{ label: 'Betrag', cls: 'num' },
	{ label: 'Saldo', cls: 'num' },
	{ label: 'Kurs', cls: 'num' },
]

function initState(source) {
	var s = source || {}
	var cur = typeof s.currency === 'string' ? s.currency : 'EUR'

	var stmtId =
		typeof s.statement_id === 'string' && s.statement_id.trim() ? s.statement_id.trim() : ''
	var heroRight = []
	if (s.closing_balance != null && typeof s.closing_balance === 'number') {
		heroRight.push({ money: fmtMoney(s.closing_balance, cur), sub: 'Schlusssaldo' })
	}

	var overview = isRecord(s.account_overview) ? s.account_overview : {}
	var iban = typeof overview.iban === 'string' ? overview.iban.trim() : ''

	var fieldsLine2 = []
	pushField(fieldsLine2, 'BIC / SWIFT', overview.bic, cur)
	pushField(fieldsLine2, 'Bankleitzahl', overview.domestic_bank_code, cur)
	pushField(fieldsLine2, 'Kontonummer', overview.account_number, cur)
	pushField(fieldsLine2, 'Produkt', overview.product_name, cur)
	pushField(fieldsLine2, 'Karte (letzte 4)', overview.card_last_four, cur)
	pushField(fieldsLine2, 'IBAN', iban || null, cur, false, true)

	var periodFrom = fmtDate(s.period_start)
	var periodTo = fmtDate(s.period_end)
	var periodRange =
		periodFrom && periodTo ? periodFrom + ' – ' + periodTo : periodFrom || periodTo || null

	var fieldsLine3 = []
	pushField(fieldsLine3, 'Auszugsart', statementKindLabel(s.statement_kind), cur)
	pushField(fieldsLine3, 'Zeitraum', periodRange, cur)
	pushField(fieldsLine3, 'Anfangssaldo', s.opening_balance, cur, true)
	pushField(fieldsLine3, 'Ausstellungsdatum', fmtDate(s.statement_issue_date) || null, cur)
	pushField(fieldsLine3, 'Zahlungsfrist', fmtDate(s.payment_due_date) || null, cur)

	var branchFooter =
		typeof overview.branch_name === 'string' && overview.branch_name.trim()
			? 'Filiale: ' + overview.branch_name.trim()
			: ''

	var notes = []
	if (typeof s.notes === 'string' && s.notes.trim()) notes.push({ text: s.notes.trim() })

	return {
		heroTitle: stmtId || 'Kontoauszug',
		heroSub: stmtId ? 'Auszugs-Nr.' : 'Dokument',
		heroRight: heroRight,
		fieldsLine2: fieldsLine2,
		fieldsLine3: fieldsLine3,
		holder: buildPartyCard('Kontoinhaber', s.account_holder, ''),
		institution: buildPartyCard('Institut', s.institution, branchFooter),
		columns: COLUMNS,
		rows: buildRows(s.transactions, cur),
		notes: notes,
	}
}
