import { App } from '@modelcontextprotocol/ext-apps'

import { invoiceDemoToolArguments } from './demo-invoice'
import './ocr-invoice.css'

type UnknownRecord = Record<string, unknown>

function cloneJson<T>(x: T): T {
	return JSON.parse(JSON.stringify(x)) as T
}

function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id)
	if (!el) throw new Error(`Missing #${id}`)
	return el as T
}

function esc(s: unknown): string {
	if (s == null) return ''
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function fmtNum(n: number): string {
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n)
}

function fmtDate(s: unknown): string {
	if (s == null || typeof s !== 'string' || !s.trim()) return ''
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
	if (m) {
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
		if (!Number.isNaN(d.getTime())) {
			return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
		}
	}
	return s.trim()
}

function fmtMoney(n: unknown, currency: string): string {
	if (n == null || typeof n !== 'number' || Number.isNaN(n)) return '–'
	try {
		return new Intl.NumberFormat('de-DE', {
			style: 'currency',
			currency: currency || 'EUR'
		}).format(n)
	} catch {
		return `${fmtNum(n)} ${currency}`
	}
}

function isRecord(x: unknown): x is UnknownRecord {
	return typeof x === 'object' && x !== null
}

function isInvoicePayload(x: unknown): x is UnknownRecord {
	if (!isRecord(x)) return false
	const v = x.vendor
	const h = x.header
	const stmts = x.statements
	if (!isRecord(v) || typeof v.name !== 'string') return false
	if (!isRecord(h) || h.document_kind == null) return false
	return Array.isArray(stmts)
}

function invBannerField(valueHtml: string, labelHuman: string): string {
	const lab = labelHuman.trim().toUpperCase()
	return `<div class="inv-banner-field"><div class="inv-banner-value inv-banner-field-value">${valueHtml}</div><div class="inv-banner-sublabel">${esc(lab)}</div></div>`
}

let state: UnknownRecord = cloneJson(invoiceDemoToolArguments)

const $root = byId<HTMLElement>('doc-root')

const app = new App({ name: 'Aven Invoice viewer', version: '1.0.0' })

function renderPartyCard(party: unknown, roleTitle: string): string {
	if (!isRecord(party)) return ''
	const name = typeof party.name === 'string' ? party.name : '–'
	const nameInner = `<span class="inv-party-name-text">${esc(name)}</span>`
	const contact = typeof party.contact_name === 'string' ? party.contact_name.trim() : ''
	const contactBlock = contact
		? `<div class="party-representative-line" role="group" aria-label="Ansprechpartner"><div class="party-representative-sublabel muted">Ansprechpartner</div><div class="inv-party-rep-name">${esc(contact)}</div></div>`
		: ''
	const street = typeof party.street === 'string' ? party.street : ''
	const pc = typeof party.postal_code === 'string' ? party.postal_code : ''
	const city = typeof party.city === 'string' ? party.city : ''
	const country = typeof party.country === 'string' ? party.country : ''
	const plzCity = [pc, city].filter(Boolean).join(' ')
	const addrBits: string[] = []
	if (street) {
		addrBits.push(
			`<div class="line inv-party-addr-line" style="white-space:pre-line">${esc(street)}</div>`
		)
	}
	if (plzCity) addrBits.push(`<div class="line inv-party-addr-line">${esc(plzCity)}</div>`)
	if (country) addrBits.push(`<div class="line muted inv-party-addr-line">${esc(country)}</div>`)
	const addressBlock = addrBits.length
		? `<div class="inv-party-address-block">${addrBits.join('')}</div>`
		: ''

	const idents = party.identifiers
	let idHtml = ''
	if (Array.isArray(idents)) {
		for (const row of idents) {
			if (!isRecord(row)) continue
			const v = row.value
			if (typeof v !== 'string' || !v.trim()) continue
			const lp = row.label_printed
			idHtml += `<div class="party-org-id-line">${lp ? `<span class="party-org-id-label">${esc(String(lp))}: </span>` : ''}<span class="party-org-id-value">${esc(v)}</span></div>`
		}
	}

	const email = party.email
	const phone = party.phone
	return `<div class="invoice-card">
  <h4>${esc(roleTitle)}</h4>
  <div class="big inv-party-name-line">${nameInner}</div>
  ${contactBlock}
  ${addressBlock}
  ${typeof email === 'string' && email ? `<div class="muted">${esc(email)}</div>` : ''}
  ${typeof phone === 'string' && phone ? `<div class="muted">${esc(phone)}</div>` : ''}
  ${idHtml}
</div>`
}

