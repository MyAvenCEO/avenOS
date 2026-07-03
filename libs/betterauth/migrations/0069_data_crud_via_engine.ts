import { type Kysely, sql } from 'kysely'

// board 0107 — data CRUD now runs through the ONE universal executor `crud()` (actor-run.ts), which
// dispatches every action to a NAMED operation (<schema>.<verb>) via runNamedOp over the universal engine.
// The board-0111 sandbox flip (running CRUD as the data_crud actor's `code`) is therefore retired: the
// chat tool loop and the /api/data REST handlers both call crud() directly. Null the vestigial `code` so
// the actor config matches reality (an engine-by-name actor whose mailbox is its advertised tool schema).
// The QuickJS sandbox infrastructure (actor-sandbox.ts) stays for genuine code actors; only the CRUD flip
// is undone. The DATA_CRUD_CODE constant remains as a tested sandbox example.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET code = NULL, updated_at = now() WHERE name = 'data_crud'`.execute(db)
}

export async function down(): Promise<void> {
	// Forward-only: re-running 0066/0068 restores the code; crud() ignores it either way.
}
