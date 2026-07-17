import { type Kysely, sql } from 'kysely'

// The banking-overview actor's parseAmount() assumed GERMAN number format and
// stripped ALL dots as thousands separators — but the model (and stored rows)
// use US decimals ("-244.00", "-60.2"). Stripping the dot turned 244.00 into
// 24400, hence "-24.400,00 €" for a 244 € booking.
//
// Fix: only treat a dot as a thousands separator when a COMMA is present
// (real German format). With no comma, the dot is a decimal point and stays.
// Applied as an in-place code patch so it reaches every DB (dev + next); the
// actor is config-minted, so there is no source file to edit.

const OLD = "    s = s.replace(/[−-]/g, '').replace(/\\./g, '').replace(',', '.');"
const NEW =
	"    s = s.replace(/[−-]/g, '');\n" +
	"    if (s.indexOf(',') !== -1) { s = s.replace(/\\./g, '').replace(',', '.'); }"

// position() (not LIKE) — the code contains no LIKE wildcards but does contain
// characters LIKE would misinterpret; position() is a literal substring match.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor
		SET code = replace(code, ${OLD}, ${NEW}), updated_at = now()
		WHERE name = 'banking-overview_overview' AND position(${OLD} in code) > 0
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor
		SET code = replace(code, ${NEW}, ${OLD}), updated_at = now()
		WHERE name = 'banking-overview_overview' AND position(${NEW} in code) > 0
	`.execute(db)
}