function renderTaxBreakdownRow(r: UnknownRecord, cur: string): string {
	const p = r.tax_rate_percent
	const g =
		r.tax_group_letter != null && String(r.tax_group_letter).trim() !== ''
			? String(r.tax_group_letter).trim().charAt(0)
			: ''
	const tx =
		r.tax_rate_text != null && String(r.tax_rate_text).trim() !== ''
			? String(r.tax_rate_text).trim()
			: ''
	const hasPct = p != null && p !== '' && !Number.isNaN(Number(p))
	let lab = 'Tax'
	if (hasPct) {
		const n = Number(p)
		lab = `Tax ${fmtNum(n)}%`
		const letter = g && /^[A-Za-z]$/.test(g) ? g : tx && /^[A-Za-z]$/.test(tx) ? tx : ''
		if (letter) lab = `${lab} (${letter})`
		else if (tx && !/^[A-Za-z]$/.test(tx) && !tx.startsWith(String(n))) {
			lab = `${lab} — ${tx}`
		}
	} else if (tx) {
		lab = `Tax ${tx}`
	}
	const amt =
		r.tax_amount != null && typeof r.tax_amount === 'number' ? fmtMoney(r.tax_amount, cur) : '–'
	const netGrossSub =
		r.net_subtotal != null || r.gross_subtotal != null
			? `<span class="inv-totals-line__tax-sub">${[
					r.net_subtotal != null ? `Net ${fmtMoney(r.net_subtotal, cur)}` : null,
					r.gross_subtotal != null ? `Brutto ${fmtMoney(r.gross_subtotal, cur)}` : null
				]
					.filter(Boolean)
					.join(' · ')}</span>`
			: ''
	const html = `<div class="row inv-totals-line inv-totals-line--tax-rate"><span class="inv-totals-line__tax-labcell"><span class="inv-totals-line__tax-main">${esc(lab)}</span>${netGrossSub}</span><span class="num">${amt}</span></div>`
	return html
}

function renderLineRows(lineItems: unknown, cur: string): string {
	if (!Array.isArray(lineItems)) return ''
	return lineItems
		.map((raw, i) => {
			if (!isRecord(raw)) return ''
			const kind =
				raw.line_kind != null && String(raw.line_kind).trim() !== ''
					? String(raw.line_kind).trim()
					: ''
			const trCls = kind ? `inv-line inv-line-${kind.replace(/[^a-z0-9_-]/gi, '_')}` : 'inv-line'
			const pos = raw.position
			const art = raw.article_number
			const title = typeof raw.title === 'string' ? raw.title.trim() : ''
			const desc = typeof raw.description === 'string' ? raw.description.trim() : ''
			let descCell = ''
			if (title && desc) {
				descCell = `<div class="inv-line-item-primary">${esc(title)}</div><div class="inv-line-item-secondary">${esc(desc)}</div>`
			} else if (title) {
				descCell = `<div class="inv-line-item-primary">${esc(title)}</div>`
			} else {
				descCell = `<div class="inv-line-item-secondary">${esc(desc)}</div>`
			}
			const qty = raw.quantity
			const unit = raw.quantity_unit
			const up = raw.unit_price
			const taxPct = raw.tax_rate_percent
			const g =
				raw.tax_group_letter != null && String(raw.tax_group_letter).trim() !== ''
					? String(raw.tax_group_letter).trim().charAt(0)
					: ''
			let taxCell = '–'
			if (taxPct != null && taxPct !== '' && !Number.isNaN(Number(taxPct))) {
				const main = `${fmtNum(Number(taxPct))}%`
				const extra =
					g && /^[A-Za-z]$/.test(g)
						? ` <span class="muted" title="POS tax group">(${esc(g)})</span>`
						: ''
				taxCell = `${main}${extra}`
			}
			const amt = raw.amount
			return `<tr class="${trCls}">
  <td class="idx">${i + 1}</td>
  <td>${pos != null ? esc(pos) : ''}</td>
  <td>${art != null ? esc(art) : ''}</td>
  <td>${descCell}</td>
  <td class="num">${qty != null && typeof qty === 'number' ? fmtNum(qty) : esc(qty)}</td>
  <td>${unit != null ? esc(unit) : ''}</td>
  <td class="num">${fmtMoney(up, cur)}</td>
  <td class="num">${taxCell}</td>
  <td class="num">${fmtMoney(amt, cur)}</td>
</tr>`
		})
		.join('')
}

