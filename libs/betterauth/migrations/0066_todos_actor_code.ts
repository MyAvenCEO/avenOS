import { type Kysely, sql } from 'kysely'
import { DATA_CRUD_CAPS, DATA_CRUD_CODE } from '../src/todos-code'

// board 0111 — the LIVE flip. Seed the todos/CRUD behavior as sandboxed `code` (+ the `ops` cap) onto the
// data_crud actor row. `runData()` (actor-run.ts) now runs the chat's CRUD through the QuickJS-WASM sandbox
// via that code — the SSOT — instead of the TS engine. Fail-safe by design: any sandbox error (or a schema
// with no derived ops) falls back to executeDataTool, so this is fully reversible — clearing the code column
// (the `down` here) reverts the chat to the engine path with zero behavior change.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor
		SET code = ${DATA_CRUD_CODE}, caps = ${sql`${JSON.stringify(DATA_CRUD_CAPS)}::jsonb`}, updated_at = now()
		WHERE name = ${'data_crud'}
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET code = NULL, caps = NULL WHERE name = ${'data_crud'}`.execute(db)
}
