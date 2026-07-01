// Contact + transaction predicate vocabulary — board 0092, consolidated + completed (board 0097).
// Every predicate carries EVERY place its canonical gismu defines (unused ones `required: false`).
//
// THE CONSOLIDATION: the per-channel/per-identifier predicates are gone. Instead of four `judri`
// channels (email/phone/iban/postal) and two `cmene` identifiers (vat_id/tax_number), the TYPE moves
// into its proper x-position — as a referenced entity, the faithful Lojban move (no short label in a
// ref slot):
//   address    ≡ judri — x1 the address value · x2 the entity · x3 the SYSTEM (a ref to a stable
//                        `addrsys-{email,phone,iban,postal}` entity)
//   identifier ≡ tcita — x1 the KIND (a ref to a stable `idkind-{vat_id,tax_number,invoice_number}`
//                        entity) · x2 the tagged entity · x3 the id value
//   name       ≡ cmene — x1 the name value · x2 the named entity · x3 the namer
// An Ansprechpartner is a `person` that `represents` (krati) a `company`. A `transaction` (pleji)
// settles an invoice via x4, is dated (detri) and booked (cmima) to an SKR04 account. All generic +
// reusable across any entity. Ownership is the universal owned_by. See [[ontology-gismu-skill]].
import { compilePredicate, type PredicateDef, predSchemaName, ref, val } from './compile.js'

// ── Entities (the row IS the person/company; name/channels/ids hang off it as linked predications) ──
// prenu: x1 the person (the row; implicit). kagni: x1 company, x2 chartering authority, x3 purpose.
export const PERSON: PredicateDef = {
	predicate: 'person',
	gismu: 'prenu',
	gloss: 'prenu: x1 is a person — a human contact (the row is the person)',
	places: [ref('x1', 'person', 'the person — prenu x1 (the row; implicit, the entity)', { required: false })]
}
export const COMPANY: PredicateDef = {
	predicate: 'company',
	gismu: 'kagni',
	gloss: 'kagni: x1 is a company/firm chartered by authority x2 for purpose x3 — an organisation contact',
	places: [
		ref('x1', 'company', 'the company — kagni x1 (the row; implicit, the entity)', { required: false }),
		ref('x2', 'authority', 'the chartering authority — kagni x2 (open)', { required: false }),
		val('x3', 'purpose', 'the company purpose/mission — kagni x3 (open)', 'string', { required: false })
	]
}

// cmene: x1 the name value, x2 the named entity, x3 the namer.
export const NAME: PredicateDef = {
	predicate: 'name',
	gismu: 'cmene',
	gloss: 'cmene: x1 (the name) is a/the name/tag of x2 (the entity) used by namer x3',
	places: [
		val('x1', 'name', 'the name/title — cmene x1 (the quoted name)', 'string', {
			minLength: 1,
			example: 'ACME GmbH'
		}),
		ref('x2', 'named thing', 'the entity named — cmene x2'),
		ref('x3', 'namer', 'who uses/gave the name — cmene x3 (open)', { required: false })
	]
}

// judri: x1 the address value, x2 the located entity, x3 the system (a ref to an addrsys-* entity).
// ONE predicate for every channel — the channel TYPE is x3, not the predicate name.
export const ADDRESS: PredicateDef = {
	predicate: 'address',
	gismu: 'judri',
	gloss: 'judri: x1 (the address) locates x2 (the entity) in addressing system x3 (email/phone/iban/postal)',
	places: [
		val('x1', 'address', 'the address/coordinate value — judri x1 (e.g. an email, phone, IBAN, street)', 'string', {
			minLength: 1,
			example: 'billing@acme.example'
		}),
		ref('x2', 'located', 'the entity this addresses — judri x2 (the located thing)'),
		ref('x3', 'system', 'the addressing system — judri x3 (a ref to addrsys-email/phone/iban/postal)', {
			example: 'addrsys-email'
		})
	]
}

// tcita: x1 the label/kind (a ref to an idkind-* entity), x2 the tagged entity, x3 the information (the
// id value). ONE predicate for every identifier — the KIND is x1, the value is x3.
export const IDENTIFIER: PredicateDef = {
	predicate: 'identifier',
	gismu: 'tcita',
	gloss: 'tcita: x1 (the id kind) tags x2 (the entity) showing information x3 (the id value) — VAT-ID / Steuernr / …',
	places: [
		ref('x1', 'label', 'the identifier KIND — tcita x1 (a ref to idkind-vat_id/tax_number/invoice_number)', {
			example: 'idkind-vat_id'
		}),
		ref('x2', 'labeled', 'the entity this identifies — tcita x2 (the tagged thing)'),
		val('x3', 'information', 'the identifier value — tcita x3 (e.g. DE123456789)', 'string', {
			minLength: 1,
			example: 'DE123456789'
		})
	]
}

// krati: x1 representative (the person), x2 represented (the company), x3 the matter — the Ansprechpartner.
export const REPRESENTS: PredicateDef = {
	predicate: 'represents',
	gismu: 'krati',
	gloss: 'krati: x1 (the person) represents/is the agent for x2 (the company) in matter x3 — the Ansprechpartner link',
	places: [
		ref('x1', 'representative', 'the representing person — krati x1'),
		ref('x2', 'represented', 'the company represented — krati x2'),
		val('x3', 'matter', 'the matter represented in — krati x3 (open)', 'string', { required: false })
	]
}

