import { type Kysely, sql } from 'kysely'

// board 0093 fix — the capture flow's `extract_document` node carried no `vibe`, so the invoice card
// never streamed into chat / the Runs trace. Tag it `vibe: 'invoice'` so the rich extraction renders
// the invoice vibe card (the runner copies node.vibe + the primary output onto the TraceStep). 0091/0093.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'capture'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.actor === 'extract_document') n.vibe = 'invoice'
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'capture'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only.
}
