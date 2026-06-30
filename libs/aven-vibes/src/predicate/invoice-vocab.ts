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

// ── Line items (board 0092 step 2b): each line is its OWN sub-entity, a child of the invoice ──────────
// line ≡ pagbu (x1 the line/part, x2 the invoice/whole); its attributes hang off the line:
//   description ≡ skicu (x2 line, x4 text) · quantity ≡ klani (x1 line, x2 qty) ·
//   unit_price ≡ jdima (x1 price, x2 line) · line_amount ≡ jdima (x1 amount, x2 line)

export const LINE: PredicateDef = {
	predicate: 'line',
	gismu: 'pagbu',
	gloss: 'pagbu: x1 (the line) is a part/component of x2 (the invoice) — a single invoice line item',
	places: [
		{ pos: 'x2', role: 'whole', gloss: 'the invoice this line belongs to — pagbu x2 (the whole)', kind: 'ref', references: '*' }
	]
}

export const DESCRIPTION: PredicateDef = {
	predicate: 'description',
	gismu: 'skicu',
	gloss: 'skicu: x2 (the line/subject) is described by text x4 — the line description',
	places: [
		{ pos: 'x2', role: 'subject', gloss: 'the described thing — skicu x2', kind: 'ref', references: '*' },
		{
			pos: 'x4',
			role: 'description',
			gloss: 'the description text — skicu x4',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: 'Beratung (Stunden)'
		}
	]
}

export const QUANTITY: PredicateDef = {
	predicate: 'quantity',
	gismu: 'klani',
	gloss: 'klani: x1 (the line) is a quantity measured by amount x2 — the line quantity',
	places: [
		{ pos: 'x1', role: 'quantity', gloss: 'the measured thing (the line) — klani x1', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'amount', gloss: 'the quantity value — klani x2', kind: 'value', type: 'string', example: '3' }
	]
}

export const UNIT_PRICE: PredicateDef = {
	predicate: 'unit_price',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the unit price) is the price of x2 (the line) — per-unit price',
	places: [
		{ pos: 'x1', role: 'price', gloss: 'the unit price — jdima x1', kind: 'value', type: 'string', example: '100.00' },
		{ pos: 'x2', role: 'item', gloss: 'the line — jdima x2', kind: 'ref', references: '*' }
	]
}

export const LINE_AMOUNT: PredicateDef = {
	predicate: 'line_amount',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the line total) is the price of x2 (the line) — qty × unit price',
	places: [
		{ pos: 'x1', role: 'price', gloss: 'the line total — jdima x1', kind: 'value', type: 'string', example: '300.00' },
		{ pos: 'x2', role: 'item', gloss: 'the line — jdima x2', kind: 'ref', references: '*' }
	]
}

// ── Payments (board 0092 step 2b): each payment is a child sub-entity of the invoice ─────────────────
// payment ≡ pleji (x2 the amount, x4 the invoice/goods paid for); paid_on ≡ detri (x1 date, x2 payment)

export const PAYMENT: PredicateDef = {
	predicate: 'payment',
	gismu: 'pleji',
	gloss: 'pleji: x2 (the amount) is paid for x4 (the invoice) — a payment toward the invoice',
	places: [
		{ pos: 'x2', role: 'payment', gloss: 'the amount paid — pleji x2', kind: 'value', type: 'string', example: '300.00' },
		{ pos: 'x4', role: 'goods', gloss: 'the invoice paid for — pleji x4 (goods)', kind: 'value', type: 'string', example: '7e776030' }
	]
}

export const PAID_ON: PredicateDef = {
	predicate: 'paid_on',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of payment x2 — when the payment was made',
	places: [
		{ pos: 'x1', role: 'date', gloss: 'the payment date — detri x1', kind: 'value', type: 'date-time', example: '2026-07-09' },
		{ pos: 'x2', role: 'event', gloss: 'the payment — detri x2', kind: 'ref', references: '*' }
	]
}

/** The invoice headline predicate bundle (owned_by/due/source/produced reused from todo+document). */
export const INVOICE_PREDICATES: PredicateDef[] = [INVOICE, NUMBER, TOTAL, VENDOR]
/** The line-item sub-entity bundle (board 0092 step 2b). */
export const LINE_PREDICATES: PredicateDef[] = [LINE, DESCRIPTION, QUANTITY, UNIT_PRICE, LINE_AMOUNT]
/** The payment sub-entity bundle (board 0092 step 2b). */
export const PAYMENT_PREDICATES: PredicateDef[] = [PAYMENT, PAID_ON]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries (headline + lines + payments). */
export function invoicePredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return [...INVOICE_PREDICATES, ...LINE_PREDICATES, ...PAYMENT_PREDICATES].map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