function renderEmbeddedTotals(totals: unknown, cur: string): string {
	if (!isRecord(totals)) return ''
	const sub = totals.subtotal
	const tb = totals.tax_breakdown
	const taxTotal = totals.tax_total
	const invTotal = totals.invoice_total

	const hasBreakdown = Array.isArray(tb) && tb.length > 0
	let bdHtml = ''
	if (hasBreakdown) {
		for (const row of tb as unknown[]) {
			if (!isRecord(row)) continue
			bdHtml += renderTaxBreakdownRow(row, cur)
		}
	}

	let taxLabel = 'Tax total'
	if (
		!hasBreakdown &&
		typeof sub === 'number' &&
		sub > 0 &&
		typeof taxTotal === 'number' &&
		taxTotal > 0
	) {
		const implied = (taxTotal / sub) * 100
		if (implied > 0.05 && implied < 99.95) {
			taxLabel = `Tax total · ≈${fmtNum(Math.round(implied * 10) / 10)}%`
		}
	} else if (hasBreakdown && Array.isArray(tb) && tb.length === 1 && isRecord(tb[0])) {
		const p = tb[0].tax_rate_percent
		if (p != null && !Number.isNaN(Number(p))) {
			taxLabel = `Tax total · ${fmtNum(Number(p))}%`
		}
	}

	const taxRowCls = hasBreakdown
		? 'row inv-totals-line inv-totals-line--tax-total-sum'
		: 'row inv-totals-line inv-totals-line--tax'
	const taxAmt = taxTotal != null ? fmtMoney(taxTotal, cur) : '–'

	const parts: string[] = []
	if (sub != null) {
		parts.push(
			`<div class="row inv-totals-line inv-totals-line--subtotal"><span>Subtotal (net)</span><span class="num">${fmtMoney(sub, cur)}</span></div>`
		)
	}
	parts.push(bdHtml)
	parts.push(
		`<div class="${taxRowCls}"><span>${esc(taxLabel)}</span><span class="num">${taxAmt}</span></div>`
	)
	if (invTotal != null) {
		parts.push(
			`<div class="row inv-totals-line inv-totals-line--invoice-total"><span>Invoice total</span><span class="num">${fmtMoney(invTotal, cur)}</span></div>`
		)
	}
	return parts.join('')
}

function renderPaymentsSection(payments: unknown, cur: string): string {
	if (!Array.isArray(payments) || !payments.length) return ''
	const rows = payments
		.map((p) => {
			if (!isRecord(p)) return ''
			const bits: string[] = []
			if (p.date) bits.push(`<strong>${esc(fmtDate(p.date))}</strong>`)
			if (p.method) {
				const m = String(p.method).replace(/([A-Za-zÀ-ÿ])(?=\d)/g, '$1 ')
				bits.push(esc(m))
			}
			if (p.reference) bits.push(`<span class="muted">${esc(String(p.reference))}</span>`)
			const left = bits.length ? bits.join(' · ') : '<span class="muted">(payment)</span>'
			const right = p.amount == null ? '–' : fmtMoney(p.amount, cur)
			return `<div class="row"><span>${left}</span><span class="num">${right}</span></div>`
		})
		.join('')
	return `<div class="invoice-bundle-label" style="margin:0 0 6px 0">Payments</div>${rows}`
}

function renderOutstandingBlock(v: number, cur: string): string {
	return `<div class="invoice-financials__outstanding" role="group" aria-label="Total outstanding">
  <div class="invoice-root-outstanding-inner">
    <span class="invoice-root-outstanding-label">Total outstanding</span>
    <span class="invoice-root-outstanding-value">${fmtMoney(v, cur)}</span>
  </div>
</div>`
}

function renderPaymentInstructions(text: string): string {
	return `<div class="invoice-card" style="margin-top:16px">
  <h4>Payment instructions</h4>
  <div class="line" style="white-space:pre-line">${esc(text)}</div>
</div>`
}

