import { type Kysely, sql } from 'kysely'

// board 0098 — the reference prompt (0041) is great on structure but the model still under-fills the
// PARTY sub-fields (PLZ/city/country/email/phone) and leaks labels into ids (e.g. "DE VAT DE368356417").
// Prepend a strong PARTY COMPLETENESS + CLEAN-IDENTIFIER directive to BOTH extract prompts (capture +
// capture-bank), on top of the reference system prompt. Flow config only; forward-only. aven-db untouched.

const DIRECTIVE = `PARTY COMPLETENESS — for EVERY party on the document (vendor/biller, buyer/recipient, and — on statements — the account_holder + institution): fill the party's COMPLETE printed block, never just name + street. Read the whole letterhead, footer AND imprint — a PLZ+Ort, an e-mail, a phone or an IBAN printed anywhere on the page belongs on the party even when it is not on the same line as the name. Fill, whenever printed:
- \`name\` (the legal entity name);
- the FULL postal address, each part in its OWN field: \`street\` (street + house number), \`postal_code\` (PLZ/ZIP, e.g. 80469 or 10025), \`city\` (e.g. München / San Francisco), \`country\` (full English name, e.g. Germany / United States);
- \`email\`, \`phone\`;
- \`tax_id\` and \`tax_number\` — see CLEAN IDENTIFIERS.
Only leave a field null when the document genuinely does not print it.

CLEAN IDENTIFIERS — put the BARE value in each id field, never the printed label or currency/country word: \`tax_id\` = the VAT-ID digits ONLY (e.g. "DE368356417", "ATU12345678", or a US EIN like "87-4436547") — strip prefixes such as "DE VAT", "USt-IdNr.:", "VAT", "St.Nr.". \`invoice_number\` = exactly the characters printed (keep spaces; do not substitute a "*").

`

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

async function prepend(db: Kysely<unknown>, flowId: string): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = ${flowId}`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.actor !== 'extract_document') continue
		const prompt = typeof n.system_prompt === 'string' ? n.system_prompt : ''
		if (prompt.startsWith('PARTY COMPLETENESS')) continue // idempotent
		n.system_prompt = DIRECTIVE + prompt
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = ${flowId}`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await prepend(db, 'capture')
	await prepend(db, 'capture-bank')
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (prompt text).
}
