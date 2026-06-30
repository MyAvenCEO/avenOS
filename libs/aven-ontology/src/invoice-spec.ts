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
		{ pred: 'produced', kind: 'replace', link: 'x2', field: 'run', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		number: { pred: 'number', place: 'x1' },
		total: { pred: 'total', place: 'x1' },
		vendor: { pred: 'vendor', place: 'x2' },
		buyer: { pred: 'invoice', place: 'x3' },
		owner: { pred: 'owned_by', place: 'x1' },
		due: { pred: 'due', place: 'x1' },
		artifact: { pred: 'source', place: 'x1' },
		run: { pred: 'produced', place: 'x1' }
	}
}
