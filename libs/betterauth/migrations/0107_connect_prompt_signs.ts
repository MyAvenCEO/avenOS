import { type Kysely, sql } from 'kysely'

// board 0117 — the SECOND live "0 erstellt" had clean structure but INVERTED SIGNS (amount > 0
// counted as purchase, while the banking rules say purchases are NEGATIVE) — net 0 everywhere, a
// plausible no-op. The prompt learns explicit sign-attention; the smoke gate gained the semantic
// tripwire (a source-trigger run that mutates nothing on the target is rejected).

const ADDITION = [
	'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
	'SIGN CONVENTIONS: read each schema’s data rules CAREFULLY and map them EXACTLY — e.g. when the',
	'rules say purchases are NEGATIVE amounts, then amount < 0 IS a purchase (Kauf ⇒ Bestand steigt) and',
	'amount > 0 is a sale. Getting the sign backwards silently reconciles nothing.'
].join('\n')

export async function up(db: Kysely<unknown>): Promise<void> {
	const r = await sql<{ id: string; prompt: string | null }>`
		SELECT id, prompt FROM actor WHERE name = 'connect_skills'
	`.execute(db)
	for (const row of r.rows) {
		const cur = row.prompt ?? ''
		if (cur.includes('SIGN CONVENTIONS')) continue
		const next = cur.replace(
			'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
			ADDITION
		)
		await sql`UPDATE actor SET prompt = ${next}, updated_at = now() WHERE id = ${row.id}`.execute(db)
	}
}

export async function down(): Promise<void> {
	// re-run 0106 to restore the previous prompt.
}
