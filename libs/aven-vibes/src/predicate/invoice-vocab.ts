// Invoice predicate vocabulary — board 0090. The invoice vertical's NEW atomic data types, on the
// ontology. Reuses `due` (detri), `source` (krasi) + `produced` (finti) from the document vocab for
// the deadline + provenance. Each compiles to a self-documenting Ajv data_schema named `<predicate>`.
//   invoice ≡ janta — x1 (owner) holds the bill/invoice numbered x2          [owner-scoped janta]
//   amount  ≡ jdima — invoice x1 has price/amount x2
//   vendor  ≡ vecnu — invoice x1 was billed by seller x2 (a name for now; a contact ref later)
import { compilePredicate, type PredicateDef, predSchemaName } from './compile.js'

export const INVOICE: PredicateDef = {
	predicate: 'invoice',
	gismu: 'janta',
	gloss: 'janta (account/bill): x1 (the user/owner) holds the invoice numbered x2',
	places: [
		{ pos: 'x1', role: 'owner', gloss: 'who owns this invoice (a user)', kind: 'ref', references: 'user' },
		{
			pos: 'x2',
			role: 'number',
			gloss: 'the invoice number / identifier',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: '2026-014'
		}
	]
}

export const AMOUNT: PredicateDef = {
	predicate: 'amount',
	gismu: 'jdima',
	gloss: 'jdima (price): invoice x1 has total amount x2 (minor-unit-safe decimal string)',
	places: [
		{ pos: 'x1', role: 'invoice', gloss: 'the invoice', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'total',
			gloss: 'the total amount, e.g. "1200.00"',
			kind: 'value',
			type: 'string',
			example: '1200.00'
		}
	]
}

export const VENDOR: PredicateDef = {
	predicate: 'vendor',
	gismu: 'vecnu',
	gloss: 'vecnu (sell): invoice x1 was billed by seller/vendor x2',
	places: [
		{ pos: 'x1', role: 'invoice', gloss: 'the invoice', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'vendor',
			gloss: 'the vendor / biller name (a contact ref becomes possible once contacts migrate)',
			kind: 'value',
			type: 'string',
			example: 'ACME GmbH'
		}
	]
}

/** The invoice-specific predicate bundle (due/source/produced are reused from the document vocab). */
export const INVOICE_PREDICATES: PredicateDef[] = [INVOICE, AMOUNT, VENDOR]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function invoicePredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return INVOICE_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
