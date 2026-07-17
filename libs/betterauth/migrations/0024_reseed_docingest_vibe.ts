import { EXAMPLE_FLOWS } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// Re-seed `doc-ingest` (board 0091) so its `classify` node carries the `vibe` ("bookkeeping") used for
// per-step vibe streaming. The 0008 seed predates the vibe field, and migrations don't re-run — so
// this upserts the current config. invoice-ingest / invoice flatten doc-ingest at runtime, so this is
// enough for the classify card to surface everywhere.

export async function up(db: Kysely<unknown>): Promise<void> {
	const f = EXAMPLE_FLOWS.find((x) => x.id === 'doc-ingest')
	if (!f) return
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
		VALUES (
			${f.id}, ${f.name}, ${f.description ?? ''},
			${JSON.stringify(f.nodes)}::jsonb, ${JSON.stringify(f.edges)}::jsonb,
			${f.triggers ? JSON.stringify(f.triggers) : null}::jsonb,
			${f.resourceLabels ? JSON.stringify(f.resourceLabels) : null}::jsonb
		)
		ON CONFLICT (id) DO UPDATE SET nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, updated_at = now()
	`.execute(db)
}

export async function down(): Promise<void> {
	// keep the vibe-tagged config
}
