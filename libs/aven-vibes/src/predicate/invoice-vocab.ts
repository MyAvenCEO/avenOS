// Invoice predicate vocabulary — board 0090, corrected to canonical gismu places (board 0092 step 2a).
// The invoice headline as x1–x5 predications, each compiling to a self-documenting Ajv data_schema:
//   invoice ≡ janta — x1 (the bill/account, the entity) for goods x2, billed to x3, by biller x4
//                     [the row IS the invoice; we store x3 = the billed party]
//   number  ≡ cmene — x1 (the number string) is the name/tag of invoice x2     [Rechnungsnummer]
//   total   ≡ jdima — x1 (the price/total) of item x2 (the invoice)            [un-reversed: x1=price]
//   vendor  ≡ vecnu — invoice x1 was billed by seller x2 (a name; becomes a janta.x4 contact ref in step 3)
// Ownership is the universal owned_by≡ponse (NOT an owner place); due≡detri, source≡krasi, produced≡cupra
// are reused from the todo/document vocab. See [[universal-predication-schema-0084]].
import { compilePredicate, type PredicateDef, predSchemaName } from './compile.js'

// janta: x1 account/bill, x2 goods, x3 billed-party, x4 biller. The row IS the invoice (x1); we store
// x3 = the billed party (us, the account owner) so the bill knows who it is addressed to.
export const INVOICE: PredicateDef = {
	predicate: 'invoice',
	gismu: 'janta',
	gloss: 'janta: x1 (the bill/account — the invoice entity) for goods/services x2, billed to party x3 by biller x4',
	places: [
		{
			pos: 'x3',
			role: 'billed party',
			gloss: 'who the invoice is billed to — janta x3 (the debtor; us)',
			kind: 'ref',
			references: 'user'
		}
	]
}

// cmene: x1 (quoted name) is the name/tag of x2. The invoice NUMBER is a name of the invoice.
export const NUMBER: PredicateDef = {
	predicate: 'number',
	gismu: 'cmene',
	gloss: 'cmene: x1 (the number string) is the name/identifier of invoice x2 — the Rechnungsnummer',
	places: [
		{
			pos: 'x1',
			role: 'name',
			gloss: 'the invoice number / identifier — cmene x1 (the quoted name)',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: '2026-014'
		},
		{ pos: 'x2', role: 'named thing', gloss: 'the invoice this numbers — cmene x2', kind: 'ref', references: '*' }
	]
}

// jdima: x1 [amount] is the PRICE of item x2 — so the total is x1 (un-reversed) and the invoice is x2.
export const TOTAL: PredicateDef = {
	predicate: 'total',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the total amount) is the price of x2 (the invoice) — minor-unit-safe decimal string',
	places: [
		{
			pos: 'x1',
			role: 'price',
			gloss: 'the invoice total, e.g. "1200.00" — jdima x1 (the price/amount)',
			kind: 'value',
			type: 'string',
			example: '1200.00'
		},
		{ pos: 'x2', role: 'item', gloss: 'the invoice this is the price of — jdima x2', kind: 'ref', references: '*' }
	]
}

// vecnu: x1 seller, x2 goods. Transitional vendor-name attribute (invoice x1 billed by seller-named x2);
// step 3 replaces this with the biller as a janta.x4 contact ref. Kept x1=invoice for now (a name, not a ref).
export const VENDOR: PredicateDef = {
	predicate: 'vendor',
	gismu: 'vecnu',
	gloss: 'vecnu (sell): invoice x1 was billed by seller/vendor x2 (a name; a contact ref once contacts migrate)',
	places: [
		{ pos: 'x1', role: 'invoice', gloss: 'the invoice', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'vendor',
			gloss: 'the vendor / biller name',
			kind: 'value',
			type: 'string',
			example: 'ACME GmbH'
		}
	]
}

/** The invoice-specific predicate bundle (owned_by/due/source/produced are reused from todo+document). */
export const INVOICE_PREDICATES: PredicateDef[] = [INVOICE, NUMBER, TOTAL, VENDOR]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function invoicePredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return INVOICE_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