// ── Transaction (pleji: x1 payer, x2 amount, x3 payee, x4 the invoice paid for) + dated + booked ─────
export const TRANSACTION: PredicateDef = {
	predicate: 'transaction',
	gismu: 'pleji',
	gloss: 'pleji: x1 (the payer) pays amount x2 to payee x3 for goods x4 (the settled invoice) — a bank transaction',
	places: [
		ref('x1', 'payer', 'who paid — pleji x1 (open)', { required: false }),
		val('x2', 'payment', 'the amount paid — pleji x2 (the payment)', 'string', { example: '26.65' }),
		ref('x3', 'payee', 'the payee (a contact) — pleji x3', { required: false }),
		val('x4', 'goods', 'the invoice this settles — pleji x4 (the goods paid for)', 'string', {
			required: false,
			example: '7e776030'
		})
	]
}
export const DATED: PredicateDef = {
	predicate: 'dated',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of event x2 at location x3 by calendar x4 — the value date',
	places: [
		val('x1', 'date', 'the value date — detri x1', 'date-time', { example: '2026-03-31' }),
		ref('x2', 'event', 'the transaction — detri x2 (the event)'),
		ref('x3', 'location', 'where reckoned — detri x3 (open)', { required: false }),
		val('x4', 'calendar', 'the calendar — detri x4 (open)', 'string', { required: false })
	]
}
export const BOOKED: PredicateDef = {
	predicate: 'booked',
	gismu: 'cmima',
	gloss: 'cmima: x1 (the transaction) is a member of set x2 (the SKR04 account it is booked to)',
	places: [
		ref('x1', 'member', 'the booked transaction — cmima x1'),
		ref('x2', 'set', 'the SKR04 account (e.g. skr04-4400) — cmima x2')
	]
}

// ── Bank-statement fidelity (board 0098) — a transaction carries two dates + a running balance ────────
// value_dated≡detri (the value/Wertstellung date, distinct from the booking date), balance≡klani (the
// running account balance after the line). currency + the FX cluster reuse the universal identifier≡tcita
// (idkind-currency / idkind-exchange_rate / …) so no per-scalar predicate is minted. board 0098.
export const VALUE_DATED: PredicateDef = {
	predicate: 'value_dated',
	gismu: 'detri',
	gloss: 'detri: x1 (the value date) is the date of event x2 (the transaction) at location x3 by calendar x4',
	places: [
		val('x1', 'date', 'the value/Wertstellung date — detri x1', 'date-time', { example: '2026-03-31' }),
		ref('x2', 'event', 'the transaction — detri x2 (the event)'),
		ref('x3', 'location', 'where reckoned — detri x3 (open)', { required: false }),
		val('x4', 'calendar', 'the calendar — detri x4 (open)', 'string', { required: false })
	]
}
export const BALANCE: PredicateDef = {
	predicate: 'balance',
	gismu: 'klani',
	gloss: 'klani: x1 (the transaction) is a quantity measured by amount x2 (the running balance) on scale x3 (the currency)',
	places: [
		ref('x1', 'quantity', 'the transaction whose running balance this is — klani x1'),
		val('x2', 'amount', 'the running account balance after the line — klani x2', 'string', { example: '1234.56' }),
		val('x3', 'scale', 'the currency the balance is in — klani x3 (open)', 'string', { required: false, example: 'EUR' })
	]
}

// ── Reconciliation (board 0098) — a transaction is MATCHED to the invoice it settles ─────────────────
// mapti: x1 fits/corresponds to x2 in aspect x3. matched: x1 the transaction, x2 the invoice, x3 the
// confidence/aspect of the match — the Beleg↔Buchung link that drives the "belegt" status.
export const MATCHED: PredicateDef = {
	predicate: 'matched',
	gismu: 'mapti',
	gloss: 'mapti: x1 (the transaction) fits/corresponds to x2 (the invoice it settles) in aspect x3 (confidence)',
	places: [
		ref('x1', 'fitting thing', 'the transaction — mapti x1'),
		ref('x2', 'counterpart', 'the invoice it settles — mapti x2'),
		val('x3', 'aspect', 'the match confidence/aspect — mapti x3 (open, e.g. high/iban/amount+date)', 'string', {
			required: false,
			example: 'high'
		})
	]
}

/** Person contact bundle. */
export const PERSON_PREDICATES: PredicateDef[] = [PERSON, NAME, ADDRESS, IDENTIFIER, REPRESENTS]
/** Company contact bundle. */
export const COMPANY_PREDICATES: PredicateDef[] = [COMPANY, NAME, ADDRESS, IDENTIFIER]
/** Transaction (bank-statement + reconciliation) bundle. board 0098 adds value_dated/balance/matched. */
export const TRANSACTION_PREDICATES: PredicateDef[] = [TRANSACTION, DATED, VALUE_DATED, BALANCE, BOOKED, MATCHED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries (contacts + transactions). */
export function contactPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	const all = [...PERSON_PREDICATES, ...COMPANY_PREDICATES, ...TRANSACTION_PREDICATES]
	const seen = new Set<string>()
	return all
		.filter((d) => (seen.has(d.predicate) ? false : seen.add(d.predicate)))
		.map((def) => ({ name: predSchemaName(def), jsonSchema: compilePredicate(def) }))
}
