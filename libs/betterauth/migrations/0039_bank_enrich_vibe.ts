import { type Kysely, sql } from 'kysely'

// board 0097 — wire the Kontoauszug (bank statement) flow into the new architecture. The `capture-bank`
// enrich node had no vibe, so a bank run produced no card and (with the enrich fix) now persists the
// account-holder company + every line as a transaction≡pleji predication. Give its enrich node the
// `contact` vibe (fed by the enrich's `contact` output = the account holder) so the run shows a card,
// mirroring the invoice `capture` flow. Flow config only (Layer A); forward-only. aven-db untouched.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'capture-bank'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.id === 'enrich') {
			n.vibe = 'contact'
			n.vibeOutput = 'contact'
		}
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'capture-bank'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (flow config).
}
