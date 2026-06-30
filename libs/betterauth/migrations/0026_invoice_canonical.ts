import { INVOICE_SPEC } from '@avenos/aven-ontology'
import { compilePredicate, INVOICE, NUMBER, PRODUCED, TOTAL } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'

// board 0092 step 2a — canonical-fidelity correction of the `invoice` headline:
//   - re-seed the predicate_type spec (owned_by≡ponse; number≡cmene; total≡jdima un-reversed; the row
//     IS the invoice with janta.x3 = billed-party; produced finti→cupra).
//   - update/seed the invoice/number/total/produced data_schema rows for every user with invoices.
//   - RE-SYNC existing invoice predications:
//       * owned_by backfill (x1 = old invoice.x1 owner, x2 = invoice id)
//       * number→cmene (x1 = old invoice.x2 number, x2 = invoice id)
//       * amount→total, UN-REVERSED (total.x1 = amount.x2 value, total.x2 = the invoice) + drop amount
//       * rewrite the invoice primary: {x1 owner, x2 number} → {x3 billed-party} (owner now in owned_by,
//         number now in cmene)
// Forward-only on data shape; aven-db CRDT untouched. `vendor` (vecnu, transitional) is left for step 3.

export async function up(db: Kysely<unknown>): Promise<void> {
	const invoiceSchema = JSON.stringify(compilePredicate(INVOICE))
	const numberSchema = JSON.stringify(compilePredicate(NUMBER))
	const totalSchema = JSON.stringify(compilePredicate(TOTAL))
	const producedSchema = JSON.stringify(compilePredicate(PRODUCED))

	// 1. the corrected composite spec
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${INVOICE_SPEC.type}, ${JSON.stringify(INVOICE_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)

	// 2. data_schema: update invoice (new shape) + produced (cupra) in place; seed number/total/owned_by
	//    for every user that already has an `invoice` schema.
	await sql`UPDATE data_schema SET json_schema = ${invoiceSchema}::jsonb, updated_at = now() WHERE name = 'invoice'`.execute(db)
	await sql`UPDATE data_schema SET json_schema = ${producedSchema}::jsonb, updated_at = now() WHERE name = 'produced'`.execute(db)
	for (const [name, js] of [
		['number', numberSchema],
		['total', totalSchema]
	] as const) {
		await sql`
			INSERT INTO data_schema (id, user_id, name, json_schema)
			SELECT ${'seed_' + name + '_'} || u.user_id, u.user_id, ${name}, ${js}::jsonb
			FROM (SELECT DISTINCT user_id FROM data_schema WHERE name = 'invoice') u
			ON CONFLICT (user_id, name) DO NOTHING
		`.execute(db)
	}
	// (owned_by schema was seeded by migration 0025; the invoice users here also have todos, so it exists.)

	// 3a. owned_by backfill — x1 = the invoice's OLD owner (data->>'x1'), x2 = the invoice id
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'own_'} || iv.id, iv.user_id, os.id,
		       jsonb_build_object('predicate','owned_by','x1', iv.data->>'x1','x2', iv.id)
		FROM data_value iv
		JOIN data_schema isch ON isch.id = iv.schema_id AND isch.name = 'invoice'
		JOIN data_schema os ON os.user_id = iv.user_id AND os.name = 'owned_by'
		WHERE iv.data ? 'x1'
		  AND NOT EXISTS (
			SELECT 1 FROM data_value ov JOIN data_schema ox ON ox.id = ov.schema_id AND ox.name = 'owned_by'
			WHERE ov.data->>'x2' = iv.id)
	`.execute(db)

	// 3b. number→cmene — x1 = the invoice's OLD number (data->>'x2'), x2 = the invoice id
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'num_'} || iv.id, iv.user_id, ns.id,
		       jsonb_build_object('predicate','number','x1', iv.data->>'x2','x2', iv.id)
		FROM data_value iv
		JOIN data_schema isch ON isch.id = iv.schema_id AND isch.name = 'invoice'
		JOIN data_schema ns ON ns.user_id = iv.user_id AND ns.name = 'number'
		WHERE iv.data->>'x2' IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1 FROM data_value nx JOIN data_schema nxs ON nxs.id = nx.schema_id AND nxs.name = 'number'
			WHERE nx.data->>'x2' = iv.id)
	`.execute(db)

	// 3c. amount→total, UN-REVERSED — total.x1 = amount.x2 (the value), total.x2 = amount.x1 (the invoice)
	await sql`
		INSERT INTO data_value (id, user_id, schema_id, data)
		SELECT ${'tot_'} || av.id, av.user_id, ts.id,
		       jsonb_build_object('predicate','total','x1', av.data->>'x2','x2', av.data->>'x1')
		FROM data_value av
		JOIN data_schema asch ON asch.id = av.schema_id AND asch.name = 'amount'
		JOIN data_schema ts ON ts.user_id = av.user_id AND ts.name = 'total'
		WHERE NOT EXISTS (
			SELECT 1 FROM data_value tx JOIN data_schema txs ON txs.id = tx.schema_id AND txs.name = 'total'
			WHERE tx.data->>'x2' = av.data->>'x1')
	`.execute(db)

	// 3d. rewrite the invoice primary: {x1 owner, x2 number} → {x3 billed-party} (idempotent on `x1 ?`)
	await sql`
		UPDATE data_value SET data = jsonb_build_object('predicate','invoice','x3', data->>'x1'), updated_at = now()
		WHERE schema_id IN (SELECT id FROM data_schema WHERE name = 'invoice') AND data ? 'x1'
	`.execute(db)

	// 3e. drop the legacy amount predications + schema
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name = 'amount')`.execute(db)
	await sql`DELETE FROM data_schema WHERE name = 'amount'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// forward-only on data shape — drop the number/total predications + schemas this migration added.
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('number','total'))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN ('number','total')`.execute(db)
}
