import { type Kysely, sql } from 'kysely'

// board 0096 — the capture/extract prompt came from the board-0064 doctype, which says "Do not output
// vendor" (it assumed a separate parties pipeline we don't have). So the model crammed the VAT-ID field
// with the address+email. Replace the capture.extract node's system_prompt with a VENDOR-FOCUSED one
// that extracts each party field CLEANLY, aligned to the company/person ontology (kagni + cmene
// identifiers + judri channels; prenu Ansprechpartner). Also add a separate `tax_number` (Steuernummer)
// alongside `tax_id` (USt-IdNr / VAT-ID) on vendor + buyer, and tighten their descriptions.

const PROMPT = `You extract a German or English INVOICE into the schema as STRICT JSON. Read the whole document.

VENDOR — the ISSUER / biller (the company that SENT this invoice; letterhead, top-left, or imprint). Fill \`vendor\` with CLEAN, separated fields:
- \`name\`: the legal entity name ONLY (e.g. "Fly.io, Inc.", "Hetzner Online GmbH").
- \`tax_id\`: the VAT-ID / USt-IdNr ONLY — the VAT registration number, e.g. "DE123456789", "ATU12345678", or a US EIN. NEVER put an address, email, phone, or anything else here. null if not printed.
- \`tax_number\`: the German Steuernummer ONLY (e.g. "151/815/08156"), if separately printed. null otherwise.
- \`street\`, \`postal_code\`, \`city\`, \`country\`: the postal address, each in its OWN field (country = full English name).
- \`email\`, \`phone\`: each its own clean value.
- \`banking_accounts\`: one block per printed IBAN/BIC.
- \`contact_name\`: the Ansprechpartner (a natural person named as the contact), if any.
Each field gets ONLY its own value — do NOT concatenate address/email/phone into \`tax_id\`, \`tax_number\`, or \`name\`.

BUYER — the recipient / debtor ("billed to"). Fill \`buyer\` the same way (name, tax_id = VAT-ID only, tax_number, address, email).

HEADER: \`invoice_number\`, \`currency\`, \`issue_date\`/\`due_date\` (YYYY-MM-DD), \`document_kind\`.
TOTALS: \`invoice_total\` (gross total as a decimal), \`tax_breakdown\` (one per rate: \`tax_rate_percent\` + \`tax_amount\`), \`tax_total\`.
STATEMENTS: each position under \`statements[].line_items[]\` with \`description\`, \`quantity\`, \`unit_price\`, \`amount\`.
PAYMENTS: each paid amount with its date.

Output STRICT JSON matching the schema. Use null for anything not printed.`

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'capture'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.actor !== 'extract_document') continue
		n.system_prompt = PROMPT
		const schema = n.schema as Record<string, unknown> | undefined
		const props = (schema?.properties ?? {}) as Record<string, { properties?: Record<string, unknown> }>
		for (const party of ['vendor', 'buyer']) {
			const pp = props[party]?.properties
			if (!pp) continue
			if ((pp as Record<string, unknown>).tax_id) {
				;(pp as Record<string, { tax_id: { description?: string } }>).tax_id.description =
					'VAT-ID / USt-IdNr ONLY (e.g. DE123456789, ATU…) — never an address, email, or other text.'
			}
			;(pp as Record<string, unknown>).tax_number = {
				type: ['string', 'null'],
				description: 'German Steuernummer ONLY (e.g. 151/815/08156), separate from the VAT-ID.'
			}
		}
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'capture'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (prompt/schema text).
}
