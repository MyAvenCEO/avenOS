import type { TypeSpec } from './types.js'

// The `invoice` composite type — the invoice vertical (board 0090), declarative on the 0088 engine.
// A captured invoice + its deadline + GENERIC provenance, all as x1–x5 predications:
//   invoice (janta)  x1 owner, x2 number      — the entity
//   amount (jdima)   x1 invoice, x2 total      — the captured amount
//   vendor (vecnu)   x1 invoice, x2 name       — the biller
//   due (detri)      x1 date, x2 invoice       — REUSED deadline predicate
//   source (krasi)   x1 artifact, x2 invoice   — REUSED provenance: derived ← the raw document/artifact
//   produced (finti) x1 run, x2 invoice        — REUSED lineage: which skill run made it
// Reuses due/source/produced from the document vocab — provenance is a generic concern, not per-type.
export const INVOICE_SPEC: TypeSpec = {
	type: 'invoice',
	parts: [
		{
			pred: 'invoice',
			kind: 'primary',
			field: 'number',
			create: { x1: '$user', x2: '$value' },
			set: { x2: '$value' }
		},
		{ pred: 'amount', kind: 'replace', link: 'x1', field: 'amount', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'vendor', kind: 'replace', link: 'x1', field: 'vendor', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'due', kind: 'replace', link: 'x2', field: 'due', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'source', kind: 'replace', link: 'x2', field: 'artifact', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'produced', kind: 'replace', link: 'x2', field: 'run', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		number: { pred: 'invoice', place: 'x2' },
		amount: { pred: 'amount', place: 'x2' },
		vendor: { pred: 'vendor', place: 'x2' },
		due: { pred: 'due', place: 'x1' },
		artifact: { pred: 'source', place: 'x1' },
		run: { pred: 'produced', place: 'x1' }
	}
}
