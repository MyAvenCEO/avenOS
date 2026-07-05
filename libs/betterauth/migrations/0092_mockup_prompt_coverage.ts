import { type Kysely, sql } from 'kysely'
import { MOCKUP_INSTRUCTIONS } from '../src/mockup-caps'

// board 0115 — LIVE FINDING from the first real mint (mock-banking-overview): GLM referenced view keys
// the example source didn't carry → an empty GESAMTSALDO card. The prompt now demands full coverage
// (every $key / $$field must carry a real value) and saveMockup enforces it deterministically (gate 4).
// Re-seed the strengthened prompt onto both GLM actor rows (prompt is config).

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor SET prompt = ${MOCKUP_INSTRUCTIONS}, updated_at = now()
		WHERE skill_id = 'skillify' AND name IN ('create_mockup', 'edit_mockup')
	`.execute(db)
}

export async function down(): Promise<void> {
	// prompt revert = re-run 0091.
}
