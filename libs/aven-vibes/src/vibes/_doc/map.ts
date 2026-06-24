import type { DocCard, DocColumn, DocKvRow, DocRow, DocSection } from './types.js'

// Generic helpers shared by every per-type mapper. They keep the mappers tiny and guarantee the
// engine's invariants (no empty class strings; absent kinds are [] not undefined). board 0064.

/** Narrow arbitrary extracted JSON to an object (or {}). */
export function rec(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Narrow arbitrary extracted JSON to an array (or []). */
export function arr(v: unknown): unknown[] {
	return Array.isArray(v) ? v : []
}

/** Format any scalar as display text; null/undefined → "—". */
export function txt(v: unknown): string {
	if (v === null || v === undefined || v === '') return '—'
	return String(v)
}

/** Safe scalar → trimmed string. Objects/arrays/null → "" (NEVER "[object Object]"). This is the
 *  guard that keeps a model returning a nested/odd shape from leaking raw labels into the UI. */
export function str(v: unknown): string {
	if (typeof v === 'string') return v.trim()
	if (typeof v === 'number' && Number.isFinite(v)) return String(v)
	return ''
}

/** Join non-empty scalar parts with a separator. */
function joinStr(parts: unknown[], sep = ' '): string {
	return parts.map(str).filter(Boolean).join(sep)
}

/** Format a number as money-ish text; null → "—". `cur` is an optional currency suffix. */
export function money(v: unknown, cur?: string | null): string {
	if (v === null || v === undefined || v === '') return '—'
	const n = typeof v === 'number' ? v : Number(v)
	if (Number.isNaN(n)) return String(v)
	const s = n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
	return cur ? `${s} ${cur}` : s
}

/** A kv row, dropping empty pairs is the caller's job (this always returns one). */
export function kv(k: string, v: unknown): DocKvRow {
	return { k, v: txt(v) }
}

/** Build a kv list from [label, value] pairs, skipping pairs whose value is empty/null. */
export function kvList(pairs: [string, unknown][]): DocKvRow[] {
	return pairs
		.filter(([, v]) => v !== null && v !== undefined && v !== '')
		.map(([k, v]) => kv(k, v))
}

/** A card: a heading + an optional emphasized name + detail lines (only non-empty strings kept). */
export function card(title: string, lines: (string | null | undefined)[], name = ''): DocCard {
	return {
		title,
		name: str(name),
		lines: lines
			.filter((l): l is string => typeof l === 'string' && l.trim() !== '')
			.map((line) => ({ line }))
	}
}

/** Pull "label: value" identifier rows from an array of {label_printed|category, value} objects. */
function identifierLines(list: unknown): string[] {
	return arr(list)
		.map((raw) => {
			const i = rec(raw)
			const value = str(i.value)
			if (!value) return ''
			const label = str(i.label_printed) || str(i.category) || 'ID'
			return `${label}: ${value}`
		})
		.filter(Boolean)
}

/** Pull "IBAN … · BIC …" + creditor-id lines from a banking-accounts array. */
function bankLines(list: unknown): string[] {
	const out: string[] = []
	for (const raw of arr(list)) {
		const b = rec(raw)
		const iban = str(b.iban)
		const bic = str(b.bic)
		if (iban) out.push(bic ? `IBAN: ${iban} · BIC: ${bic}` : `IBAN: ${iban}`)
		else if (bic) out.push(`BIC: ${bic}`)
		if (str(b.creditor_identifier)) out.push(`Gläubiger-ID: ${str(b.creditor_identifier)}`)
	}
	return out
}

/**
 * A party / address card from the common party shape. Pulls as much as the document offers — full
 * address, contact, tax id, bank/SEPA blocks, and register/VAT identifiers — using `str()` so a
 * model returning a nested or odd shape can NEVER leak a raw "field: value" blob into the card.
 */
export function partyCard(title: string, party: unknown): DocCard {
	const p = rec(party)
	const bank = rec(p.bank)
	const opr = rec(p.org_public_record)
	const lines: (string | null)[] = [
		// Address
		str(p.street) || null,
		joinStr([p.postal_code, p.city]) || null,
		str(p.country) || null,
		// Contact
		str(p.contact_name) ? `Ansprechpartner: ${str(p.contact_name)}` : null,
		str(p.email) || null,
		str(p.phone) || null,
		// Tax / registration
		str(p.tax_id) ? `USt-IdNr.: ${str(p.tax_id)}` : null,
		// Bank (single block) + all SEPA/banking accounts
		str(bank.iban)
			? str(bank.bic)
				? `IBAN: ${str(bank.iban)} · BIC: ${str(bank.bic)}`
				: `IBAN: ${str(bank.iban)}`
			: null,
		...bankLines(p.banking_accounts),
		// Identifiers: top-level + imprint (VAT, HRB, …) + extra contact channels
		...identifierLines(p.identifiers),
		...identifierLines(opr.identifiers),
		...arr(opr.contact_channels).map((raw) => {
			const c = rec(raw)
			return str(c.value) ? `${str(c.channel) || 'Kontakt'}: ${str(c.value)}` : ''
		})
	]
	// De-dupe (models sometimes repeat a line) while preserving order.
	const seen = new Set<string>()
	const deduped = lines.filter((l): l is string => {
		if (!l || seen.has(l)) return false
		seen.add(l)
		return true
	})
	return card(title, deduped, str(p.name))
}

const ALIGN_TH = 'doc-th'
const ALIGN_TH_NUM = 'doc-th doc-num'
const ALIGN_TD = 'doc-td'
const ALIGN_TD_NUM = 'doc-td doc-num'

/** Column definitions from [label, isNumeric?] tuples. */
export function columns(defs: [string, boolean?][]): DocColumn[] {
	return defs.map(([label, num]) => ({ label, align: num ? ALIGN_TH_NUM : ALIGN_TH }))
}

/** A table row from cell values; `numericFlags` marks which cells are right-aligned numbers. */
export function row(cells: unknown[], numericFlags: boolean[] = []): DocRow {
	return {
		cells: cells.map((c, i) => ({ text: txt(c), align: numericFlags[i] ? ALIGN_TD_NUM : ALIGN_TD }))
	}
}

/** Assemble a section, defaulting every unused kind to []. */
export function section(title: string, parts: Partial<Omit<DocSection, 'title'>> = {}): DocSection {
	return {
		title,
		cards: parts.cards ?? [],
		rows: parts.rows ?? [],
		columns: parts.columns ?? [],
		tableRows: parts.tableRows ?? []
	}
}
