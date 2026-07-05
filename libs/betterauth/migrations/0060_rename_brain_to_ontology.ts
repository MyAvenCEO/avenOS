import { type Kysely, sql } from 'kysely'

// board 0100/0102 — rename the skill back from "brain" to "ontology" (reverses migration 0055). By now the
// flow carries five actors (read/create/query/mutate/bundle), all actor='brain'. This renames the flow id +
// name, every node.actor, the run traces, and the persisted chat vibe markers (brain[-created] → ontology)
// so old cards re-hydrate. Forward-only. The on-device "Talk brain" is unrelated and untouched.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the flow: id brain → ontology, name Brain → Ontology, node.actor brain → ontology (every node).
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'brain'`.execute(db)
	const row = res.rows[0]
	if (row) {
		const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
		for (const n of nodes) if (n.actor === 'brain') n.actor = 'ontology'
		await sql`
			UPDATE flow SET id = 'ontology', name = 'Ontology', nodes = ${JSON.stringify(nodes)}::jsonb, updated_at = now()
			WHERE id = 'brain'
		`.execute(db)
	}
	// 2. run traces point at the renamed flow.
	await sql`UPDATE flow_run SET flow_id = 'ontology' WHERE flow_id = 'brain'`.execute(db)
	// 3. persisted vibe markers so old chat cards re-hydrate: <ZWSP>aven-vibe:brain[-created] → ontology.
	await sql`UPDATE ai_message SET content = replace(content, 'aven-vibe:brain-created', 'aven-vibe:ontology-created') WHERE content LIKE '%aven-vibe:brain-created%'`.execute(
		db
	)
	await sql`UPDATE ai_message SET content = replace(content, 'aven-vibe:brain', 'aven-vibe:ontology') WHERE content LIKE '%aven-vibe:brain%'`.execute(
		db
	)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only.
}
