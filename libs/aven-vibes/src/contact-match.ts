import type { Contact } from './contact.js'

// board 0082 — harvest + match-make addressbook identities from an extracted document. After each doc
// extract the parties (an invoice's vendor + buyer, a statement's account holder) are pulled out,
// matched against existing contacts (by USt-IdNr, then IBAN, then normalized name), and either
// enriched (fill missing fields only) or created. Pure (no DOM/IO): the server does the persist.

export type PartyInput = {
	name?: string | null
	legal_form?: string | null
	type?: 'person' | 'company'
	street?: string | null
	zip?: string | null
	postal_code?: string | null
	city?: string | null
	country?: string | null
	email?: string | null
	phone?: string | null
	vat_id?: string | null
	tax_id?: string | null
	tax_number?: string | null
	iban?: string | null
	bic?: string | null
	bank_name?: string | null
	bank?: unknown
	banking_accounts?: unknown
	register_court?: string | null
	register_number?: string | null
	managing_director?: string | null
}

// Legal forms (structural, not vocabulary) stripped so "WaizmannTabelle GmbH" matches "WaizmannTabelle".
const LEGAL_FORMS = [
	'gmbh & co. kg',
	'gmbh & co kg',
	'gmbh',
	'mbh',
	'ug',
	'ag',
	'kgaa',
	'kg',
	'ohg',
	'gbr',
	'e.v.',
	'ev',
	'e.k.',
	'ek',
	'se',
	'llc',
	'inc',
	'ltd',
	'co',
	'corp',
	'company',
	'holding'
]

export function normalizeName(name: string | null | undefined): string {
	let s = (name ?? '').toLowerCase().replace(/[.,&]/g, ' ').replace(/\s+/g, ' ').trim()
	for (const lf of LEGAL_FORMS) {
		s = s.replace(new RegExp(`(^|\\s)${lf.replace(/[.]/g, '\\.')}(\\s|$)`, 'g'), ' ')
	}
	return s.replace(/\s+/g, ' ').trim()
}

function rec(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function firstBank(party: PartyInput): { iban?: string; bic?: string; bank_name?: string } {
	if (party.iban || party.bic || party.bank_name)
		return {
			iban: party.iban ?? undefined,
			bic: party.bic ?? undefined,
			bank_name: party.bank_name ?? undefined
		}
	const arr = Array.isArray(party.banking_accounts) ? party.banking_accounts : []
	const b = rec(arr[0])
	if (b.iban || b.bic)
		return {
			iban: typeof b.iban === 'string' ? b.iban : undefined,
			bic: typeof b.bic === 'string' ? b.bic : undefined,
			bank_name: [b.bank_name, b.name, b.bank].find((x) => typeof x === 'string') as
				| string
				| undefined
		}
	if (typeof party.bank === 'string') return { bank_name: party.bank }
	return {}
}

/** Map a doc party onto contact fields (USt-IdNr vs Steuernummer, postal_code→zip, banking→iban/bic). */
export function partyToContactFields(party: PartyInput): Partial<Contact> {
	const taxId = party.vat_id ?? party.tax_id ?? null
	const isVat = typeof taxId === 'string' && /^[A-Z]{2}[0-9A-Z]+$/.test(taxId.replace(/\s/g, ''))
	const bank = firstBank(party)
	const out: Record<string, unknown> = {
		type: party.type ?? 'company',
		name: party.name ?? undefined,
		legal_form: party.legal_form ?? undefined,
		street: party.street ?? undefined,
		zip: party.zip ?? party.postal_code ?? undefined,
		city: party.city ?? undefined,
		country: party.country ?? undefined,
		email: party.email ?? undefined,
		phone: party.phone ?? undefined,
		vat_id: isVat ? taxId : (party.vat_id ?? undefined),
		tax_number: !isVat && taxId ? taxId : (party.tax_number ?? undefined),
		iban: bank.iban,
		bic: bank.bic,
		bank_name: bank.bank_name,
		register_court: party.register_court ?? undefined,
		register_number: party.register_number ?? undefined,
		managing_director: party.managing_director ?? undefined
	}
	for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k]
	return out as Partial<Contact>
}

type StoredContact = Partial<Contact> & { id?: string }

/** Match a party against existing contacts: USt-IdNr (strong) → IBAN → normalized name. */
export function matchContact(party: PartyInput, contacts: StoredContact[]): StoredContact | null {
	const f = partyToContactFields(party)
	const noSpace = (s: unknown) => String(s ?? '').replace(/\s/g, '')
	if (f.vat_id) {
		const m = contacts.find((c) => c.vat_id && noSpace(c.vat_id) === noSpace(f.vat_id))
		if (m) return m
	}
	if (f.iban) {
		const m = contacts.find((c) => c.iban && noSpace(c.iban) === noSpace(f.iban))
		if (m) return m
	}
	const n = normalizeName(f.name)
	if (n) {
		const m = contacts.find((c) => normalizeName(c.name) === n)
		if (m) return m
	}
	return null
}

/** Only the fields the party provides that the existing contact is still missing (enrich, never overwrite). */
export function enrichFields(existing: StoredContact, party: PartyInput): Partial<Contact> {
	const f = partyToContactFields(party)
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(f)) {
		if (k === 'type') continue
		const cur = (existing as Record<string, unknown>)[k]
		if ((cur == null || cur === '') && v != null && v !== '') out[k] = v
	}
	return out as Partial<Contact>
}

/** The parties to harvest from an extracted doc: the counterparty (`vendor`) and the SELF candidate. */
export function partiesFromDoc(
	docType: string,
	extracted: Record<string, unknown>
): { vendor?: PartyInput; self?: PartyInput } {
	if (docType === 'invoice') {
		return { vendor: rec(extracted.vendor) as PartyInput, self: rec(extracted.buyer) as PartyInput }
	}
	if (docType === 'bank_statement') {
		return { self: rec(extracted.account_holder) as PartyInput }
	}
	return {}
}
