import { randomUUID } from 'node:crypto'
import { todoPredicateSchemas } from '@avenos/aven-vibes/predicate'
import { sql } from 'kysely'
import { db } from './db'

// board 0112 — the per-user predicate-vocab BOOTSTRAP, moved out of the retired aven-ontology interpreter
// path (the interpreter is deleted; the bootstrap responsibility is not). `data_schema` is the single vocab registry — a predicate schema is any row whose JSON-Schema
// carries the `predicate` discriminator (what compilePredicate emits). The ONLY code-seeded vocab is the
// todo bootstrap so a fresh user has working todos; everything else is minted dynamically (ontology tool).
// Called once per user per process at the universal crud() seam (idempotent upserts underneath).

async function ensurePredicateSchemas(uid: string): Promise<void> {
	for (const { name, jsonSchema } of todoPredicateSchemas()) {
		const body = JSON.stringify(jsonSchema)
		const existing = await sql<{ id: string }>`
			SELECT id FROM data_schema WHERE user_id = ${uid} AND name = ${name} LIMIT 1
		`.execute(db())
		if (existing.rows[0]) {
			await sql`
				UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}
			`.execute(db())
		} else {
			await sql`
				INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
				VALUES (${randomUUID()}, ${uid}, ${name}, ${body}::jsonb, now(), now())
			`.execute(db())
		}
	}
}

// Once per user per process — the upserts are idempotent, this just avoids re-running them on every call.
const bootstrapped = new Set<string>()
export async function ensureVocab(uid: string): Promise<void> {
	if (bootstrapped.has(uid)) return
	await ensurePredicateSchemas(uid)
	bootstrapped.add(uid)
}
