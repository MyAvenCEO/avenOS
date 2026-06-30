// Invoice predicate vocabulary — board 0090, completed to FULL gismu places (board 0097). Every
// predicate carries EVERY place its gismu defines (unused ones `required: false`):
//   invoice ≡ janta — x1 account · x2 goods · x3 billed-party · x4 biller   [the row IS the invoice]
//   total   ≡ jdima — x1 price · x2 item · x3 purchaser · x4 vendor
//   line    ≡ pagbu — x1 part · x2 whole
//   description ≡ skicu · quantity ≡ klani · unit_price/line_amount ≡ jdima
//   payment ≡ pleji — x1 payer · x2 payment · x3 payee · x4 goods   ·   paid_on ≡ detri
// The invoice NUMBER is no longer its own `number`≡cmene — it folds into the universal
// `identifier`≡tcita (x1=`idkind-invoice_number`, x2=invoice, x3=the number). The transitional
// `vendor`≡vecnu is retired: the biller is the invoice's janta.x4 (a contact ref, set by enrich).
// owned_by/due/source/produced are reused from the todo/document vocab. See [[universal-predication-schema-0084]].
import { compilePredicate, type PredicateDef, predSchemaName, ref, val } from './compile.js'

// janta: x1 account/bill (the invoice entity, the row), x2 goods, x3 billed-party (us), x4 biller.
export const INVOICE: PredicateDef = {
	predicate: 'invoice',
	gismu: 'janta',
	gloss: 'janta: x1 (the bill/account — the invoice entity) for goods x2, billed to party x3 by biller x4',
	places: [
		ref('x1', 'account', 'the bill/invoice itself — janta x1 (the row; implicit, the entity)', {
			required: false
		}),
		ref('x2', 'goods', 'the goods/services billed — janta x2 (open; itemised as line children)', {
			required: false
		}),
		ref('x3', 'billed party', 'who the invoice is billed to — janta x3 (the debtor; us)', {
			references: 'user'
		}),
		ref('x4', 'biller', 'who issued the invoice — janta x4 (the vendor company, a contact ref)', {
			required: false
		})
	]
}

// jdima: x1 the price/total, x2 item (the invoice), x3 purchaser, x4 vendor.
export const TOTAL: PredicateDef = {
	predicate: 'total',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the total amount) is the price of x2 (the invoice) to purchaser x3 set by vendor x4',
	places: [
		val('x1', 'price', 'the invoice total, e.g. "1200.00" — jdima x1 (the price/amount)', 'string', {
			example: '1200.00'
		}),
		ref('x2', 'item', 'the invoice this is the price of — jdima x2 (the item)'),
		ref('x3', 'purchaser', 'the purchaser/consumer — jdima x3 (open)', { required: false }),
		ref('x4', 'vendor', 'the vendor that set the price — jdima x4 (open)', { required: false })
	]
}

// ── Line items (board 0092): each line is its OWN sub-entity, a child of the invoice ─────────────────
// line ≡ pagbu (x1 the part/line, x2 the whole/invoice); attributes hang off the line.
export const LINE: PredicateDef = {
	predicate: 'line',
	gismu: 'pagbu',
	gloss: 'pagbu: x1 (the line) is a part/component of x2 (the invoice) — a single invoice line item',
	places: [
		ref('x1', 'part', 'the line itself — pagbu x1 (the row; implicit, the part)', { required: false }),
		ref('x2', 'whole', 'the invoice this line belongs to — pagbu x2 (the whole)')
	]
}

export const DESCRIPTION: PredicateDef = {
	predicate: 'description',
	gismu: 'skicu',
	gloss: 'skicu: x1 (the describer) describes x2 (the line) to audience x3 with description x4 — the line text',
	places: [
		ref('x1', 'describer', 'who produced the description — skicu x1 (open)', { required: false }),
		ref('x2', 'subject', 'the described line — skicu x2 (the subject)'),
		ref('x3', 'audience', 'who the description is for — skicu x3 (open)', { required: false }),
		val('x4', 'description', 'the description text — skicu x4', 'string', {
			minLength: 1,
			example: 'Beratung (Stunden)'
		})
	]
}

