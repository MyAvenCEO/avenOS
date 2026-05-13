import { App } from '@modelcontextprotocol/ext-apps'

import { bankStatementDemoToolArguments } from './demo-bank-statement'
import './bank-statement.css'

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

const STATEMENT_KIND_LABELS: Record<string, string> = {
	periodic_account_statement: 'Periodic account statement',
	fee_or_service_statement: 'Fee or service statement',
	credit_card_statement: 'Credit card statement',
	savings_account_statement: 'Savings account statement',
	other: 'Other'
}

function statementKindLabel(k: unknown): string {
	if (k == null || typeof k !== 'string' || !k.trim()) return 'Bank statement'
	return STATEMENT_KIND_LABELS[k] ?? k.replace(/_/g, ' ')
}

function isBankStatementPayload(x: unknown): x is UnknownRecord {
	if (!isRecord(x)) return false
	const cur = x.currency
	const holder = x.account_holder
	const inst = x.institution
	const overview = x.account_overview
	const tx = x.transactions
	if (typeof cur !== 'string' || !cur.trim()) return false
	if (!isRecord(holder) || typeof holder.name !== 'string') return false
	if (!isRecord(inst) || typeof inst.name !== 'string') return false
	if (!isRecord(overview)) return false
	if (!Array.isArray(tx)) return false
	return true
}

function renderPartyCard(party: UnknownRecord, roleTitle: string, footerHtml = ''): string {
	const name = typeof party.name === 'string' ? party.name : '–'
	const contact = typeof party.contact_name === 'string' ? party.contact_name.trim() : ''
	const contactBlock = contact
		? `<div class="muted" style="margin-top:4px">Contact: ${esc(contact)}</div>`
		: ''
	const street = typeof party.street === 'string' ? party.street : ''
	const pc = typeof party.postal_code === 'string' ? party.postal_code : ''
	const city = typeof party.city === 'string' ? party.city : ''
	const country = typeof party.country === 'string' ? party.country : ''
	const plzCity = [pc, city].filter(Boolean).join(' ')
	const addrBits: string[] = []
	if (street) addrBits.push(`<div class="line">${esc(street)}</div>`)
	if (plzCity) addrBits.push(`<div class="line">${esc(plzCity)}</div>`)
	if (country) addrBits.push(`<div class="muted">${esc(country)}</div>`)
	const addressBlock = addrBits.length ? addrBits.join('') : ''
	const email = party.email
	const phone = party.phone
	const tax = party.tax_id
	const taxLine =
		typeof tax === 'string' && tax.trim()
			? `<div class="muted" style="margin-top:6px">${esc(tax.trim())}</div>`
			: ''
	return `<div class="bs-card">
  <h4>${esc(roleTitle)}</h4>
  <div class="big">${esc(name)}</div>
  ${contactBlock}
  ${addressBlock}
  ${typeof email === 'string' && email ? `<div class="muted">${esc(email)}</div>` : ''}
  ${typeof phone === 'string' && phone ? `<div class="muted">${esc(phone)}</div>` : ''}
  ${taxLine}
  ${footerHtml}
</div>`
}

