import { kvList, rec, section, str } from './vibes/_doc/map.js'
import type { DocView } from './vibes/_doc/types.js'

// board 0082 — the addressbook identity: a person or a company. Each contact is minted a short id
// (8-char Crockford base32) ONCE, used as the stable customer key inside invoice numbers
// (`R-<short_id>-<seq>`). Pure (no DOM): schema + id minting + display + detail mapper.

export type ContactType = 'person' | 'company'

export type Contact = {
	short_id: string
	type: ContactType
	name: string
	legal_form: string | null
	/** true for the user's OWN company (the Stammdaten used as the invoice seller). */
	is_self: boolean
	street: string | null
	zip: string | null
	city: string | null
	country: string | null
	vat_id: string | null
	tax_number: string | null
	email: string | null
	phone: string | null
	iban: string | null
	bic: string | null
	bank_name: string | null
	contact_person: string | null
	// Geschäftsbrief-Pflichtangaben (GmbH): Handelsregister + Geschäftsführer. board 0082.
	register_court: string | null
	register_number: string | null
	managing_director: string | null
	notes: string | null
}

/** The JSON Schema registered as the user's `contact` schema (Ajv-validated on write). */
export const CONTACT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['short_id', 'type', 'name'],
	properties: {
		short_id: { type: 'string', description: '8-char Crockford base32 id, stable per contact.' },
		type: { type: 'string', enum: ['person', 'company'] },
		name: { type: 'string' },
		legal_form: { type: ['string', 'null'], description: 'GmbH / KG / e.V. / UG …' },
		is_self: {
			type: 'boolean',
			description: "true = the user's own company (Stammdaten / seller)."
		},
		street: { type: ['string', 'null'] },
		zip: { type: ['string', 'null'] },
		city: { type: ['string', 'null'] },
		country: { type: ['string', 'null'] },
		vat_id: { type: ['string', 'null'], description: 'USt-IdNr.' },
		tax_number: { type: ['string', 'null'], description: 'Steuernummer.' },
		email: { type: ['string', 'null'] },
		phone: { type: ['string', 'null'] },
		iban: { type: ['string', 'null'] },
		bic: { type: ['string', 'null'] },
		bank_name: { type: ['string', 'null'] },
		contact_person: { type: ['string', 'null'] },
		register_court: {
			type: ['string', 'null'],
			description: 'Registergericht, z. B. "Amtsgericht München".'
		},
		register_number: {
			type: ['string', 'null'],
			description: 'Handelsregisternummer, z. B. "HRB 292608".'
		},
		managing_director: {
			type: ['string', 'null'],
			description: 'Geschäftsführer / vertretungsberechtigte Person.'
		},
		notes: { type: ['string', 'null'] }
	}
} as const

// Crockford base32 minus the ambiguous I L O U — all chars are a subset of /[0-9A-HJ-NP-Z]/.
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_LEN = 8

/**
 * Mint a fresh 8-char contact id, retrying on collision with `existingIds`. `rand` is injected (a
 * `() => number` in [0,1)) so the minting is deterministic + testable.
 */
export function mintContactId(rand: () => number, existingIds: Iterable<string>): string {
	const taken = new Set(existingIds)
	for (let attempt = 0; attempt < 10_000; attempt++) {
		let id = ''
		for (let i = 0; i < ID_LEN; i++) id += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)]
		if (!taken.has(id)) return id
	}
	throw new Error('contact id space exhausted')
}

export function contactDisplayName(c: Partial<Contact>): string {
	const name = str(c.name)
	const lf = str(c.legal_form)
	return [name, lf].filter(Boolean).join(' ') || '—'
}

function line(c: Record<string, unknown>, key: keyof Contact): string | null {
	const v = c[key as string]
	return typeof v === 'string' && v ? v : null
}

/** The right-hand detail panel for a contact, as a DocView. */
export function mapContactToView(contact: Contact | Record<string, unknown> | null): DocView {
	const c = rec(contact)
	const addr = [line(c, 'street'), [line(c, 'zip'), line(c, 'city')].filter(Boolean).join(' ')]
		.filter(Boolean)
		.join(', ')
	return {
		title: contactDisplayName(c as Partial<Contact>),
		subtitle: c.is_self ? 'Eigene Firma (Stammdaten)' : c.type === 'person' ? 'Person' : 'Firma',
		sections: [
			section('Adresse', {
				rows: kvList([
					['Anschrift', addr || null],
					['Land', line(c, 'country')],
					['Ansprechpartner', line(c, 'contact_person')]
				])
			}),
			section('Steuer', {
				rows: kvList([
					['USt-IdNr.', line(c, 'vat_id')],
					['Steuernummer', line(c, 'tax_number')]
				])
			}),
			section('Register', {
				rows: kvList([
					['Registergericht', line(c, 'register_court')],
					['Handelsregister', line(c, 'register_number')],
					['Geschäftsführer', line(c, 'managing_director')]
				])
			}),
			section('Kontakt', {
				rows: kvList([
					['E-Mail', line(c, 'email')],
					['Telefon', line(c, 'phone')]
				])
			}),
			section('Bank', {
				rows: kvList([
					['IBAN', line(c, 'iban')],
					['BIC', line(c, 'bic')],
					['Bank', line(c, 'bank_name')]
				])
			}),
			section('Kennung', { rows: kvList([['Kurz-ID', str(c.short_id) || null]]) })
		]
	}
}
