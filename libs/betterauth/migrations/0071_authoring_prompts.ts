import { type Kysely, sql } from 'kysely'
import { MUTATION_INSTRUCTIONS, QUERY_INSTRUCTIONS } from '../src/query-caps'

// board 0112 — the GLM authoring instructions become DB CONFIG: seed the query/mutate ACTOR rows' `prompt`
// column from the TS SSOT constants (which now also teach the chained-join graph grammar + the 0107
// filter/null-op grammar). authoringInstructions() reads the row first, TS constant only as the fail-safe
// fallback — so editing how GLM authors specs is editing a DB row, the pattern a GLM-minted skill's own
// authoring prompts will follow (0113). Idempotent upsert-by-name.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET prompt = ${QUERY_INSTRUCTIONS}, updated_at = now() WHERE name = 'query'`.execute(
		db
	)
	await sql`UPDATE actor SET prompt = ${MUTATION_INSTRUCTIONS}, updated_at = now() WHERE name = 'mutate'`.execute(
		db
	)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// revert to the pre-0112 state: no stored prompt → the TS fallback serves.
	await sql`UPDATE actor SET prompt = NULL, updated_at = now() WHERE name IN ('query', 'mutate')`.execute(
		db
	)
}
