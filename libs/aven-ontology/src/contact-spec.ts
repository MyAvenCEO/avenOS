import type { TypeSpec } from './types.js'

// Contact + transaction composite types — board 0092, consolidated (board 0097). A person (prenu) or
// company (kagni) is a bare entity row; its name (cmene) and — NOW CONSOLIDATED — its channels and
// identifiers hang off it as discriminated predications:
//   • every channel is ONE `address`≡judri, the channel keyed by x3 = a stable addressing-system ref
//     (`addrsys-email`/`addrsys-phone`/`addrsys-iban`/`addrsys-postal`);
//   • every identifier is ONE `identifier`≡tcita, the kind keyed by x1 = a stable id-kind ref
//     (`idkind-vat_id`/`idkind-tax_number`), the value in x3.
// The `match` discriminator (board 0097) lets several parts share one predicate yet replace/project
// independently — so the projected record stays flat (email/phone/iban/postal/vat_id/tax_number).
// An Ansprechpartner is a `person` that `represents` (krati) a `company`. A `transaction` (pleji)
// settles an invoice via x4, is dated (detri) and booked (cmima) to an SKR04 account. Ownership is
// the universal owned_by.

export const PERSON_SPEC: TypeSpec = {
	type: 'person',
	parts: [
		{ pred: 'person', kind: 'primary', field: 'name', create: {}, set: {} },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'name', kind: 'replace', link: 'x2', field: 'name', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'address', kind: 'replace', link: 'x2', field: 'email', match: { x3: 'addrsys-email' }, set: { x1: '$value', x2: '$primary' } },
		// krati: x1 the person (representative), x2 the company represented — the Ansprechpartner link
		{ pred: 'represents', kind: 'replace', link: 'x1', field: 'company', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		name: { pred: 'name', place: 'x1' },
		email: { pred: 'address', place: 'x1', match: { x3: 'addrsys-email' } },
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
		// channels — one `address`≡judri each, distinguished by x3 = the addressing-system ref
		{ pred: 'address', kind: 'replace', link: 'x2', field: 'email', match: { x3: 'addrsys-email' }, set: { x1: '$value', x2: '$primary' } },
		{ pred: 'address', kind: 'replace', link: 'x2', field: 'phone', match: { x3: 'addrsys-phone' }, set: { x1: '$value', x2: '$primary' } },
		{ pred: 'address', kind: 'replace', link: 'x2', field: 'iban', match: { x3: 'addrsys-iban' }, set: { x1: '$value', x2: '$primary' } },
		{ pred: 'address', kind: 'replace', link: 'x2', field: 'postal', match: { x3: 'addrsys-postal' }, set: { x1: '$value', x2: '$primary' } },
		// identifiers — one `identifier`≡tcita each, distinguished by x1 = the id-kind ref, value in x3
		{ pred: 'identifier', kind: 'replace', link: 'x2', field: 'vat_id', match: { x1: 'idkind-vat_id' }, set: { x2: '$primary', x3: '$value' } },
		{ pred: 'identifier', kind: 'replace', link: 'x2', field: 'tax_number', match: { x1: 'idkind-tax_number' }, set: { x2: '$primary', x3: '$value' } }
	],
	project: {
		name: { pred: 'name', place: 'x1' },
		email: { pred: 'address', place: 'x1', match: { x3: 'addrsys-email' } },
		phone: { pred: 'address', place: 'x1', match: { x3: 'addrsys-phone' } },
		iban: { pred: 'address', place: 'x1', match: { x3: 'addrsys-iban' } },
		postal: { pred: 'address', place: 'x1', match: { x3: 'addrsys-postal' } },
		vat_id: { pred: 'identifier', place: 'x3', match: { x1: 'idkind-vat_id' } },
		tax_number: { pred: 'identifier', place: 'x3', match: { x1: 'idkind-tax_number' } },
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
