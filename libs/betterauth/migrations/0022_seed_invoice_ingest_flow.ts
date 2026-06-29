import { EXAMPLE_FLOWS } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// Seed (upsert) the `invoice-ingest` flow (board 0090) into the admin `flow` table so the generic
// runner can load + execute it. The 0008 seed only ran once; this adds the new flow idempotently.

export async function up(db: Kysely<unknown>): Promise<void> {
	const f = EXAMPLE_FLOWS.find((x) => x.id === 'invoice-ingest')
	if (!f) return
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
		VALUES (
			${f.id}, ${f.name}, ${f.description ?? ''},
			${JSON.stringify(f.nodes)}::jsonb, ${JSON.stringify(f.edges)}::jsonb,
			${f.triggers ? JSON.stringify(f.triggers) : null}::jsonb,
			${f.resourceLabels ? JSON.stringify(f.resourceLabels) : null}::jsonb
		)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description,
			nodes = EXCLUDED.nodes, edges = EXCLUDED.edges,
			triggers = EXCLUDED.triggers, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM flow WHERE id = 'invoice-ingest'`.execute(db)
}
