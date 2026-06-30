import type { TypeSpec } from './types.js'

// Contact + transaction composite types — board 0092 step 3. A person (prenu) or company (kagni) is a
// bare entity row; its name (cmene), channels (judri: email/phone/iban/postal) and identifiers (cmene:
// vat_id/tax_number) hang off it as linked predications. An Ansprechpartner is a `person` that
// `represents` (krati) a `company`. A `transaction` (pleji) settles an invoice via x4 (the goods paid
// for), is dated (detri) and booked (cmima) to an SKR04 account. Ownership is the universal owned_by.

export const PERSON_SPEC: TypeSpec = {
	type: 'person',
	parts: [
		{ pred: 'person', kind: 'primary', field: 'name', create: {}, set: {} },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'name', kind: 'replace', link: 'x2', field: 'name', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'email', kind: 'replace', link: 'x2', field: 'email', set: { x1: '$value', x2: '$primary' } },
		// krati: x1 the person (representative), x2 the company represented — the Ansprechpartner link
		{ pred: 'represents', kind: 'replace', link: 'x1', field: 'company', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		name: { pred: 'name', place: 'x1' },
		email: { pred: 'email', place: 'x1' },
		represents: { pred: 'represents', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}

export const COMPANY_SPEC: TypeSpec = {
	type: 'company',
	parts: [
		{ pred: 'company', kind: 'primary', field: 'name', create: {}, set: {} },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'name', kind: 'replace', link: 'x2', field: 'name', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'email', kind: 'replace', link: 'x2', field: 'email', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'phone', kind: 'replace', link: 'x2', field: 'phone', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'iban', kind: 'replace', link: 'x2', field: 'iban', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'postal', kind: 'replace', link: 'x2', field: 'postal', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'vat_id', kind: 'replace', link: 'x2', field: 'vat_id', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'tax_number', kind: 'replace', link: 'x2', field: 'tax_number', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		name: { pred: 'name', place: 'x1' },
		email: { pred: 'email', place: 'x1' },
		phone: { pred: 'phone', place: 'x1' },
		iban: { pred: 'iban', place: 'x1' },
		postal: { pred: 'postal', place: 'x1' },
		vat_id: { pred: 'vat_id', place: 'x1' },
		tax_number: { pred: 'tax_number', place: 'x1' },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}

export const TRANSACTION_SPEC: TypeSpec = {
	type: 'transaction',
	parts: [
		// pleji: x2 the amount (drives), x3 the payee, x4 the invoice settled (the goods paid for)
		{ pred: 'transaction', kind: 'primary', field: 'amount', create: { x2: '$value' }, set: { x2: '$value' }, fields: { x3: 'payee', x4: 'invoice' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'dated', kind: 'replace', link: 'x2', field: 'date', set: { x1: '$value', x2: '$primary' } },
		// cmima: x1 the transaction (member), x2 the SKR04 account it is booked to
		{ pred: 'booked', kind: 'replace', link: 'x1', field: 'account', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		amount: { pred: 'transaction', place: 'x2' },
		payee: { pred: 'transaction', place: 'x3' },
		invoice: { pred: 'transaction', place: 'x4' },
		date: { pred: 'dated', place: 'x1' },
		account: { pred: 'booked', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}
