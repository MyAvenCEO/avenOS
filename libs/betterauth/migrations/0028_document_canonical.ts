import { DOCUMENT_SPEC } from '../src/legacy-bundle-fixtures'
import { type Kysely, sql } from 'kysely'

// board 0092 — canonical-fidelity correction of the `document` type (extends universal ownership to the
// last vertical): owner → owned_by≡ponse; summary≡skicu un-reversed (x2 document, x4 text); source≡krasi
// x1 is the artifact ref; produced≡cupra (already relabelled in 0026). `classified` stays klesi for now
// (a faithful membership needs class entities — a noted follow-on). Re-sync:
//   - owned_by backfill (x1 = old document.x1 owner, x2 = document id)
//   - rewrite the document primary {x1 owner, x2 title} → {x2 title}
//   - move summary {x1 doc, x2 text} → {x2 doc, x4 text}
// Forward-only on data shape; aven-db CRDT untouched.

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the corrected composite spec
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${DOCUMENT_SPEC.type}, ${JSON.stringify(DOCUMENT_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)

	// 2a. owned_by backfill for documents (the owned_by schema exists from 0025; these users have todos)
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'owndoc_'} || dv.id, dv.user_id, os.id,
		       jsonb_build_object('predicate','owned_by','x1', dv.data->>'x1','x2', dv.id)
		FROM data_value dv
		JOIN data_schema ds ON ds.id = dv.schema_id AND ds.name = 'document'
		JOIN data_schema os ON os.user_id = dv.user_id AND os.name = 'owned_by'
		WHERE dv.data ? 'x1'
		  AND NOT EXISTS (
			SELECT 1 FROM data_value ov JOIN data_schema ox ON ox.id = ov.schema_id AND ox.name = 'owned_by'
			WHERE ov.data->>'x2' = dv.id)
	`.execute(db)

	// 2b. rewrite the document primary: drop x1 owner, keep x2 title
	await sql`
		UPDATE data_value SET data = jsonb_build_object('predicate','document','x2', data->>'x2'), updated_at = now()
		WHERE schema_id IN (SELECT id FROM data_schema WHERE name = 'document') AND data ? 'x1'
	`.execute(db)

	// 2c. summary: {x1 doc, x2 text} → {x2 doc, x4 text}
	await sql`
		UPDATE data_value SET data = jsonb_build_object('predicate','summary','x2', data->>'x1','x4', data->>'x2'), updated_at = now()
		WHERE schema_id IN (SELECT id FROM data_schema WHERE name = 'summary') AND data ? 'x1'
	`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only on data shape — no automatic restore of the old owner-in-x1 / x2-text layout.
}
