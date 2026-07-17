import { EXAMPLE_FLOWS } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// Re-seed the `invoice-ingest` flow (board 0090) with the COMPOSITE definition — it now reuses
// doc-ingest (store + classify) via flowRef, then extracts. Migration 0022 seeded the earlier flat
// version; migrations don't re-run, so this fresh migration upserts the corrected config.

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

export async function down(): Promise<void> {
	// keep the composite config
}
