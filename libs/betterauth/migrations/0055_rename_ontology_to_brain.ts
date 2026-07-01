import { type Kysely, sql } from 'kysely'

// board 0100/0101 — rename the "ontology" skill to "brain" everywhere it lives in the DB: the flow row
// (id + display name), the node actor labels, the persisted flow_run traces, and the re-hydratable chat
// vibe markers (ontology / ontology-created → brain / brain-created). The tool + code were renamed in the
// same commit; this keeps the live data consistent. Forward-only.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the flow: id ontology → brain, name Ontology → Brain, node.actor ontology → brain.
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (row) {
		const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
		for (const n of nodes) if (n.actor === 'ontology') n.actor = 'brain'
		await sql`
			UPDATE flow SET id = 'brain', name = 'Brain', nodes = ${JSON.stringify(nodes)}::jsonb, updated_at = now()
			WHERE id = 'ontology'
		`.execute(db)
	}
	// 2. run traces point at the renamed flow.
	await sql`UPDATE flow_run SET flow_id = 'brain' WHERE flow_id = 'ontology'`.execute(db)
	// 3. persisted vibe markers so old chat cards re-hydrate: <ZWSP>aven-vibe:ontology[-created] → brain.
	await sql`UPDATE ai_message SET content = replace(content, 'aven-vibe:ontology-created', 'aven-vibe:brain-created') WHERE content LIKE '%aven-vibe:ontology-created%'`.execute(db)
	await sql`UPDATE ai_message SET content = replace(content, 'aven-vibe:ontology', 'aven-vibe:brain') WHERE content LIKE '%aven-vibe:ontology%'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only.
}
