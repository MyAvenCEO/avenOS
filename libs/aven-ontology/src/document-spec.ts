import type { TypeSpec } from './types.js'

// The `document` composite type — the doc-ingest skill's output (board 0089), declarative on the
// 0088 engine. A classified document + its GENERIC source provenance, all as x1–x5 predications:
//   document (vreji)   x2 title (the row IS the record)  — the entity
//   owned_by (ponse)   x1 account, x2 document           — UNIVERSAL ownership (was document.x1 owner)
//   classified (klesi) x1 document, x2 kind              — the LLM classification (transitional, see vocab)
//   summary (skicu)    x2 document, x4 text              — the LLM summary (un-reversed: text = x4)
//   source (krasi)     x1 artifact-sha256, x2 document   — PROVENANCE: derived ← raw origin
//   produced (cupra)   x1 run-id, x2 document            — LINEAGE: which skill run made it
// The `artifact` + `run` fields carry the provenance; the raw bytes live in the ArtifactStore, only
// the sha256 enters the graph here. Generic — any ingesting skill reuses source/produced. board 0092.
export const DOCUMENT_SPEC: TypeSpec = {
	type: 'document',
	parts: [
		{ pred: 'document', kind: 'primary', field: 'title', create: { x2: '$value' }, set: { x2: '$value' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'classified', kind: 'replace', link: 'x1', field: 'kind', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'summary', kind: 'replace', link: 'x2', field: 'summary', set: { x2: '$primary', x4: '$value' } },
		{ pred: 'source', kind: 'replace', link: 'x2', field: 'artifact', set: { x1: '$value', x2: '$primary' } },
		{ pred: 'produced', kind: 'replace', link: 'x2', field: 'run', set: { x1: '$value', x2: '$primary' } }
	],
	project: {
		title: { pred: 'document', place: 'x2' },
		kind: { pred: 'classified', place: 'x2' },
		summary: { pred: 'summary', place: 'x4' },
		owner: { pred: 'owned_by', place: 'x1' },
		artifact: { pred: 'source', place: 'x1' },
		run: { pred: 'produced', place: 'x1' }
	}
}
