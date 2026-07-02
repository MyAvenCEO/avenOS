import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { compilePredicate } from '@avenos/aven-vibes/predicate'
import { sql } from 'kysely'
import { executeDataTool } from '../src/data'
import { db } from '../src/db'
import { saveType, TYPE_META_SCHEMA, typePredicates, validateTypeSpec } from '../src/type-caps'

// board 0102 — the DETERMINISTIC proof for dynamic composite types: a validated TypeSpec persisted to
// data_bundles is IMMEDIATELY CRUD-able through the existing generic engine (executeDataTool → runType),
// with ZERO new code. GLM authoring quality is a separate human-checked criterion.

const UID = `test-types-${randomUUID().slice(0, 8)}`
async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}

describe('dynamic composite types — author a TypeSpec, CRUD works with no new code (board 0102)', () => {
	test('the meta-schema accepts a well-formed TypeSpec and rejects malformed ones', () => {
		const good: TypeSpec = {
			type: 'library',
			parts: [
				{
					pred: 'book',
					kind: 'primary',
					field: 'title',
					create: { x1: '$user', x2: '$value' },
					set: { x2: '$value' }
				}
			],
			project: { title: { pred: 'book', place: 'x2' }, owner: { pred: 'book', place: 'x1' } }
		}
		expect(validateTypeSpec(good)).toBe(true)
		expect(TYPE_META_SCHEMA.required).toContain('project')
		expect(typePredicates(good)).toEqual(['book'])
		// malformed: bad kind
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(
			validateTypeSpec({
				type: 'x',
				parts: [{ pred: 'book', kind: 'nope' }],
				project: { a: { pred: 'book' } }
			} as any)
		).toBe(false)
		// malformed: empty parts
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(
			validateTypeSpec({ type: 'x', parts: [], project: { a: { pred: 'book' } } } as any)
		).toBe(false)
		// malformed: an illegal place in a project
		// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
		expect(
			validateTypeSpec({
				type: 'x',
				parts: [{ pred: 'book', kind: 'primary' }],
				project: { a: { pred: 'book', place: 'x9' } }
			} as any)
		).toBe(false)
	})

	test('recursive childSpec validates (a composite type nesting a sub-type)', () => {
		const nested: TypeSpec = {
			type: 'shelf',
			parts: [
				{
					pred: 'shelf',
					kind: 'primary',
					field: 'name',
					create: { x1: '$value' },
					set: { x1: '$value' }
				},
				{
					pred: 'book',
					kind: 'children',
					link: 'x1',
					field: 'books',
					childSpec: {
						type: 'book',
						parts: [
							{
								pred: 'book',
								kind: 'primary',
								field: 'title',
								create: { x1: '$parent', x2: '$value' }
							}
						],
						project: { title: { pred: 'book', place: 'x2' } }
					}
				}
			],
			project: { name: { pred: 'shelf', place: 'x1' }, books: { pred: 'book', children: true } }
		}
		expect(validateTypeSpec(nested)).toBe(true)
	})

	test('EXECUTION: author `library` over a `book` predicate → create + list round-trips through the generic engine', async () => {
		if (!(await hasDb())) {
			console.log('[dynamic-type] skipped DB execution test — no connection')
			return
		}
		const clean = async () => {
			await sql`DELETE FROM data_value WHERE user_id = ${UID}`.execute(db())
			await sql`DELETE FROM data_schema WHERE user_id = ${UID}`.execute(db())
			await sql`DELETE FROM data_bundles WHERE type = 'library'`.execute(db())
			await sql`DELETE FROM data_operations WHERE derived_from = 'library'`.execute(db()) // board 0104 — saveType regenerates derived ops; clean them too
		}
		await clean()
		// 1. the `book` predicate must exist as a data_schema (x1=owner ref, x2=title value) — a compiled
		//    predicate carries the `predicate` discriminator so ensurePredicateSchemas resolves it.
		const bookSchema = compilePredicate({
			predicate: 'book',
			gloss: 'x1 owns book x2 (a read book)',
			places: [
				{ pos: 'x1', role: 'owner', gloss: 'who has the book', kind: 'ref', references: '*' },
				{ pos: 'x2', role: 'title', gloss: 'the book title', kind: 'value', type: 'string' }
			]
		})
		await sql`INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
			VALUES (${randomUUID()}, ${UID}, 'book', ${sql`${JSON.stringify(bookSchema)}::jsonb`}, now(), now())`.execute(
			db()
		)

		// 2. author + validate + persist a NEW composite type — no code, just config.
		const library: TypeSpec = {
			type: 'library',
			parts: [
				{
					pred: 'book',
					kind: 'primary',
					field: 'title',
					create: { x1: '$user', x2: '$value' },
					set: { x2: '$value' }
				}
			],
			project: { title: { pred: 'book', place: 'x2' }, owner: { pred: 'book', place: 'x1' } }
		}
		const saved = await saveType(library)
		expect(saved.type).toBe('library')

		// 3. the SAME data_crud engine todos uses now does CRUD on `library` with zero new code.
		const created = (await executeDataTool(UID, {
			schema: 'library',
			action: 'create',
			items: [{ title: 'Dune' }]
		})) as {
			ok: boolean
			created?: string[]
		}
		expect(created.ok).toBe(true)
		expect(created.created?.length).toBe(1)

		const listed = (await executeDataTool(UID, { schema: 'library', action: 'list' })) as {
			items?: { title?: string; owner?: string }[]
		}
		expect(listed.items?.length).toBe(1)
		expect(listed.items?.[0].title).toBe('Dune')
		expect(listed.items?.[0].owner).toBe(UID) // $user projected back through the engine

		await clean()
	})
})
