// Document predicate vocabulary — board 0089. The doc-ingest skill's output decomposes into a BUNDLE
// of predications with canonical Lojban gismu (from .claude/skills/ontology), including the GENERIC
// source-provenance predicate `krasi`. Each compiles to a self-documenting Ajv data_schema named
// `<predicate>` (bare name — predications ARE the universal data types). See [[two-layer-schema-split]].
//   document    ≡ vreji  — x1 (owner) holds the document record titled x2          [owner-scoped]
//   classified  ≡ klesi  — document x1 falls in category x2 (invoice / …)
//   summary     ≡ skicu  — document x1 is described/summarized by text x2
//   source      ≡ krasi  — x1 (the raw artifact, sha256) is the ORIGIN of document x2   [PROVENANCE]
//   produced    ≡ cupra  — x1 (the skill run, producer) produces document x2             [LINEAGE]
import { compilePredicate, type PredicateDef, predSchemaName } from './compile.js'

export const DOCUMENT: PredicateDef = {
	predicate: 'document',
	gismu: 'vreji',
	gloss: 'vreji (record): x1 (the user/owner) holds the ingested document record titled x2',
	places: [
		{ pos: 'x1', role: 'owner', gloss: 'who owns this document (a user)', kind: 'ref', references: 'user' },
		{
			pos: 'x2',
			role: 'title',
			gloss: 'the document title',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: 'Invoice #2026-014'
		}
	]
}

export const CLASSIFIED: PredicateDef = {
	predicate: 'classified',
	gismu: 'klesi',
	gloss: 'klesi (category): document x1 is classified in category x2',
	places: [
		{ pos: 'x1', role: 'document', gloss: 'the classified document', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'kind',
			gloss: 'the document type (invoice / bank_statement / contract / other)',
			kind: 'value',
			type: 'string',
			example: 'invoice'
		}
	]
}

export const SUMMARY: PredicateDef = {
	predicate: 'summary',
	gismu: 'skicu',
	gloss: 'skicu (describe): document x1 is summarized by text x2',
	places: [
		{ pos: 'x1', role: 'document', gloss: 'the summarized document', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'text',
			gloss: 'the short summary',
			kind: 'value',
			type: 'string',
			example: 'Invoice from ACME for 1.200€ due 2026-07-15'
		}
	]
}

// PROVENANCE — generic, reusable by ANY ingesting skill: a derived thing links to its raw origin.
export const SOURCE: PredicateDef = {
	predicate: 'source',
	gismu: 'krasi',
	gloss: 'krasi (source/origin): x1 (the raw source artifact, a sha256 content-address) is the origin of x2 (the derived document)',
	places: [
		{
			pos: 'x1',
			role: 'artifact',
			gloss: 'the raw source artifact — its sha256 content-address in the artifact store',
			kind: 'value',
			type: 'string',
			example: '1bce272a633a5ab0'
		},
		{ pos: 'x2', role: 'document', gloss: 'the thing derived from it', kind: 'ref', references: '*' }
	]
}

// LINEAGE — which skill run produced this (generic). cupra: x1 (producer) produces x2 (product) — the
// run is the producer (a ref to the flow_run), the entity is the product. board 0092: finti → cupra,
// and x1 becomes a ref (the run id) to match cupra's canonical producer place.
export const PRODUCED: PredicateDef = {
	predicate: 'produced',
	gismu: 'cupra',
	gloss: 'cupra (produce): x1 (the skill run) produces x2 (the document/invoice) — the run is the producer',
	places: [
		{
			pos: 'x1',
			role: 'producer',
			gloss: 'the flow-run that produced this — cupra x1 (the producer)',
			kind: 'ref',
			references: '*',
			example: 'run_5f3a'
		},
		{ pos: 'x2', role: 'product', gloss: 'the produced thing — cupra x2 (the product)', kind: 'ref', references: '*' }
	]
}

/** The full document predicate bundle (Layer B vocab to seed into data_schema). board 0089. */
export const DOCUMENT_PREDICATES: PredicateDef[] = [DOCUMENT, CLASSIFIED, SUMMARY, SOURCE, PRODUCED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function documentPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return DOCUMENT_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
