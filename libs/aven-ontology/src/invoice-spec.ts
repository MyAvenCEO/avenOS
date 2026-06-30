import type { TypeSpec } from './types.js'

// The `invoice` composite type — the invoice vertical (board 0090), corrected to canonical gismu
// places (board 0092 step 2a). The headline as x1–x5 predications:
//   invoice (janta)  x3 = billed-party (us); the row IS the invoice (x1)   — the entity
//   owned_by (ponse) x1 account, x2 invoice                                — UNIVERSAL ownership
//   number (cmene)   x1 number, x2 invoice                                 — Rechnungsnummer (was janta.x2)
//   total (jdima)    x1 total, x2 invoice                                  — un-reversed (x1 = the price)
//   vendor (vecnu)   x1 invoice, x2 name                                   — biller name (→ contact ref, step 3)
//   due (detri)      x1 date, x2 invoice                                   — REUSED deadline predicate
//   source (krasi)   x1 artifact, x2 invoice                              — REUSED provenance
//   produced (cupra) x1 run, x2 invoice                                    — REUSED lineage (finti → cupra)
// Ownership is owned_by, not an owner place; `number` is its own cmene (the `number` field drives BOTH
// the primary gate AND the cmene predication — the engine applies every part matching a field).

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
		{ pred: 'invoice', kind: 'primary', field: 'number', create: { x3: '$user' }, set: {} },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'number', kind: 'replace', link: 'x2', field: 'number', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'total', kind: 'replace', link: 'x2', field: 'total', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'vendor', kind: 'replace', link: 'x1', field: 'vendor', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'due', kind: 'replace', link: 'x2', field: 'due', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'source', kind: 'replace', link: 'x2', field: 'artifact', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'produced', kind: 'replace', link: 'x2', field: 'run', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'line', kind: 'children', field: 'lines', link: 'x2', childSpec: LINE_SPEC },
		{ pred: 'payment', kind: 'children', field: 'payments', link: 'x4', childSpec: PAYMENT_SPEC }
	],
	project: {
		number: { pred: 'number', place: 'x1' },
		total: { pred: 'total', place: 'x1' },
		vendor: { pred: 'vendor', place: 'x2' },
		buyer: { pred: 'invoice', place: 'x3' },
		owner: { pred: 'owned_by', place: 'x1' },
		due: { pred: 'due', place: 'x1' },
		artifact: { pred: 'source', place: 'x1' },
		run: { pred: 'produced', place: 'x1' },
		lines: { pred: 'line', children: true },
		payments: { pred: 'payment', children: true }
	}
}
