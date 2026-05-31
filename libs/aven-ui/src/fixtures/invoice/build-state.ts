import demoSource from './demo-source.json'

type LineItemRaw = {
	position?: number | null
	article_number?: string | number | null
	title?: string
	description?: string
	line_kind?: string
	quantity?: number | string | null
	quantity_unit?: string | null
	unit_price?: number | null
	tax_rate_percent?: number | string | null
	amount?: number | null
}
type Party = {
	name?: string
	contact_name?: string
	street?: string
	postal_code?: string
	city?: string
	country?: string
	email?: string
	phone?: string
	identifiers?: Array<{ label_printed?: string; value?: string }>
}

type TableColumnLabel = { label: string; class?: string }

type InvoiceLabels = {
	invoiceNumber: string
	grandTotal: string
	docKind: string
	dueDate: string
	issueDate: string
	orderNumber: string
	customerNumber: string
	contactPerson: string
	servicePeriod: string
	lineItemsAria: string
	financialsAria: string
	outstanding: string
	payments: string
	paymentInfo: string
	vendorRole: string
	buyerRole: string
	paymentFallback: string
	subtotal: string
	taxTotal: string
	invoiceTotal: string
	taxPrefix: string
	tableColumns: TableColumnLabel[]
}

const DEFAULT_LABELS: InvoiceLabels = {
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

function mergeLabels(source: Partial<InvoiceLabels> | undefined): InvoiceLabels {
	if (!source) return DEFAULT_LABELS
	return {
		...DEFAULT_LABELS,
		...source,
		tableColumns: source.tableColumns?.length ? source.tableColumns : DEFAULT_LABELS.tableColumns,
	}
}

function fmtDate(s: string | null | undefined): string {
	if (!s?.trim()) return ''
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
	if (m) {
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
		if (!Number.isNaN(d.getTime())) {
			return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
		}
	}
	return s.trim()
}

function fmtMoney(n: number | null | undefined, currency = 'EUR'): string {
	if (n == null || Number.isNaN(n)) return '–'
	try {
		return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(n)
	} catch {
		return `${n} ${currency}`
	}
}

function fmtNum(n: number): string {
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n)
}

function buildPartyCard(role: string, party: Party) {
	const plzCity = [party.postal_code, party.city].filter(Boolean).join(' ')
	const addressLines: Array<{ line: string }> = []
	if (party.street) addressLines.push({ line: party.street })
	if (plzCity) addressLines.push({ line: plzCity })
	if (party.country) addressLines.push({ line: party.country })
	const identifiers = (party.identifiers ?? [])
		.filter((id) => id.value?.trim())
		.map((id) => ({
			label: id.label_printed ? `${id.label_printed}: ` : '',
			value: id.value ?? '',
		}))
	return {
		role,
		name: party.name ?? '–',
		contact: party.contact_name?.trim() ?? '',
		addressLines,
		email: party.email ?? '',
		phone: party.phone ?? '',
		identifiers,
	}
}

export function buildInvoiceState(source: typeof demoSource = demoSource): Record<string, unknown> {
	const cur = source.header?.currency ?? 'EUR'
	const header = source.header ?? {}
	const totals = source.totals ?? {}
	const labels = mergeLabels(source.labels as Partial<InvoiceLabels> | undefined)

	const totalRows: Array<{ label: string; value: string; rowClass: string }> = []
	if (totals.subtotal != null) {
		totalRows.push({
			label: labels.subtotal,
			value: fmtMoney(totals.subtotal, cur),
			rowClass: 'row inv-totals-line inv-totals-line--subtotal',
		})
	}
	for (const row of totals.tax_breakdown ?? []) {
		const p = row.tax_rate_percent
		let lab = labels.taxPrefix
		if (p != null && !Number.isNaN(Number(p))) {
			lab = `${labels.taxPrefix} ${fmtNum(Number(p))}%`
			if (row.tax_group_letter) lab = `${lab} (${String(row.tax_group_letter).charAt(0)})`
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

	const payments = (source.payments ?? []).map((p) => {
		const bits: string[] = []
		if (p.date) bits.push(fmtDate(p.date))
		if (p.method) bits.push(String(p.method).replace(/([A-Za-zÀ-ÿ])(?=\d)/g, '$1 '))
		if (p.reference) bits.push(String(p.reference))
		return {
			left: bits.length ? bits.join(' · ') : labels.paymentFallback,
			amount: p.amount == null ? '–' : fmtMoney(p.amount, cur),
		}
	})

	const sections = (source.statements ?? []).map((st) => ({
		sectionTitle: st.section_title ?? '',
		servicePeriod: st.service_period ?? '',
		lineItems: (st.line_items ?? []).map((raw: LineItemRaw, i) => {
			const kind = raw.line_kind ? String(raw.line_kind).trim() : ''
			const taxPct = raw.tax_rate_percent
			let tax = '–'
			if (taxPct != null && String(taxPct) !== '' && !Number.isNaN(Number(taxPct))) {
				tax = `${fmtNum(Number(taxPct))}%`
			}
			return {
				idx: String(i + 1),
				position: raw.position != null ? String(raw.position) : '',
				article: raw.article_number != null ? String(raw.article_number) : '',
				title: raw.title?.trim() ?? '',
				description: raw.description?.trim() ?? '',
				quantity:
					raw.quantity != null && typeof raw.quantity === 'number'
						? fmtNum(raw.quantity)
						: raw.quantity != null
							? String(raw.quantity)
							: '',
				unit: raw.quantity_unit ?? '',
				unitPrice: fmtMoney(raw.unit_price, cur),
				tax,
				amount: fmtMoney(raw.amount, cur),
				rowClass: kind === 'discount' ? 'inv-line inv-line-discount' : 'inv-line',
			}
		}),
	}))

	return {
		labels,
		invoiceNumber: header.invoice_number ?? '',
		grandTotal: fmtMoney(totals.invoice_total, cur),
		docKind: header.document_kind ? String(header.document_kind).replace(/_/g, ' ') : '',
		issueDate: fmtDate(header.issue_date),
		dueDate: fmtDate(header.due_date),
		orderNumber: header.order_number ?? '',
		customerNumber: header.customer_number ?? '',
		vendor: buildPartyCard(labels.vendorRole, source.vendor ?? {}),
		buyer: buildPartyCard(labels.buyerRole, source.buyer ?? {}),
		sections,
		totalRows,
		payments,
		outstanding: fmtMoney(source.total_outstanding, cur),
		paymentInstructions: source.payment_instructions?.trim() ?? '',
	}
}

export { demoSource }
