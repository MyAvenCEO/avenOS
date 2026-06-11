// Bank-transfers vibe logic. Builds a left-hand list of payments/transfers and,
// for the currently selected row, an invoice-shaped `detail` object consumed by
// the (re-prefixed) invoice view on the right. Plain ES5-style JS — runs inside
// the QuickJS sandbox, so no imports, arrow functions or template literals.

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

// ---------------------------------------------------------------------------
// List (left pane)
// ---------------------------------------------------------------------------

var DEFAULT_LIST_LABELS = {
	listEyebrow: 'Zahlungsausgänge',
	countLabel: 'Vorgänge',
	emptyList: 'Keine Überweisungen vorhanden',
	detailEyebrow: 'Beleg',
	detailEmpty: 'Wähle links eine Überweisung, um die zugehörige Rechnung anzuzeigen.'
}

function mergeListLabels(source) {
	var merged = {}
	var k
	for (k in DEFAULT_LIST_LABELS) merged[k] = DEFAULT_LIST_LABELS[k]
	if (source && source.labels) {
		for (k in source.labels) merged[k] = source.labels[k]
	}
	return merged
}

var STATUS_META = {
	paid: { label: 'Bezahlt', dotClass: 'bt-dot bt-dot--paid' },
	pending: { label: 'Ausstehend', dotClass: 'bt-dot bt-dot--pending' },
	scheduled: { label: 'Geplant', dotClass: 'bt-dot bt-dot--scheduled' },
	failed: { label: 'Fehlgeschlagen', dotClass: 'bt-dot bt-dot--failed' },
	overdue: { label: 'Überfällig', dotClass: 'bt-dot bt-dot--overdue' }
}

function statusMeta(status) {
	return STATUS_META[status] || { label: status ? String(status) : '–', dotClass: 'bt-dot' }
}

function txCurrency(tx) {
	if (tx.currency) return tx.currency
	if (tx.invoice && tx.invoice.header && tx.invoice.header.currency)
		return tx.invoice.header.currency
	return 'EUR'
}

function buildRow(tx, selectedId) {
	var meta = statusMeta(tx.status)
	var active = tx.id === selectedId
	var incoming = tx.direction === 'in'
	return {
		id: tx.id,
		payee: tx.payee || '–',
		reference: tx.reference || '',
		date: fmtDate(tx.date),
		amount: (incoming ? '+' : '') + fmtMoney(tx.amount, txCurrency(tx)),
		statusLabel: meta.label,
		dotClass: meta.dotClass,
		rowClass: active ? 'bt-row bt-row--active' : 'bt-row',
		ariaCurrent: active ? 'true' : 'false',
		amountClass: incoming ? 'bt-row-amount bt-row-amount--in' : 'bt-row-amount'
	}
}

function findTx(transfers, id) {
	for (var i = 0; i < transfers.length; i++) {
		if (transfers[i].id === id) return transfers[i]
	}
	return null
}

// ---------------------------------------------------------------------------
// Detail (right pane) — mirrors the invoice vibe's initState shape so the
// re-prefixed invoice view can bind to `$detail.*`.
// ---------------------------------------------------------------------------

var DEFAULT_INVOICE_LABELS = {
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
		{ label: 'Betrag', class: 'num' }
	]
}

function mergeInvoiceLabels(inv) {
	if (!inv || !inv.labels) return DEFAULT_INVOICE_LABELS
	var labels = inv.labels
	var merged = {}
	var k
	for (k in DEFAULT_INVOICE_LABELS) merged[k] = DEFAULT_INVOICE_LABELS[k]
	for (k in labels) merged[k] = labels[k]
	if (!labels.tableColumns || !labels.tableColumns.length)
		merged.tableColumns = DEFAULT_INVOICE_LABELS.tableColumns
	return merged
}

function buildPartyCard(role, party) {
	party = party || {}
	var plzCity = joinNonEmpty([party.postal_code, party.city], ' ')
	var addressLines = []
	if (party.street) addressLines.push({ line: party.street })
	if (plzCity) addressLines.push({ line: plzCity })
	if (party.country) addressLines.push({ line: party.country })
	var identifiers = (party.identifiers || [])
		.filter((id) => id && id.value && String(id.value).trim())
		.map((id) => ({
			label: id.label_printed ? String(id.label_printed) + ': ' : '',
			value: id.value || ''
		}))
	return {
		role: role,
		name: party.name || '–',
		contact: party.contact_name ? String(party.contact_name).trim() : '',
		addressLines: addressLines,
		email: party.email || '',
		phone: party.phone || '',
		identifiers: identifiers
	}
}