function renderTxnRows(transactions: unknown[], cur: string): string {
	return transactions
		.map((raw) => {
			if (!isRecord(raw)) return ''
			const booking = fmtDate(raw.booking_date)
			const valueD = fmtDate(raw.value_date)
			const title = typeof raw.title === 'string' ? raw.title.trim() : ''
			const desc = typeof raw.description === 'string' ? raw.description.trim() : ''
			let descCell = ''
			if (title && desc) {
				descCell = `<div class="bs-desc-title">${esc(title)}</div><div class="bs-desc-body">${esc(desc)}</div>`
			} else if (title) {
				descCell = `<div class="bs-desc-title">${esc(title)}</div>`
			} else {
				descCell = `<div class="bs-desc-body">${esc(desc)}</div>`
			}
			const amt = raw.amount
			const amtNum = typeof amt === 'number' && !Number.isNaN(amt) ? amt : null
			const amtCls = amtNum != null && amtNum < 0 ? 'num num--neg' : 'num'
			const fxBits: string[] = []
			if (raw.original_amount != null && raw.original_currency) {
				fxBits.push(
					`${fmtMoney(raw.original_amount, String(raw.original_currency))} · rate ${esc(raw.exchange_rate ?? '–')}`
				)
			}
			if (raw.fx_surcharge_eur != null && typeof raw.fx_surcharge_eur === 'number') {
				fxBits.push(`FX fee EUR ${fmtMoney(raw.fx_surcharge_eur, cur)}`)
			}
			if (
				raw.foreign_exchange_fee_percent != null &&
				typeof raw.foreign_exchange_fee_percent === 'number'
			) {
				fxBits.push(`${fmtNum(raw.foreign_exchange_fee_percent)}% conv.`)
			}
			const fxHtml = fxBits.length ? `<div class="bs-fx-hint">${esc(fxBits.join(' · '))}</div>` : ''
			const bal = raw.balance_after
			const rate = raw.exchange_rate
			return `<tr>
  <td>${esc(booking)}</td>
  <td>${esc(valueD)}</td>
  <td>${descCell}${fxHtml}</td>
  <td class="${amtCls}">${fmtMoney(amt, cur)}</td>
  <td class="num">${bal != null && typeof bal === 'number' ? fmtMoney(bal, cur) : '–'}</td>
  <td class="num">${rate != null && String(rate).trim() ? esc(String(rate)) : '–'}</td>
</tr>`
		})
		.join('')
}

let state: UnknownRecord = cloneJson(bankStatementDemoToolArguments)

const $root = byId<HTMLElement>('doc-root')

const app = new App({ name: 'Aven Bank statement viewer', version: '1.0.0' })