function render() {
	if (!isInvoicePayload(state)) {
		$root.innerHTML =
			'<div class="invoice-ui-container"><div class="empty-doc" style="padding:2rem;text-align:center;color:var(--muted)">Invalid invoice payload.</div></div>'
		return
	}

	const header = state.header
	const cur = isRecord(header) && typeof header.currency === 'string' ? header.currency : 'EUR'
	const invNum =
		isRecord(header) && typeof header.invoice_number === 'string' && header.invoice_number.trim()
			? header.invoice_number.trim()
			: ''
	const totals = state.totals
	let grand: number | null = null
	if (isRecord(totals) && typeof totals.invoice_total === 'number') grand = totals.invoice_total

	const docKind =
		isRecord(header) && header.document_kind != null
			? String(header.document_kind).replace(/_/g, ' ')
			: ''

	const issueD = isRecord(header) ? header.issue_date : null
	const dueD = isRecord(header) ? header.due_date : null
	const orderN = isRecord(header) ? header.order_number : null
	const custN = isRecord(header) ? header.customer_number : null
	const refs = isRecord(header) ? header.referenced_invoice_numbers : null

	let heroRow = ''
	if (invNum || grand != null) {
		const left =
			invNum &&
			`<div class="inv-banner-hero-left inv-banner-hero-invoice">
  <div class="inv-banner-value inv-banner-kind">${esc(invNum)}</div>
  <div class="inv-banner-sublabel">Rechnungs-Nr.</div>
</div>`
		const right =
			grand != null
				? `<div class="inv-banner-hero-right">
  <div class="inv-banner-value inv-banner-money">${fmtMoney(grand, cur)}</div>
  <div class="inv-banner-sublabel">Gesamtbetrag</div>
</div>`
				: ''
		heroRow = `<div class="inv-banner-hero-row${invNum ? '' : ' inv-banner-hero-only-right'}">${left || '<div></div>'}${right}</div>`
	}

	const midRightBits: string[] = []
	if (dueD) midRightBits.push(invBannerField(esc(fmtDate(dueD)), 'Fällig'))
	if (issueD) midRightBits.push(invBannerField(esc(fmtDate(issueD)), 'Ausstellungsdatum'))
	if (Array.isArray(refs) && refs.length) {
		midRightBits.push(invBannerField(refs.map((r) => esc(String(r))).join(' · '), 'Referenz'))
	}

	let midRow = ''
	if (docKind && midRightBits.length) {
		midRow = `<div class="inv-banner-mid inv-banner-mid--compact">
  <div class="inv-banner-mid-left">
    <div class="inv-banner-compact-value">${esc(docKind)}</div>
    <div class="inv-banner-compact-sublabel">Belegart</div>
  </div>
  <div class="inv-banner-mid-dates inv-banner-mid-dates--merged">${midRightBits.join('')}</div>
</div>`
	} else if (docKind) {
		midRow = `<div class="inv-banner-mid inv-banner-mid--compact">
  <div class="inv-banner-mid-left">
    <div class="inv-banner-compact-value">${esc(docKind)}</div>
    <div class="inv-banner-compact-sublabel">Belegart</div>
  </div>
</div>`
	} else if (midRightBits.length) {
		midRow = `<div class="inv-banner-mid inv-banner-mid--compact">
  <div class="inv-banner-mid-dates inv-banner-mid-dates--merged" style="justify-content:flex-end;width:100%">${midRightBits.join('')}</div>
</div>`
	}

	const fieldBits: string[] = []
	if (orderN) fieldBits.push(invBannerField(esc(orderN), 'Auftrag / Projekt'))
	if (custN) fieldBits.push(invBannerField(esc(custN), 'Kundennr.'))

	const fieldsRow = fieldBits.length
		? `<div class="inv-banner-fields-row">${fieldBits.join('')}</div>`
		: ''

	const banner =
		heroRow || midRow || fieldsRow
			? `<div class="invoice-doc-banner">${heroRow}${midRow}${fieldsRow}</div>`
			: ''

	const parties = `<div class="invoice-grid">
  ${renderPartyCard(state.vendor, 'Lieferant')}
  ${renderPartyCard(state.buyer, 'Käufer')}
</div>`

	const stmts = Array.isArray(state.statements) ? state.statements : []
	let sectionsHtml = ''
	const singleStmt = stmts.length === 1
	for (let si = 0; si < stmts.length; si++) {
		const st = stmts[si]
		if (!isRecord(st)) continue
		const segClass = si > 0 ? ' invoice-segment' : ''
		const title = typeof st.section_title === 'string' ? st.section_title.trim() : ''
		const period = typeof st.service_period === 'string' ? st.service_period.trim() : ''
		let capInner = ''
		if (title && period) {
			capInner = `<div class="invoice-items-cap-title-row"><div class="invoice-cap-block invoice-cap-block--title">${esc(title)}</div><div class="invoice-items-cap-subline"><div class="invoice-cap-kv" role="group" aria-label="Leistungszeitraum"><span class="invoice-cap-k">LEISTUNGSZEITRAUM</span><span class="invoice-cap-v">${esc(period)}</span></div></div></div>`
		} else if (title) {
			capInner = `<div class="invoice-cap-block invoice-cap-block--title">${esc(title)}</div>`
		} else if (period) {
			capInner = `<div class="invoice-items-cap-title-row invoice-items-cap-title-row--subline-only"><div class="invoice-items-cap-subline"><div class="invoice-cap-kv" role="group" aria-label="Leistungszeitraum"><span class="invoice-cap-k">LEISTUNGSZEITRAUM</span><span class="invoice-cap-v">${esc(period)}</span></div></div></div>`
		}
		const cap = capInner
			? `<div class="invoice-items-cap invoice-items-cap--statement">${capInner}</div>`
			: ''
		const lineBody = renderLineRows(st.line_items, cur)
		const tbl = lineBody
			? `<table class="invoice-items" aria-label="Positionen"><thead><tr>
  <th class="idx">#</th>
  <th>Pos.</th>
  <th>Art.-Nr.</th>
  <th>Bezeichnung</th>
  <th class="num">Menge</th>
  <th>ME</th>
  <th class="num">Einzelpreis</th>
  <th class="num">USt. %</th>
  <th class="num">Betrag</th>
</tr></thead><tbody>${lineBody}</tbody></table>`
			: ''

		const itemsWrap =
			cap || tbl
				? `<div class="invoice-items-wrap invoice-items-wrap--unified">${cap}${tbl}</div>`
				: ''

		let financials = ''
		if (singleStmt) {
			const totalsHtml = renderEmbeddedTotals(isRecord(state) ? state.totals : {}, cur)
			const payHtml = renderPaymentsSection(state.payments, cur)
			const out = state.total_outstanding
			const outBlock = typeof out === 'number' ? renderOutstandingBlock(out, cur) : ''
			const finInner = [
				totalsHtml
					? `<div class="invoice-financials__section invoice-financials__section--totals"><div class="invoice-totals invoice-totals--embedded">${totalsHtml}</div></div>`
					: '',
				payHtml
					? `<div class="invoice-financials__section invoice-financials__section--payments">${payHtml}</div>`
					: '',
				outBlock
			].join('')
			if (finInner) {
				financials = `<div class="invoice-financials" role="group" aria-label="Zahlungen und Summen">${finInner}</div>`
			}
		}

		sectionsHtml += `<div class="invoice-block${segClass}">${itemsWrap}${financials}</div>`
	}

	const payInstr = state.payment_instructions
	const instrBlock =
		typeof payInstr === 'string' && payInstr.trim()
			? renderPaymentInstructions(payInstr.trim())
			: ''

	$root.innerHTML = `<div class="invoice-ui-container">${banner}${parties}${sectionsHtml}${instrBlock}</div>`
}

async function pushModelContext() {
	const summary =
		isInvoicePayload(state) &&
		isRecord(state.header) &&
		typeof state.header.invoice_number === 'string'
			? `Invoice ${state.header.invoice_number}`
			: 'Invoice'
	await app.updateModelContext({
		structuredContent: state as Record<string, unknown>,
		content: [{ type: 'text', text: summary }]
	})
}

function applyConfig(cfg: unknown) {
	if (!isInvoicePayload(cfg)) return
	state = cloneJson(cfg as UnknownRecord)
	render()
	void pushModelContext()
}

app.ontoolinput = (params) => applyConfig(params.arguments)
app.ontoolresult = (result) => {
	const sc = result.structuredContent
	if (sc && isInvoicePayload(sc)) applyConfig(sc)
}

void app.connect()
render()
void pushModelContext()
