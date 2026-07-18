import { type Kysely, sql } from 'kysely'

// board aven-voice — declare the `all` delete flag on every data_crud tool. "Delete all" is now EXPLICIT
// (all:true) so a bare delete can never wipe a schema by accident; the model needs the param declared to
// pass it reliably. Patches each data_crud actor's mailbox in place, idempotently.

export async function up(db: Kysely<unknown>): Promise<void> {
	try {
		const rows = await sql<{ id: string; mailbox: unknown }>`SELECT id, mailbox FROM actor WHERE name = 'data_crud'`.execute(db)
		for (const r of rows.rows) {
			const mb = (typeof r.mailbox === 'string' ? JSON.parse(r.mailbox) : r.mailbox) as {
				parameters?: { properties?: Record<string, unknown> }
			}
			if (!mb?.parameters?.properties) continue
			mb.parameters.properties.all = {
				type: 'boolean',
				description: 'Delete ALL rows of this schema — set ONLY for "delete everything"; needs no ids.'
			}
			await sql`UPDATE actor SET mailbox = ${JSON.stringify(mb)}::jsonb, updated_at = now() WHERE id = ${r.id}`.execute(db)
		}
	} catch (e) {
		console.error('[migrate 0128] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// forward-only param addition.
}
