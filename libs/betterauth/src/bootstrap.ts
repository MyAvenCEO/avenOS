import { getMigrations } from 'better-auth/db/migration'
import { auth } from './auth'
import { migrateToLatest } from './migrate'

/**
 * Self-bootstrap the database schema on startup so a fresh/empty Neon DB just works —
 * no manual `db:migrate` step. Two layers:
 *   1. Better Auth core tables (user/session/account/verification + the admin `role` and
 *      `tier` additional fields), created via the same migration runner the CLI uses.
 *   2. Our own Kysely tables (token usage, pricing, chat sessions/messages, generic data).
 * Both are idempotent: nothing happens once everything already exists. board 0050.
 */
export async function bootstrapSchema(): Promise<void> {
	const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options)
	if (toBeCreated.length > 0 || toBeAdded.length > 0) {
		await runMigrations()
		console.log(
			`[betterauth] auth schema migrated (created ${toBeCreated.length}, altered ${toBeAdded.length})`
		)
	}
	await migrateToLatest()
	console.log('[betterauth] schema bootstrap complete')
}
