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

// vreji: x1 record (the row itself), x2 data. The document IS the record (x1, implicit); x2 holds its
// title/data. Ownership is the universal owned_by≡ponse, not an owner place (board 0092).
export const DOCUMENT: PredicateDef = {
	predicate: 'document',
	gismu: 'vreji',
	gloss: 'vreji (record): x1 (the record itself, the row) is a document holding data x2 — its title',
	places: [
		{
			pos: 'x2',
			role: 'data',
			gloss: 'the document title / recorded data — vreji x2 (the data)',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: 'Invoice #2026-014'
		}
	]
}

// klesi: x1 category, x2 superset (both refs). The classification kind ('invoice'/'other') is a string
// label, not a class-entity ref — so this is NOT yet seed-faithful (the gate skips it). board 0092:
// a faithful membership (cmima x1 document, x2 class-entity) needs first-class class entities — a
// noted follow-on (the document-class decision). Kept functional with the kind as a value for now.
export const CLASSIFIED: PredicateDef = {
	predicate: 'classified',
	gismu: 'klesi',
	gloss: 'klesi (category): document x1 is classified in category x2 (transitional — kind as a value; → cmima + class entities)',
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

// skicu: x2 subject (the document), x4 description (the summary text) — un-reversed (was x1/x2).
export const SUMMARY: PredicateDef = {
	predicate: 'summary',
	gismu: 'skicu',
	gloss: 'skicu (describe): x2 (the document) is described/summarized by text x4',
	places: [
		{ pos: 'x2', role: 'subject', gloss: 'the summarized document — skicu x2 (the subject)', kind: 'ref', references: '*' },
		{
			pos: 'x4',
			role: 'description',
			gloss: 'the short summary text — skicu x4 (the description)',
			kind: 'value',
			type: 'string',
			example: 'Invoice from ACME for 1.200€ due 2026-07-15'
		}
	]
}

// PROVENANCE — generic, reusable by ANY ingesting skill: a derived thing links to its raw origin.
// krasi: x1 source/origin (a ref), x2 originated. The artifact's sha256 content-address IS the origin
// reference (board 0092: x1 is a ref to the artifact, matching krasi's source place).
export const SOURCE: PredicateDef = {
	predicate: 'source',
	gismu: 'krasi',
	gloss: 'krasi (source/origin): x1 (the raw source artifact — a sha256 content-address) is the origin of x2 (the derived document)',
	places: [
		{
			pos: 'x1',
			role: 'source',
			gloss: 'the raw source artifact — its sha256 content-address in the artifact store (krasi x1, the origin)',
			kind: 'ref',
			references: '*',
			example: '1bce272a633a5ab0'
		},
		{ pos: 'x2', role: 'originated', gloss: 'the thing derived from it — krasi x2', kind: 'ref', references: '*' }
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
