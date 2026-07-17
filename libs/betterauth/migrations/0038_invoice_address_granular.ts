import { type Kysely, sql } from 'kysely'

// board 0097 follow-up — the invoice extract view shows the party STREET + USt-IdNr but not the PLZ /
// Ort, even though the schema has `postal_code` + `city` and partyCard already renders them. Root
// cause: those two fields are the ONLY address fields with an EMPTY description in the extract node
// schema (street/country/tax_id all carry strong ones), so the vision model under-extracts them.
// Give `postal_code` + `city` (and reinforce `street`) real descriptions on BOTH vendor + buyer so the
// address is extracted granularly, field-by-field. Prompt/schema-text only; forward-only. aven-db untouched.

const DESC: Record<string, string> = {
	street: 'Street + house number ONLY (e.g. "Industriestr. 25") — not the PLZ or city.',
	postal_code: 'Postal code / PLZ / ZIP ONLY (e.g. "91710") — the postal code on its own, never combined with the city or street.',
	city: 'City / Ort ONLY (e.g. "Gunzenhausen") — the city name on its own, never combined with the PLZ or street.'
}

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
		const schema = n.schema as Record<string, unknown> | undefined
		const props = (schema?.properties ?? {}) as Record<string, { properties?: Record<string, unknown> }>
		for (const party of ['vendor', 'buyer']) {
			const pp = props[party]?.properties as Record<string, { description?: string }> | undefined
			if (!pp) continue
			for (const [field, description] of Object.entries(DESC)) {
				if (pp[field]) pp[field].description = description
			}
		}
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'capture'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (schema description text).
}
