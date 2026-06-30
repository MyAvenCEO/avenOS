// Document predicate vocabulary — board 0089, completed to FULL gismu places + the doc-type fix
// (board 0097). Each predicate carries EVERY place its gismu defines (unused ones `required: false`):
//   document ≡ vreji  — x1 record · x2 data · x3 subject · x4 medium
//   kind     ≡ tcita  — x1 doctype-label · x2 document · x3 information   [the classification]
//   summary  ≡ skicu  — x1 describer · x2 subject · x3 audience · x4 description
//   source   ≡ krasi  — x1 source · x2 originated                          [PROVENANCE]
//   produced ≡ cupra  — x1 producer · x2 product · x3 process              [LINEAGE]
// The doc TYPE was `classified`≡klesi (a value crammed into klesi's category-ref place — a structural
// mismatch the gate excluded). It is now `kind`≡tcita ("x1 is a label/tag of x2 showing information
// x3"): x1 references a stable doctype entity (`doctype-invoice`/`doctype-other`), x2 the document,
// x3 an optional human label/confidence note. See [[two-layer-schema-split]].
import { compilePredicate, type PredicateDef, predSchemaName, ref, val } from './compile.js'

// vreji: x1 the record (the row itself), x2 data (the title), x3 the subject it records, x4 the medium.
export const DOCUMENT: PredicateDef = {
	predicate: 'document',
	gismu: 'vreji',
	gloss: 'vreji: x1 (the record itself, the row) records data x2 (its title) about subject x3 on medium x4',
	places: [
		ref('x1', 'record', 'the record itself — vreji x1 (the document row; implicit, the entity)', {
			required: false
		}),
		val('x2', 'data', 'the document title / recorded data — vreji x2 (the data)', 'string', {
			minLength: 1,
			example: 'Invoice #2026-014'
		}),
		ref('x3', 'subject', 'what the document is about — vreji x3 (open)', { required: false }),
		val('x4', 'medium', 'the medium it is recorded on — vreji x4 (open, e.g. PDF)', 'string', {
			required: false
		})
	]
}

// tcita: x1 label, x2 labeled, x3 information. The doc TYPE: x1 = a stable doctype entity ref
// (`doctype-invoice`/`doctype-other`), x2 = the document, x3 = an optional human label/note.
export const KIND: PredicateDef = {
	predicate: 'kind',
	gismu: 'tcita',
	gloss: 'tcita: x1 (the doctype label) tags x2 (the document) showing information x3 — the classification',
	places: [
		ref('x1', 'label', 'the document type — tcita x1 (a ref to a doctype entity, e.g. doctype-invoice)', {
			example: 'doctype-invoice'
		}),
		ref('x2', 'labeled', 'the classified document — tcita x2 (the thing labelled)'),
		val('x3', 'information', 'the human label / confidence the tag shows — tcita x3 (open)', 'string', {
			required: false,
			example: 'invoice'
		})
	]
}

// skicu: x1 describer, x2 subject (the document), x3 audience, x4 description (the summary text).
export const SUMMARY: PredicateDef = {
	predicate: 'summary',
	gismu: 'skicu',
	gloss: 'skicu: x1 (the describer) describes x2 (the document) to audience x3 with description x4 (the summary)',
	places: [
		ref('x1', 'describer', 'who/what produced the description — skicu x1 (open)', { required: false }),
		ref('x2', 'subject', 'the summarized document — skicu x2 (the subject)'),
		ref('x3', 'audience', 'who the description is for — skicu x3 (open)', { required: false }),
		val('x4', 'description', 'the short summary text — skicu x4 (the description)', 'string', {
			example: 'Invoice from ACME for 1.200€ due 2026-07-15'
		})
	]
}

// PROVENANCE — generic, reusable by ANY ingesting skill. krasi: x1 source/origin (the sha256
// content-address of the raw artifact), x2 originated (the derived document).
export const SOURCE: PredicateDef = {
	predicate: 'source',
	gismu: 'krasi',
	gloss: 'krasi: x1 (the raw source artifact — a sha256 content-address) is the origin of x2 (the derived document)',
	places: [
		ref('x1', 'source', 'the raw source artifact — its sha256 content-address (krasi x1, the origin)', {
			example: '1bce272a633a5ab0'
		}),
		ref('x2', 'originated', 'the thing derived from it — krasi x2')
	]
}

// LINEAGE — which skill run produced this (generic). cupra: x1 producer (the flow run), x2 product
// (the document), x3 the process.
export const PRODUCED: PredicateDef = {
	predicate: 'produced',
	gismu: 'cupra',
	gloss: 'cupra: x1 (the skill run) produces x2 (the document/invoice) by process x3 — the run is the producer',
	places: [
		ref('x1', 'producer', 'the flow-run that produced this — cupra x1 (the producer)', {
			example: 'run_5f3a'
		}),
		ref('x2', 'product', 'the produced thing — cupra x2 (the product)'),
		val('x3', 'process', 'the production process — cupra x3 (open)', 'string', { required: false })
	]
}

/** The full document predicate bundle (Layer B vocab to seed into data_schema). board 0089/0097. */
export const DOCUMENT_PREDICATES: PredicateDef[] = [DOCUMENT, KIND, SUMMARY, SOURCE, PRODUCED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function documentPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return DOCUMENT_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
