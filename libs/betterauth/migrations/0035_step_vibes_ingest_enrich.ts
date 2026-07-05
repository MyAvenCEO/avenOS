import { type Kysely, sql } from 'kysely'

// board 0094 — give the remaining Document-Ingest / capture steps their own vibe cards:
//   doc-ingest.store  → vibe 'ingest'   (an upload/store card) + fix the STALE "fs (sparks/PRIVATE)"
//                       note: storage is Postgres bytea (the `artifact` table, board 0089), not fs.
//   capture.enrich    → vibe 'contact'  + vibeOutput 'contact' (the addressbook-change card reads the
//                       `contact` output, not the primary `invoice`).
// capture.extract already carries vibe 'invoice' (migration 0033).

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

async function patchNodes(
	db: Kysely<unknown>,
	flowId: string,
	patch: (n: Record<string, unknown>) => void
): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = ${flowId}`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) patch(n)
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = ${flowId}`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await patchNodes(db, 'doc-ingest', (n) => {
		if (n.actor === 'storeDocument') {
			n.vibe = 'ingest'
			n.note = 'Store the file / photo content-addressed in Postgres bytea (artifact table, by sha256)'
		}
	})
	await patchNodes(db, 'capture', (n) => {
		if (n.actor === 'enrichAddressbook') {
			n.vibe = 'contact'
			n.vibeOutput = 'contact'
		}
	})
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (vibe tags).
}
