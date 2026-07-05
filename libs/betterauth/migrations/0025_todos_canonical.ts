import { TODO_SPEC } from '../src/legacy-bundle-fixtures'
import { compilePredicate, DONE, OWNED_BY } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'

// board 0092 step 1 — canonical-fidelity correction of the `todos` composite type:
//   - re-seed the predicate_type spec: owned_by≡ponse (universal ownership) + done≡mulno (presence)
//     replace the old valid≡ranji interval (see TODO_SPEC / aven-vibes predicate vocab).
//   - seed the `done` + `owned_by` data_schema rows for every user that already has todos.
//   - RE-SYNC existing predications (the todo vertical's slice of board 0092 step 7):
//       * backfill owned_by (x1 = the task's owner = task.data->>'x1', x2 = the task id) for every task
//       * convert each CLOSED valid (x3 not null = was done) → a done(x1=task) predication
//       * drop the legacy valid predications + the now-unused valid data_schema.
// Forward-only on data shape; aven-db CRDT untouched.

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the corrected composite spec (loadTypeSpec reads this row at runtime)
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${TODO_SPEC.type}, ${JSON.stringify(TODO_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)

	// 2. seed done + owned_by data_schema for every user that already has a `task` schema (one per user)
	const doneSchema = JSON.stringify(compilePredicate(DONE))
	const ownedSchema = JSON.stringify(compilePredicate(OWNED_BY))
	await sql`
		INSERT INTO data_schema (id, user_id, name, json_schema)
		SELECT ${'seed_done_'} || u.user_id, u.user_id, 'done', ${doneSchema}::jsonb
		FROM (SELECT DISTINCT user_id FROM data_schema WHERE name = 'task') u
		ON CONFLICT (user_id, name) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO data_schema (id, user_id, name, json_schema)
		SELECT ${'seed_owned_by_'} || u.user_id, u.user_id, 'owned_by', ${ownedSchema}::jsonb
		FROM (SELECT DISTINCT user_id FROM data_schema WHERE name = 'task') u
		ON CONFLICT (user_id, name) DO NOTHING
	`.execute(db)

	// 3. backfill owned_by for every existing task: x1 = task owner, x2 = task id
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'own_'} || tv.id, tv.user_id, os.id,
		       jsonb_build_object('predicate', 'owned_by', 'x1', tv.data->>'x1', 'x2', tv.id)
		FROM data_value tv
		JOIN data_schema ts ON ts.id = tv.schema_id AND ts.name = 'task'
		JOIN data_schema os ON os.user_id = tv.user_id AND os.name = 'owned_by'
		WHERE NOT EXISTS (
			SELECT 1 FROM data_value ov
			JOIN data_schema osx ON osx.id = ov.schema_id AND osx.name = 'owned_by'
			WHERE ov.data->>'x2' = tv.id
		)
	`.execute(db)

	// 4. closed valid (x3 not null = done) → a done(x1=task) predication
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'done_'} || vv.id, vv.user_id, ds.id,
		       jsonb_build_object('predicate', 'done', 'x1', vv.data->>'x1')
		FROM data_value vv
		JOIN data_schema vs ON vs.id = vv.schema_id AND vs.name = 'valid'
		JOIN data_schema ds ON ds.user_id = vv.user_id AND ds.name = 'done'
		WHERE vv.data->>'x3' IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1 FROM data_value dx
			JOIN data_schema dsx ON dsx.id = dx.schema_id AND dsx.name = 'done'
			WHERE dx.data->>'x1' = vv.data->>'x1'
		)
	`.execute(db)

	// 5. drop the legacy valid predications + schema
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name = 'valid')`.execute(db)
	await sql`DELETE FROM data_schema WHERE name = 'valid'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// forward-only on data shape — drop the done/owned_by predications + schemas this migration added.
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('done','owned_by'))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN ('done','owned_by')`.execute(db)
}
