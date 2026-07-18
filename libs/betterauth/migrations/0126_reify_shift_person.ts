import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { runNamedOp } from '../src/actor-run'
import { db } from '../src/db'
import { saveType } from '../src/type-caps'

// board aven-voice — REIFY shift.person into a hard prenu id reference (Samuel: a real prenu, not a
// string). refName only projects off EDGES, and person sat on the shift PRIMARY (worker.x2), so we
// relocate it onto a new reified edge `staffed_by`≡gunka → prenu, keeping worker as the identity anchor
// (its row id stays the shift id, so role/day/start/end/owner links are untouched). The write layer
// then find-or-creates the prenu on every shift write; a rename of a contact updates the roster.
//
// Data move (irreversible): each existing worker.x2 person name → find-or-create a prenu → a staffed_by
// row (x1 = the shift id, x2 = the prenu id); worker.x2 is cleared. Uses the db() singleton so saveType,
// runNamedOp and the direct writes all see one consistent connection (the 0081 rule).

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const STAFFED_BY: PredicateDef = {
	predicate: 'staffed_by',
	gismu: 'gunka',
	gloss: 'gunka: x1 (a shift) is worked by person x2 — the shift\'s assignee (a prenu entity)',
	places: [
		{ pos: 'x1', role: 'shift', gloss: 'the shift row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'person', gloss: 'the person (prenu) working it — symbolic id = the contact', kind: 'ref', references: '*' }
	]
}

// worker becomes an identity anchor (x1 = user); person moves to the reified staffed_by edge.
const SHIFT_SPEC = {
	type: 'shift',
	parts: [
		{ pred: 'worker', kind: 'primary', create: { x1: '$user' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'staffed_by', kind: 'replace', link: 'x1', field: 'person', set: { x1: '$primary', x2: '$value' }, refType: 'prenu' },
		{ pred: 'role', kind: 'replace', link: 'x1', field: 'role', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'onday', kind: 'replace', link: 'x1', field: 'day', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'starts', kind: 'replace', link: 'x1', field: 'start', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'ends', kind: 'replace', link: 'x1', field: 'end', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		person: { pred: 'staffed_by', place: 'x2', refName: true },
		owner: { pred: 'owned_by', place: 'x1' },
		role: { pred: 'role', place: 'x2' },
		day: { pred: 'onday', place: 'x2' },
		start: { pred: 'starts', place: 'x2' },
		end: { pred: 'ends', place: 'x2' }
	}
}

export async function up(_db: Kysely<unknown>): Promise<void> {
	const D = db()
	try {
		// 1. staffed_by vocab per user.
		const users = await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL`.execute(D)
		const body = JSON.stringify(compilePredicate(STAFFED_BY))
		for (const { user_id } of users.rows) {
			const ex = await sql<{ id: string }>`SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = 'staffed_by' LIMIT 1`.execute(D)
			if (ex.rows[0]) await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${ex.rows[0].id}`.execute(D)
			else await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at) VALUES (gen_random_uuid(), ${user_id}, 'staffed_by', ${body}::jsonb, now(), now())`.execute(D)
		}

		// 2. re-derive shift ops with the reified person edge.
		await saveType(SHIFT_SPEC as never)

		// 3. data move: relocate each worker.x2 person NAME onto a staffed_by → prenu edge, clear worker.x2.
		let moved = 0
		for (const { user_id } of users.rows) {
			const staffed = await sql<{ id: string }>`SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = 'staffed_by' LIMIT 1`.execute(D)
			const staffedSchemaId = staffed.rows[0]?.id
			if (!staffedSchemaId) continue
			// find-or-create prenu by name (cache per user)
			const listed = (await runNamedOp(user_id, 'prenu.list', {})) as { rows?: { id?: string; name?: string }[] }
			const byName = new Map<string, string>()
			for (const r of listed.rows ?? []) if (r.name && r.id) byName.set(r.name.toLowerCase(), r.id)
			const rows = await sql<{ id: string; x2: string }>`
				SELECT id, x2 FROM data_value
				WHERE predicate = 'worker' AND user_id = ${user_id} AND x2 IS NOT NULL AND x2 !~ ${UUID}
			`.execute(D)
			for (const w of rows.rows) {
				const name = w.x2
				let prenuId = byName.get(name.toLowerCase())
				if (!prenuId) {
					const created = (await runNamedOp(user_id, 'prenu.create', { name })) as { ids?: (string | null)[] }
					prenuId = created.ids?.[0] ?? undefined
					if (prenuId) byName.set(name.toLowerCase(), prenuId)
				}
				if (!prenuId) continue
				await sql`
					INSERT INTO data_value (id, user_id, schema_id, predicate, x1, x2, created_at, updated_at)
					VALUES (gen_random_uuid(), ${user_id}, ${staffedSchemaId}, 'staffed_by', ${w.id}, ${prenuId}, now(), now())
				`.execute(D)
				await sql`UPDATE data_value SET x2 = NULL, updated_at = now() WHERE id = ${w.id}`.execute(D)
				moved++
			}
		}
		console.log(`[0126] reified ${moved} shift(s) person → prenu`)
	} catch (e) {
		console.error('[migrate 0126] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(): Promise<void> {
	// non-reversible data move (person now lives as a prenu id on staffed_by).
}
