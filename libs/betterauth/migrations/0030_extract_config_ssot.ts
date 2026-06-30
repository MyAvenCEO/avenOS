import { getDoctype } from '@avenos/aven-vibes/doctypes'
import { type Kysely, sql } from 'kysely'

// board 0093 step 1 — make the FLOW NODE CONFIG the single source of truth for extraction. Embed each
// doctype's detailed system_prompt + tool-call schema into its `extract_document` node (capture →
// invoice, capture-bank → bank_statement), so a generic extractor is driven entirely by node config.
// Also retire the redundant `invoice-ingest` flow — Invoice Processing's capture leg subsumes it.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

async function embed(db: Kysely<unknown>, flowId: string, doctypeName: string): Promise<void> {
	const dt = getDoctype(doctypeName)
	if (!dt) throw new Error(`0093: no doctype "${doctypeName}"`)
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = ${flowId}`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.actor === 'extract_document') {
			n.system_prompt = dt.system_prompt
			n.schema = dt.schema
		}
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = ${flowId}`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await embed(db, 'capture', 'invoice')
	await embed(db, 'capture-bank', 'bank_statement')
	// retire the redundant invoice-ingest flow (subsumed by Invoice Processing's capture leg)
	await sql`DELETE FROM flow WHERE id = 'invoice-ingest'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only: the prompt/schema embedding + invoice-ingest removal are not auto-restored.
}
