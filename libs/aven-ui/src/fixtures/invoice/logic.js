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

var DEFAULT_LABELS = {
	invoiceNumber: 'Rechnungs-Nr.',
	grandTotal: 'Gesamtbetrag',
	docKind: 'Belegart',
	dueDate: 'Fällig',
	issueDate: 'Ausstellungsdatum',
	orderNumber: 'Auftrag / Projekt',
	customerNumber: 'Kundennr.',
	contactPerson: 'Ansprechpartner',
	servicePeriod: 'LEISTUNGSZEITRAUM',
	lineItemsAria: 'Positionen',
	financialsAria: 'Zahlungen und Summen',
	outstanding: 'Offener Betrag',
	payments: 'Zahlungen',
	paymentInfo: 'Zahlungsinformationen',
	vendorRole: 'Lieferant',
	buyerRole: 'Käufer',
	paymentFallback: '(Zahlung)',
	subtotal: 'Zwischensumme (netto)',
	taxTotal: 'USt. gesamt',
	invoiceTotal: 'Rechnungsbetrag',
	taxPrefix: 'USt.',
	tableColumns: [
		{ label: '#', class: 'idx' },
		{ label: 'Pos.', class: '' },
		{ label: 'Art.-Nr.', class: '' },
		{ label: 'Bezeichnung', class: '' },
		{ label: 'Menge', class: 'num' },
		{ label: 'ME', class: '' },
		{ label: 'Einzelpreis', class: 'num' },
		{ label: 'USt. %', class: 'num' },
		{ label: 'Betrag', class: 'num' },
	],
}

function mergeLabels(source) {
	if (!source || !source.labels) return DEFAULT_LABELS
	var labels = source.labels
	var merged = {}
	var k
	for (k in DEFAULT_LABELS) merged[k] = DEFAULT_LABELS[k]
	for (k in labels) merged[k] = labels[k]
	if (!labels.tableColumns || !labels.tableColumns.length) merged.tableColumns = DEFAULT_LABELS.tableColumns
	return merged
}

function joinNonEmpty(parts, sep) {
	var out = []
	for (var i = 0; i < parts.length; i++) {
		if (parts[i]) out.push(parts[i])
	}
	return out.join(sep)
}

function splitMethodLabel(method) {
	return String(method).replace(/([A-Za-z])(\d)/g, '$1 $2')
}

function buildPartyCard(role, party) {
	party = party || {}
	var plzCity = joinNonEmpty([party.postal_code, party.city], ' ')
	var addressLines = []
	if (party.street) addressLines.push({ line: party.street })
	if (plzCity) addressLines.push({ line: plzCity })
	if (party.country) addressLines.push({ line: party.country })
	var identifiers = (party.identifiers || [])
		.filter(function (id) { return id && id.value && String(id.value).trim() })
		.map(function (id) {
			return {
				label: id.label_printed ? String(id.label_printed) + ': ' : '',
				value: id.value || '',
			}
		})
	return {
		role: role,
		name: party.name || '–',
		contact: party.contact_name ? String(party.contact_name).trim() : '',
		addressLines: addressLines,
		email: party.email || '',
		phone: party.phone || '',
		identifiers: identifiers,
	}
}

function initState(source) {
	source = source || {}
	var cur = (source.header && source.header.currency) || 'EUR'
	var header = source.header || {}
	var totals = source.totals || {}
	var labels = mergeLabels(source)

	var totalRows = []
	if (totals.subtotal != null) {
		totalRows.push({
			label: labels.subtotal,
			value: fmtMoney(totals.subtotal, cur),
			rowClass: 'row inv-totals-line inv-totals-line--subtotal',
		})
	}
	var taxBreakdown = totals.tax_breakdown || []
	for (var ti = 0; ti < taxBreakdown.length; ti++) {
		var row = taxBreakdown[ti]
		var p = row.tax_rate_percent
		var lab = labels.taxPrefix
		if (p != null && !isNaN(Number(p))) {
			lab = labels.taxPrefix + ' ' + fmtNum(Number(p)) + '%'
			if (row.tax_group_letter) lab = lab + ' (' + String(row.tax_group_letter).charAt(0) + ')'
		}
		totalRows.push({
			label: lab,
			value: fmtMoney(row.tax_amount, cur),
			rowClass: 'row inv-totals-line inv-totals-line--tax-rate',
		})
	}
	if (totals.tax_total != null) {
		totalRows.push({
			label: labels.taxTotal,
			value: fmtMoney(totals.tax_total, cur),
			rowClass: 'row inv-totals-line inv-totals-line--tax-total-sum',
		})
	}
	if (totals.invoice_total != null) {
		totalRows.push({
			label: labels.invoiceTotal,
			value: fmtMoney(totals.invoice_total, cur),
			rowClass: 'row inv-totals-line inv-totals-line--invoice-total',
		})
	}

	var payments = (source.payments || []).map(function (p) {
		var bits = []
		if (p.date) bits.push(fmtDate(p.date))
		if (p.method) bits.push(splitMethodLabel(p.method))
		if (p.reference) bits.push(String(p.reference))
		return {
			left: bits.length ? bits.join(' · ') : labels.paymentFallback,
			amount: p.amount == null ? '–' : fmtMoney(p.amount, cur),
		}
	})

	var sections = (source.statements || []).map(function (st) {
		return {
			sectionTitle: st.section_title || '',
			servicePeriod: st.service_period || '',
			lineItems: (st.line_items || []).map(function (raw, i) {
				var kind = raw.line_kind ? String(raw.line_kind).trim() : ''
				var taxPct = raw.tax_rate_percent
				var tax = '–'
				if (taxPct != null && String(taxPct) !== '' && !isNaN(Number(taxPct))) {
					tax = fmtNum(Number(taxPct)) + '%'
				}
				var quantity = ''
				if (raw.quantity != null && typeof raw.quantity === 'number') {
					quantity = fmtNum(raw.quantity)
				} else if (raw.quantity != null) {
					quantity = String(raw.quantity)
				}
				return {
					idx: String(i + 1),
					position: raw.position != null ? String(raw.position) : '',
					article: raw.article_number != null ? String(raw.article_number) : '',
					title: raw.title ? String(raw.title).trim() : '',
					description: raw.description ? String(raw.description).trim() : '',
					quantity: quantity,
					unit: raw.quantity_unit || '',
					unitPrice: fmtMoney(raw.unit_price, cur),
					tax: tax,
					amount: fmtMoney(raw.amount, cur),
					rowClass: kind === 'discount' ? 'inv-line inv-line-discount' : 'inv-line',
				}
			}),
		}
	})

	return {
		labels: labels,
		invoiceNumber: header.invoice_number || '',
		grandTotal: fmtMoney(totals.invoice_total, cur),
		docKind: header.document_kind ? String(header.document_kind).replace(/_/g, ' ') : '',
		issueDate: fmtDate(header.issue_date),
		dueDate: fmtDate(header.due_date),
		orderNumber: header.order_number || '',
		customerNumber: header.customer_number || '',
		vendor: buildPartyCard(labels.vendorRole, source.vendor),
		buyer: buildPartyCard(labels.buyerRole, source.buyer),
		sections: sections,
		totalRows: totalRows,
		payments: payments,
		outstanding: fmtMoney(source.total_outstanding, cur),
		paymentInstructions: source.payment_instructions ? String(source.payment_instructions).trim() : '',
	}
}