export const QUANTITY: PredicateDef = {
	predicate: 'quantity',
	gismu: 'klani',
	gloss: 'klani: x1 (the line) is a quantity measured by amount x2 on scale x3 — the line quantity',
	places: [
		ref('x1', 'quantity', 'the measured thing (the line) — klani x1'),
		val('x2', 'amount', 'the quantity value — klani x2 (the amount)', 'string', { example: '3' }),
		val('x3', 'scale', 'the unit/scale measured on — klani x3 (open, e.g. hours)', 'string', {
			required: false
		})
	]
}

export const UNIT_PRICE: PredicateDef = {
	predicate: 'unit_price',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the unit price) is the price of x2 (the line) to purchaser x3 set by vendor x4 — per-unit',
	places: [
		val('x1', 'price', 'the unit price — jdima x1', 'string', { example: '100.00' }),
		ref('x2', 'item', 'the line — jdima x2 (the item)'),
		ref('x3', 'purchaser', 'the purchaser — jdima x3 (open)', { required: false }),
		ref('x4', 'vendor', 'the vendor — jdima x4 (open)', { required: false })
	]
}

export const LINE_AMOUNT: PredicateDef = {
	predicate: 'line_amount',
	gismu: 'jdima',
	gloss: 'jdima: x1 (the line total) is the price of x2 (the line) to purchaser x3 set by vendor x4 — qty × unit',
	places: [
		val('x1', 'price', 'the line total — jdima x1', 'string', { example: '300.00' }),
		ref('x2', 'item', 'the line — jdima x2 (the item)'),
		ref('x3', 'purchaser', 'the purchaser — jdima x3 (open)', { required: false }),
		ref('x4', 'vendor', 'the vendor — jdima x4 (open)', { required: false })
	]
}

// ── Payments (board 0092): each payment is a child sub-entity of the invoice ─────────────────────────
// payment ≡ pleji (x1 payer, x2 amount, x3 payee, x4 the invoice/goods paid for).
export const PAYMENT: PredicateDef = {
	predicate: 'payment',
	gismu: 'pleji',
	gloss: 'pleji: x1 (the payer) pays amount x2 to payee x3 for x4 (the invoice) — a payment toward the invoice',
	places: [
		ref('x1', 'payer', 'who paid — pleji x1 (open)', { required: false }),
		val('x2', 'payment', 'the amount paid — pleji x2 (the payment)', 'string', { example: '300.00' }),
		ref('x3', 'payee', 'who was paid — pleji x3 (open)', { required: false }),
		val('x4', 'goods', 'the invoice paid for — pleji x4 (the goods)', 'string', { example: '7e776030' })
	]
}

export const PAID_ON: PredicateDef = {
	predicate: 'paid_on',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of payment x2 at location x3 by calendar x4 — when paid',
	places: [
		val('x1', 'date', 'the payment date — detri x1', 'date-time', { example: '2026-07-09' }),
		ref('x2', 'event', 'the payment — detri x2 (the event)'),
		ref('x3', 'location', 'where reckoned — detri x3 (open)', { required: false }),
		val('x4', 'calendar', 'the calendar — detri x4 (open)', 'string', { required: false })
	]
}

/** The invoice headline predicate bundle (owned_by/due/source/produced reused; number → identifier). */
export const INVOICE_PREDICATES: PredicateDef[] = [INVOICE, TOTAL]
/** The line-item sub-entity bundle (board 0092). */
export const LINE_PREDICATES: PredicateDef[] = [LINE, DESCRIPTION, QUANTITY, UNIT_PRICE, LINE_AMOUNT]
/** The payment sub-entity bundle (board 0092). */
export const PAYMENT_PREDICATES: PredicateDef[] = [PAYMENT, PAID_ON]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries (headline + lines + payments). */
export function invoicePredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return [...INVOICE_PREDICATES, ...LINE_PREDICATES, ...PAYMENT_PREDICATES].map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}
