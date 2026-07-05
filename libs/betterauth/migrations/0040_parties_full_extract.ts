import { type Kysely, sql } from 'kysely'

// board 0098 — parties come back sparse (just name + street + tax_id) even though the extract schema
// has every party field. The gap is the PROMPT: it doesn't force the model to fill the COMPLETE printed
// party block. Prepend a strong party-completeness directive to BOTH the invoice (`capture`) and the
// bank-statement (`capture-bank`) extract prompts so every printed party detail is captured. Flow config
// only (Layer A); forward-only. aven-db untouched.

const DIRECTIVE = `PARTY COMPLETENESS — for EVERY party on the document (vendor/biller, buyer/recipient, and — on statements — the account_holder + institution): extract the party's COMPLETE printed block, never just name + street. Fill, whenever the document prints it:
- the legal entity \`name\`;
- the FULL postal address, each part in its OWN field: \`street\` (street + house number), \`postal_code\` (PLZ/ZIP), \`city\`, \`country\` (full English name);
- \`email\`, \`phone\`;
- \`tax_id\` (USt-IdNr / VAT-ID) and \`tax_number\` (Steuernummer) — each its own value;
- every printed IBAN/BIC under \`banking_accounts\`;
- the register / imprint details (HRB, Registergericht, Geschäftsführer) under \`org_public_record\` when shown.
Read the whole letterhead, footer and imprint — a PLZ+Ort, an e-mail, or an IBAN printed anywhere on the page belongs on the party even if it is not next to the name. Only leave a field null when it is genuinely not printed.

`

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

async function prependDirective(db: Kysely<unknown>, flowId: string): Promise<void> {
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
	await prependDirective(db, 'capture')
	await prependDirective(db, 'capture-bank')
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (prompt text).
}