function render() {
	if (!isBankStatementPayload(state)) {
		$root.innerHTML =
			'<div class="bs-ui-container"><div class="empty-doc" style="padding:2rem;text-align:center;color:var(--muted)">Invalid bank statement payload.</div></div>'
		return
	}

	const cur = typeof state.currency === 'string' ? state.currency : 'EUR'
	const kindLabel = statementKindLabel(state.statement_kind)
	const periodFrom = fmtDate(state.period_start)
	const periodTo = fmtDate(state.period_end)
	const issueD = fmtDate(state.statement_issue_date)
	const dueD = fmtDate(state.payment_due_date)
	const stmtId =
		typeof state.statement_id === 'string' && state.statement_id.trim()
			? state.statement_id.trim()
			: ''
	const openB = state.opening_balance
	const closeB = state.closing_balance
	const overview = isRecord(state.account_overview) ? state.account_overview : {}
	const iban = typeof overview.iban === 'string' ? overview.iban.trim() : ''

	const heroLeft = stmtId
		? `<div><div class="bs-banner-title">${esc(stmtId)}</div><div class="bs-banner-sub">Statement ID</div></div>`
		: `<div><div class="bs-banner-title">Bank statement</div><div class="bs-banner-sub">Document</div></div>`

	const heroRight =
		closeB != null && typeof closeB === 'number'
			? `<div class="bs-banner-money"><div>${fmtMoney(closeB, cur)}</div><div class="bs-banner-sub">Closing balance</div></div>`
			: ''

	const line2Rows: string[] = []
	const line3Rows: string[] = []
	function addField(target: string[], label: string, val: unknown, money = false, nowrap = false) {
		if (val == null) return
		if (typeof val === 'number' && Number.isNaN(val)) return
		const shown =
			money && typeof val === 'number'
				? fmtMoney(val, cur)
				: typeof val === 'string'
					? val
					: String(val)
		if (typeof shown === 'string' && !shown.trim()) return
		const cellMod = nowrap ? ' bs-field-cell--nowrap' : ''
		target.push(
			`<div class="bs-field-cell${cellMod}"><div class="bs-field-val">${esc(shown)}</div><div class="bs-field-label">${esc(label)}</div></div>`
		)
	}

	const periodRange =
		periodFrom && periodTo ? `${periodFrom} – ${periodTo}` : periodFrom || periodTo || null

	/* Line 3: same value / label grid as line 2 (compact). Statement kind first, flush-left grid. */
	addField(line3Rows, 'Statement kind', kindLabel)
	addField(line3Rows, 'Period', periodRange)
	addField(line3Rows, 'Opening balance', openB, true)
	addField(line3Rows, 'Issue date', issueD || null)
	addField(line3Rows, 'Payment due', dueD || null)

	/* Line 2: account / routing; IBAN last. */
	addField(line2Rows, 'BIC / SWIFT', overview.bic)
	addField(line2Rows, 'Bank code', overview.domestic_bank_code)
	addField(line2Rows, 'Account number', overview.account_number)
	addField(line2Rows, 'Product', overview.product_name)
	addField(line2Rows, 'Card (last 4)', overview.card_last_four)
	addField(line2Rows, 'IBAN', iban || null, false, true)

	const bannerLine2 =
		line2Rows.length > 0
			? `<div class="bs-banner-fields bs-banner-fields--compact">${line2Rows.join('')}</div>`
			: ''

	const bannerLine3 =
		line3Rows.length > 0
			? `<div class="bs-banner-fields bs-banner-fields--compact">${line3Rows.join('')}</div>`
			: ''

	const banner = `<div class="bs-banner">
  <header class="bs-banner-header">
    <div class="bs-banner-hero">
      ${heroLeft}
      ${heroRight}
    </div>
  </header>
  <div class="bs-banner-subheader">
    ${bannerLine2}
    ${bannerLine3}
  </div>
</div>`

	const holder = isRecord(state.account_holder) ? state.account_holder : {}
	const inst = isRecord(state.institution) ? state.institution : {}
	const branchFooter =
		typeof overview.branch_name === 'string' && overview.branch_name.trim()
			? `<div class="muted" style="margin-top:8px">Branch: ${esc(overview.branch_name.trim())}</div>`
			: ''
	const instCard = renderPartyCard(inst, 'Institution', branchFooter)

	const parties = `<div class="bs-grid">${renderPartyCard(holder, 'Account holder')}${instCard}</div>`

	const tx = state.transactions as unknown[]
	const txBody = renderTxnRows(tx, cur)
	const table = txBody
		? `<div class="bs-items-wrap"><table class="bs-items" aria-label="Transactions">
<thead><tr>
  <th>Booking date</th>
  <th>Value date</th>
  <th>Description</th>
  <th class="num">Amount</th>
  <th class="num">Balance</th>
  <th class="num">FX rate</th>
</tr></thead><tbody>${txBody}</tbody></table></div>`
		: ''

	const notesRaw = state.notes
	const notesBlock =
		typeof notesRaw === 'string' && notesRaw.trim()
			? `<div class="bs-card"><h4>Notes</h4><div class="bs-notes">${esc(notesRaw.trim())}</div></div>`
			: ''

	$root.innerHTML = `<div class="bs-ui-container">${banner}${parties}${table}${notesBlock}</div>`
}

async function pushModelContext() {
	const summary =
		isBankStatementPayload(state) &&
		typeof state.statement_id === 'string' &&
		state.statement_id.trim()
			? `Statement ${state.statement_id.trim()}`
			: 'Bank statement'
	await app.updateModelContext({
		structuredContent: state as Record<string, unknown>,
		content: [{ type: 'text', text: summary }]
	})
}

function applyConfig(cfg: unknown) {
	if (!isBankStatementPayload(cfg)) return
	state = cloneJson(cfg as UnknownRecord)
	render()
	void pushModelContext()
}

app.ontoolinput = (params) => applyConfig(params.arguments)
app.ontoolresult = (result) => {
	const sc = result.structuredContent
	if (sc && isBankStatementPayload(sc)) applyConfig(sc)
}

void app.connect()
render()
void pushModelContext()
