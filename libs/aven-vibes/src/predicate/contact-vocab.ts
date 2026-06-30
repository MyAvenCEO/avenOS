// Contact + transaction predicate vocabulary — board 0092 step 3. The relational enrichment layer:
// a person (prenu) OR a company (kagni), each named (cmene) with channels (judri) + identifiers (cmene);
// an Ansprechpartner is a person who REPRESENTS (krati) a company; a transaction (pleji) settles an
// invoice via its goods place (x4) and is booked (cmima) to an SKR04 account.
//
// KEY IDEA: the channel/identifier TYPE is encoded in the PREDICATE NAME (email/phone/iban ≡ judri;
// vat_id/tax_number ≡ cmene), so each predicate's places stay 100% gismu-faithful (no short categorical
// label stuffed into a ref slot). All are generic + reusable across any entity.
import { compilePredicate, type PredicateDef, predSchemaName } from './compile.js'

const entityRef = (role: string, gismu: string) => ({
	pos: 'x2',
	role,
	gloss: `the ${role} this belongs to — ${gismu} x2`,
	kind: 'ref' as const,
	references: '*'
})

// ── Entities (the row IS the person/company; no stored places — name/channels hang off it) ──────────
export const PERSON: PredicateDef = {
	predicate: 'person',
	gismu: 'prenu',
	gloss: 'prenu: x1 is a person — a human contact (the row is the person)',
	places: []
}
export const COMPANY: PredicateDef = {
	predicate: 'company',
	gismu: 'kagni',
	gloss: 'kagni: x1 is a company/firm/legal entity — an organisation contact (the row is the company)',
	places: []
}

// ── Name + identifiers (cmene: x1 the name/id value, x2 the named entity) ────────────────────────────
const cmeneId = (predicate: string, label: string, example: string): PredicateDef => ({
	predicate,
	gismu: 'cmene',
	gloss: `cmene: x1 (the ${label}) is a name/tag of x2 (the contact)`,
	places: [
		{ pos: 'x1', role: label, gloss: `the ${label} — cmene x1 (the quoted name/tag)`, kind: 'value', type: 'string', minLength: 1, example },
		entityRef('named thing', 'cmene')
	]
})
export const NAME: PredicateDef = cmeneId('name', 'name', 'ACME GmbH')
export const VAT_ID: PredicateDef = cmeneId('vat_id', 'VAT-ID', 'DE123456789')
export const TAX_NUMBER: PredicateDef = cmeneId('tax_number', 'tax number', '151/815/08156')

// ── Channels (judri: x1 the address value, x2 the located entity) — type = the predicate name ────────
const channel = (predicate: string, label: string, example: string): PredicateDef => ({
	predicate,
	gismu: 'judri',
	gloss: `judri: x1 (the ${label}) is an address of x2 (the contact)`,
	places: [
		{ pos: 'x1', role: 'address', gloss: `the ${label} — judri x1 (the address)`, kind: 'value', type: 'string', minLength: 1, example },
		entityRef('located', 'judri')
	]
})
export const EMAIL: PredicateDef = channel('email', 'email address', 'billing@acme.example')
export const PHONE: PredicateDef = channel('phone', 'phone number', '+49 30 1234567')
export const IBAN: PredicateDef = channel('iban', 'IBAN', 'DE89370400440532013000')
export const POSTAL: PredicateDef = channel('postal', 'postal address', 'Hauptstr. 1, 10115 Berlin')

// ── Ansprechpartner (krati: x1 representative, x2 represented) ───────────────────────────────────────
export const REPRESENTS: PredicateDef = {
	predicate: 'represents',
	gismu: 'krati',
	gloss: 'krati: x1 (the person) represents/is the agent for x2 (the company) — the Ansprechpartner link',
	places: [
		{ pos: 'x1', role: 'representative', gloss: 'the representing person — krati x1', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'represented', gloss: 'the company represented — krati x2', kind: 'ref', references: '*' }
	]
}

// ── Transaction (pleji: x2 amount, x3 payee, x4 the invoice paid for) + date (detri) + booked (cmima) ─
export const TRANSACTION: PredicateDef = {
	predicate: 'transaction',
	gismu: 'pleji',
	gloss: 'pleji: x2 (the amount) is paid to payee x3 for goods x4 (the settled invoice) — a bank transaction',
	places: [
		{ pos: 'x2', role: 'payment', gloss: 'the amount paid — pleji x2', kind: 'value', type: 'string', example: '26.65' },
		{ pos: 'x3', role: 'payee', gloss: 'the payee (a contact) — pleji x3', kind: 'ref', references: '*', required: false },
		{ pos: 'x4', role: 'goods', gloss: 'the invoice this settles — pleji x4 (the goods paid for)', kind: 'value', type: 'string', required: false, example: '7e776030' }
	]
}
export const DATED: PredicateDef = {
	predicate: 'dated',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of event x2 (the transaction) — the value date',
	places: [
		{ pos: 'x1', role: 'date', gloss: 'the value date — detri x1', kind: 'value', type: 'date-time', example: '2026-03-31' },
		{ pos: 'x2', role: 'event', gloss: 'the transaction — detri x2', kind: 'ref', references: '*' }
	]
}
export const BOOKED: PredicateDef = {
	predicate: 'booked',
	gismu: 'cmima',
	gloss: 'cmima: x1 (the transaction) is a member of set x2 (the SKR04 account it is booked to)',
	places: [
		{ pos: 'x1', role: 'member', gloss: 'the booked transaction — cmima x1', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'set', gloss: 'the SKR04 account (e.g. skr04-4400) — cmima x2', kind: 'ref', references: '*' }
	]
}

/** Person contact bundle. */
export const PERSON_PREDICATES: PredicateDef[] = [PERSON, NAME, EMAIL, REPRESENTS]
/** Company contact bundle. */
export const COMPANY_PREDICATES: PredicateDef[] = [COMPANY, NAME, EMAIL, PHONE, IBAN, POSTAL, VAT_ID, TAX_NUMBER]
/** Transaction (reconciliation) bundle. */
export const TRANSACTION_PREDICATES: PredicateDef[] = [TRANSACTION, DATED, BOOKED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries (contacts + transactions). */
export function contactPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	const all = [...PERSON_PREDICATES, ...COMPANY_PREDICATES, ...TRANSACTION_PREDICATES]
	const seen = new Set<string>()
	return all
		.filter((d) => (seen.has(d.predicate) ? false : seen.add(d.predicate)))
		.map((def) => ({ name: predSchemaName(def), jsonSchema: compilePredicate(def) }))
}
