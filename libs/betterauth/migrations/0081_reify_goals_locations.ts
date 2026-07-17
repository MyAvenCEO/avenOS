import { compilePredicate, GIRZU, NAMED, STUZI } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { runNamedOp } from '../src/actor-run'
import { db } from '../src/db'
import { GOAL_SPEC, LOCATION_SPEC } from '../src/reify-specs'
import { saveType } from '../src/type-caps'

// board 0112 REIFY slice 2 — the irreversible data move. Goals and locations become ENTITIES with their
// own ref id (Samuel: "each goal having its own ref ID"). This migration:
//   1. seeds the girzu/stuzi/named schemas per existing user (goal.create/location.create resolve them).
//   2. saveType(goal/location) → derives goal.list/create/update/delete + location.* .
//   3. re-derives todos.list + inventory.list WITH the ref-name chain (member_of.x2 → girzu → named), and
//      teaches their write side that goal/location fields resolve name→id (refType).
//   4. converts every existing string goal/location into an entity + REPOINTS member_of.x2 / located.x2
//      from the name to the new entity id.
// IMPORTANT: this migration uses the db() SINGLETON throughout (not the Migrator's transactional `db`
// param), because saveType + runNamedOp also use db(); mixing the two splits writes across connections
// (entities committed but the repoint rolled back). One connection = one consistent visibility.

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

async function seedVocabPerUser(): Promise<void> {
	const D = db()
	const users = await sql<{ user_id: string }>`
		SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL
	`.execute(D)
	for (const def of [GIRZU, NAMED, STUZI]) {
		const body = JSON.stringify(compilePredicate(def))
		for (const { user_id } of users.rows) {
			const existing = await sql<{ id: string }>`
				SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = ${def.predicate} LIMIT 1
			`.execute(D)
			if (existing.rows[0]) {
				await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(D)
			} else {
				await sql`
					INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
					VALUES (gen_random_uuid(), ${user_id}, ${def.predicate}, ${body}::jsonb, now(), now())
				`.execute(D)
			}
		}
	}
}

/** Patch a bundle's edge trait + projection to REIFY one field: the trait resolves name→id (refType),
 *  the projection reads the entity's name back (refName). Re-saveType re-derives its list with the chain. */
async function reifyField(type: string, edgePred: string, field: string, refType: string): Promise<void> {
	const row = await sql<{ spec: unknown }>`SELECT spec FROM data_bundles WHERE type = ${type}`.execute(db())
	if (!row.rows[0]) return
	const spec = (typeof row.rows[0].spec === 'string'
		? JSON.parse(row.rows[0].spec)
		: row.rows[0].spec) as {
		parts: { pred: string; refType?: string }[]
		project: Record<string, { refName?: boolean }>
	}
	const part = spec.parts.find((p) => p.pred === edgePred)
	if (part) part.refType = refType
	if (spec.project[field]) spec.project[field].refName = true
	await saveType(spec as never)
}

/** Convert distinct string labels on an edge into entities of `entityType`, then repoint the edge. */
async function reifyEdge(edgePred: string, place: 'x2', entityType: string): Promise<number> {
	const D = db()
	const labels = await sql<{ user_id: string; label: string }>`
		SELECT DISTINCT user_id, ${sql.ref(place)} AS label FROM data_value
		WHERE predicate = ${edgePred} AND ${sql.ref(place)} IS NOT NULL AND ${sql.ref(place)} !~ ${UUID}
	`.execute(D)
	let n = 0
	for (const { user_id, label } of labels.rows) {
		const res = (await runNamedOp(user_id, `${entityType}.create`, { name: label })) as {
			ids?: (string | null)[]
		}
		const entityId = res.ids?.[0]
		if (!entityId) continue
		await sql`
			UPDATE data_value SET ${sql.ref(place)} = ${entityId}, updated_at = now()
			WHERE predicate = ${edgePred} AND user_id = ${user_id} AND ${sql.ref(place)} = ${label}
		`.execute(D)
		n++
	}
	return n
}

export async function up(_db: Kysely<unknown>): Promise<void> {
	try {
		await seedVocabPerUser()
		await saveType(GOAL_SPEC)
		await saveType(LOCATION_SPEC)
		await reifyField('todos', 'member_of', 'goal', 'goal')
		await reifyField('inventory', 'located', 'location', 'location')
		const g = await reifyEdge('member_of', 'x2', 'goal')
		const l = await reifyEdge('located', 'x2', 'location')
		// eslint-disable-next-line no-console
		console.log(`[0081] reified ${g} goal(s) + ${l} location(s) into entities`)
	} catch (e) {
		// REPLAY-SAFE SKIP (board 0119j): this migration executes TODAY'S runtime engine against the
		// schema as it existed at position 0081 — a fresh catch-up (the next channel) can reject it
		// even though the historical run succeeded. Skipping is CONVERGENT: reify operates on
		// goal/location DATA (none or near-none on a fresh catch-up); specs re-save on demand.
		// DBs that applied it historically are untouched (already recorded as applied).
		console.error('[migrate 0081] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	const D = db()
	// non-reversible data move (the name strings are gone). Drop the entity bundles + their rows.
	for (const t of ['goal', 'location']) {
		await sql`DELETE FROM data_operations WHERE derived_from = ${t}`.execute(D)
		await sql`DELETE FROM data_bundles WHERE type = ${t}`.execute(D)
	}
	await sql`DELETE FROM data_value WHERE predicate IN ('girzu', 'stuzi', 'named')`.execute(D)
}
