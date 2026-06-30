import type { TypeSpec } from './types.js'

// The `invoice` composite type — the invoice vertical (board 0090), corrected to canonical gismu
// places (board 0092 step 2a). The headline as x1–x5 predications:
//   invoice (janta)  x3 = billed-party (us), x4 = biller (vendor company); the row IS the invoice (x1)
//   owned_by (ponse) x1 account, x2 invoice                                — UNIVERSAL ownership
//   identifier(tcita) x1 idkind-invoice_number, x2 invoice, x3 the number  — Rechnungsnummer (board 0097:
//                                                                            was number≡cmene; now the
//                                                                            universal identifier)
//   total (jdima)    x1 total, x2 invoice                                  — un-reversed (x1 = the price)
//   due (detri)      x1 date, x2 invoice                                   — REUSED deadline predicate
//   source (krasi)   x1 artifact, x2 invoice                              — REUSED provenance
//   produced (cupra) x1 run, x2 invoice                                    — REUSED lineage (finti → cupra)
// Ownership is owned_by, not an owner place; the `number` field drives BOTH the primary gate AND the
// identifier predication (the engine applies every part matching a field). The transitional `vendor`≡
// vecnu is gone (board 0097): the biller is janta.x4 (the vendor company ref, set by enrich).

// A LINE ITEM is its own sub-entity (board 0092 step 2b): line≡pagbu (x2 = the invoice) with
// description≡skicu (x4), quantity≡klani (x2), unit_price≡jdima (x1), line_amount≡jdima (x1).
const LINE_SPEC: TypeSpec = {
	type: 'line',
	parts: [
		{ pred: 'line', kind: 'primary', field: 'description', create: { x2: '$parent' } },
		{ pred: 'description', kind: 'replace', link: 'x2', field: 'description', set: { x2: '$primary', x4: '$value' } },
		{ pred: 'quantity', kind: 'replace', link: 'x1', field: 'quantity', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'unit_price', kind: 'replace', link: 'x2', field: 'unit_price', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'line_amount', kind: 'replace', link: 'x2', field: 'amount', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		description: { pred: 'description', place: 'x4' },
		quantity: { pred: 'quantity', place: 'x2' },
		unit_price: { pred: 'unit_price', place: 'x1' },
		amount: { pred: 'line_amount', place: 'x1' }
	}
}

// A PAYMENT is its own sub-entity (board 0092 step 2b): payment≡pleji (x2 amount, x4 = the invoice it
// pays for) with paid_on≡detri (x1 date, x2 payment).
const PAYMENT_SPEC: TypeSpec = {
	type: 'payment',
	parts: [
		{ pred: 'payment', kind: 'primary', field: 'amount', create: { x2: '$value', x4: '$parent' } },
		{ pred: 'paid_on', kind: 'replace', link: 'x2', field: 'date', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		amount: { pred: 'payment', place: 'x2' },
		date: { pred: 'paid_on', place: 'x1' }
	}
}

export const INVOICE_SPEC: TypeSpec = {
	type: 'invoice',
	parts: [
		// janta.x3 = billed-party (us); janta.x4 = biller (the vendor company ref, set by enrich). board 0093.
		{ pred: 'invoice', kind: 'primary', field: 'number', create: { x3: '$user' }, set: {}, fields: { x4: 'billed_by' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		// the invoice number is the universal identifier≡tcita, keyed by x1 = idkind-invoice_number, value in x3
		{ pred: 'identifier', kind: 'replace', link: 'x2', field: 'number', match: { x1: 'idkind-invoice_number' }, set: { x2: '$primary', x3: '$value' } },
		{ pred: 'total', kind: 'replace', link: 'x2', field: 'total', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'due', kind: 'replace', link: 'x2', field: 'due', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'source', kind: 'replace', link: 'x2', field: 'artifact', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'produced', kind: 'replace', link: 'x2', field: 'run', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'line', kind: 'children', field: 'lines', link: 'x2', childSpec: LINE_SPEC },
		{ pred: 'payment', kind: 'children', field: 'payments', link: 'x4', childSpec: PAYMENT_SPEC }
	],
	project: {
		number: { pred: 'identifier', place: 'x3', match: { x1: 'idkind-invoice_number' } },
		total: { pred: 'total', place: 'x1' },
		buyer: { pred: 'invoice', place: 'x3' },
		billed_by: { pred: 'invoice', place: 'x4' },
		owner: { pred: 'owned_by', place: 'x1' },
		due: { pred: 'due', place: 'x1' },
		artifact: { pred: 'source', place: 'x1' },
		run: { pred: 'produced', place: 'x1' },
		lines: { pred: 'line', children: true },
		payments: { pred: 'payment', children: true }
	}
}
