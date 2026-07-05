import { type Kysely, sql } from 'kysely'

// board 0117/0118 — SEAM TRANSPARENCY (Samuel: "extend to allow batch delete" got sync_actors'
// misleading "schon auf voller Granularität"): the update seams must self-describe what they are
// and are NOT for, and capability questions (batch ops are BUILT-IN) get answered instead of
// tool-roulette. Mailbox descriptions are config — this migration refreshes them everywhere.

const SYNC_DESC =
	'ADD missing per-step flow nodes/cards to a live skill (UI granularity: read/create/edit/delete ' +
	'steps + created/edited cards). ADD-ONLY, never rewrites. ONLY for missing steps/cards — NOT ' +
	'for behavior, rules, or capabilities (that is improve_skill). NOTE: batch operations are ' +
	'BUILT-IN already (create/update via items[], delete via ids[]) — answer such asks directly.'

const IMPROVE_PREFIX =
	'IMPROVE the skill itself: bake a user rule into how entries are interpreted — number formats, ' +
	'sign conventions, defaults, wording. THE seam for behavior/rule changes. Looks change via ' +
	'edit_mockup; missing workflow steps/cards via sync_actors; cross-skill sync via connect_skills.'

export async function up(db: Kysely<unknown>): Promise<void> {
	const rows = await sql<{ id: string; name: string; mailbox: unknown }>`
		SELECT id, name, mailbox FROM actor WHERE name IN ('sync_actors', 'improve_skill')
	`.execute(db)
	for (const r of rows.rows) {
		const mb = (typeof r.mailbox === 'string' ? JSON.parse(r.mailbox as string) : r.mailbox) as {
			description?: string
			[k: string]: unknown
		}
		mb.description = r.name === 'sync_actors' ? SYNC_DESC : IMPROVE_PREFIX
		await sql`UPDATE actor SET mailbox = ${JSON.stringify(mb)}::jsonb, updated_at = now() WHERE id = ${r.id}`.execute(db)
	}
}

export async function down(): Promise<void> {
	// descriptions only; re-run 0100/0099 to restore previous wording.
}