function buildDetail(inv) {
	inv = inv || {}
	var cur = (inv.header && inv.header.currency) || 'EUR'
	var header = inv.header || {}
	var totals = inv.totals || {}
	var labels = mergeInvoiceLabels(inv)

	var totalRows = []
	if (totals.subtotal != null) {
		totalRows.push({
			label: labels.subtotal,
			value: fmtMoney(totals.subtotal, cur),
			rowClass: 'row inv-totals-line inv-totals-line--subtotal'
		})
	}
	var taxBreakdown = totals.tax_breakdown || []
	for (var ti = 0; ti < taxBreakdown.length; ti++) {
		var trow = taxBreakdown[ti]
		var p = trow.tax_rate_percent
		var lab = labels.taxPrefix
		if (p != null && !isNaN(Number(p))) {
			lab = labels.taxPrefix + ' ' + fmtNum(Number(p)) + '%'
			if (trow.tax_group_letter) lab = lab + ' (' + String(trow.tax_group_letter).charAt(0) + ')'
		}
		totalRows.push({
			label: lab,
			value: fmtMoney(trow.tax_amount, cur),
			rowClass: 'row inv-totals-line inv-totals-line--tax-rate'
		})
	}
	if (totals.tax_total != null) {
		totalRows.push({
			label: labels.taxTotal,
			value: fmtMoney(totals.tax_total, cur),
			rowClass: 'row inv-totals-line inv-totals-line--tax-total-sum'
		})
	}
	if (totals.invoice_total != null) {
		totalRows.push({
			label: labels.invoiceTotal,
			value: fmtMoney(totals.invoice_total, cur),
			rowClass: 'row inv-totals-line inv-totals-line--invoice-total'
		})
	}

	var payments = (inv.payments || []).map((pay) => {
		var bits = []
		if (pay.date) bits.push(fmtDate(pay.date))
		if (pay.method) bits.push(splitMethodLabel(pay.method))
		if (pay.reference) bits.push(String(pay.reference))
		return {
			left: bits.length ? bits.join(' · ') : labels.paymentFallback,
			amount: pay.amount == null ? '–' : fmtMoney(pay.amount, cur)
		}
	})

	var sections = (inv.statements || []).map((st) => ({
		sectionTitle: st.section_title || '',
		servicePeriod: st.service_period || '',
		lineItems: (st.line_items || []).map((raw, i) => {
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
				rowClass: kind === 'discount' ? 'inv-line inv-line-discount' : 'inv-line'
			}
		})
	}))

	return {
		labels: labels,
		invoiceNumber: header.invoice_number || '',
		grandTotal: fmtMoney(totals.invoice_total, cur),
		docKind: header.document_kind ? String(header.document_kind).replace(/_/g, ' ') : '',
		issueDate: fmtDate(header.issue_date),
		dueDate: fmtDate(header.due_date),
		orderNumber: header.order_number || '',
		customerNumber: header.customer_number || '',
		vendor: buildPartyCard(labels.vendorRole, inv.vendor),
		buyer: buildPartyCard(labels.buyerRole, inv.buyer),
		sections: sections,
		totalRows: totalRows,
		payments: payments,
		outstanding: fmtMoney(inv.total_outstanding, cur),
		paymentInstructions: inv.payment_instructions ? String(inv.payment_instructions).trim() : ''
	}
}

// ---------------------------------------------------------------------------
// State assembly
// ---------------------------------------------------------------------------

function buildState(source, selectedId) {
	source = source || {}
	var listLabels = mergeListLabels(source)
	var txData = source.transfers || []
	if ((selectedId == null || !findTx(txData, selectedId)) && txData.length) {
		selectedId = txData[0].id
	}
	var selected = findTx(txData, selectedId)
	var transfers = txData.map((tx) => buildRow(tx, selectedId))
	return {
		labels: listLabels,
		title: source.title || 'Überweisungen',
		count: String(txData.length),
		selectedId: selectedId || '',
		hasSelection: !!selected,
		isEmpty: txData.length === 0,
		emptyMessage: listLabels.emptyList,
		detailEmptyMessage: listLabels.detailEmpty,
		transfers: transfers,
		txData: txData,
		detail: buildDetail(selected ? selected.invoice : {})
	}
}

function initState(source) {
	return buildState(source, null)
}

function handleEvent(type, payload, state) {
	payload = payload || {}
	if (type === 'SELECT_TX') {
		var source = { transfers: state.txData, title: state.title, labels: state.labels }
		return buildState(source, payload.id)
	}
	return state
}
