import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { compilePredicate, MEMBER_OF, PART_OF, predSchemaName, TAGGED } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board 0112 — the Planner BATTLE TEST, config-only: richer todo vocabulary with ZERO engine code.
//   · goals      — member_of(x1=task, x2=goal name), a `replace` trait → create/update/delete/projection
//                  all DERIVE automatically; the universal {field:'goal',...} filter just works.
//   · sub-tasks  — part_of(x1=sub-task, x2=parent task), a `replace` trait → `parent` field + top-level
//                  filtering ({field:'parent',op:'isnull'}) + grandparent CHAIN queries (0112 grammar).
//   · tags       — tagged(x1=tag text, x2=task): many-to-many, NOT a derivable bundle trait — so its ops
//                  are hand-authored universal-grammar specs (todos.tag / todos.untag), exactly the
//                  config-as-data answer for shapes the trait grammar doesn't cover.
// Fresh users get the 3 predicates via the vocab bootstrap (TODO_PREDICATES gained them); this migration
// upserts them for EXISTING users, re-saves the todos bundle (saveType regenerates the derived ops), and
// seeds the tag ops. The frozen legacy fixture (0102 replay seed) is deliberately untouched.

const EXTENDED_TODO_SPEC: TypeSpec = {
	type: 'todos',
	parts: [
		{ pred: 'task', kind: 'primary', field: 'title', create: { x1: '$user', x2: '$value' }, set: { x2: '$value' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'done', kind: 'replace', link: 'x1', field: 'done', set: { x1: '$primary' } },
		{ pred: 'due', kind: 'replace', link: 'x2', field: 'due', set: { x1: '$value', x2: '$primary' } },
		{
			pred: 'prioritized',
			kind: 'replace',
			link: 'x1',
			field: 'priority',
			set: { x1: '$primary', x2: '$user', x3: '$value' }
		},
		// board 0112 — goal clustering (cmima): the goal is an atomic name label on x2.
		{ pred: 'member_of', kind: 'replace', link: 'x1', field: 'goal', set: { x1: '$primary', x2: '$value' } },
		// board 0112 — sub-tasks (pagbu): `parent` carries the parent task's row id.
		{ pred: 'part_of', kind: 'replace', link: 'x1', field: 'parent', set: { x1: '$primary', x2: '$value' } },
		// board 0112 — tags (tcita) as a `many` trait: declared so DELETE cascades tag rows; reads/writes
		// go through the hand-authored todos.tag / todos.untag ops (many-to-many isn't list-joinable).
		{ pred: 'tagged', kind: 'many', link: 'x2' }
	],
	project: {
		title: { pred: 'task', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' },
		done: { pred: 'done', notNull: 'x1' },
		due: { pred: 'due', place: 'x1' },
		priority: { pred: 'prioritized', place: 'x3' },
		goal: { pred: 'member_of', place: 'x2' },
		parent: { pred: 'part_of', place: 'x2' }
	}
}

// tags: many-to-many — hand-authored universal-grammar ops (insert / targeted delete), global rows.
const TAG_OPS: { name: string; spec: unknown }[] = [
	{
		name: 'todos.tag',
		spec: {
			name: 'todos.tag',
			ops: [{ op: 'insert', predicate: 'tagged', cells: { x1: { param: 'tag' }, x2: { param: 'id' } } }]
		}
	},
	{
		name: 'todos.untag',
		spec: {
			name: 'todos.untag',
			ops: [
				{
					op: 'delete',
					predicate: 'tagged',
					where: [
						{ place: 'x1', op: 'eq', param: 'tag' },
						{ place: 'x2', op: 'eq', param: 'id' }
					]
				}
			]
		}
	}
]

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the 3 new predicate schemas for every EXISTING user (fresh users: the vocab bootstrap).
	const users = await sql<{ user_id: string }>`
		SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL
	`.execute(db)
	for (const def of [MEMBER_OF, PART_OF, TAGGED]) {
		const name = predSchemaName(def)
		const body = JSON.stringify(compilePredicate(def))
		for (const { user_id } of users.rows) {
			const existing = await sql<{ id: string }>`
				SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = ${name} LIMIT 1
			`.execute(db)
			if (existing.rows[0]) {
				await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(
					db
				)
			} else {
				await sql`
					INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
					VALUES (${randomUUID()}, ${user_id}, ${name}, ${body}::jsonb, now(), now())
				`.execute(db)
			}
		}
	}

	// 2. the extended todos bundle — saveType validates + upserts data_bundles + REGENERATES todos.* ops.
	await saveType(EXTENDED_TODO_SPEC)

	// 3. the hand-authored tag ops (global).
	for (const { name, spec } of TAG_OPS) {
		await sql`DELETE FROM data_operations WHERE name = ${name} AND user_id IS NULL`.execute(db)
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, ${name}, 'mutation', ${JSON.stringify(spec)}::jsonb, now(), now())
		`.execute(db)
	}

	// 4. the data_crud mailbox filter examples gain the new fields (config row).
	await sql`
		UPDATE actor SET mailbox = jsonb_set(
			mailbox,
			'{parameters,properties,filter,description}',
			to_jsonb(${'list only: narrow by ONE projected field — {"field":<priority|due|done|title|goal|parent>,"value":…,"op"?:eq|neq|gt|gte|lt|lte|isnull|notnull}. medium: {"field":"priority","value":"medium"}; open: {"field":"done","value":false}; goal: {"field":"goal","value":"Fitness"}; top-level: {"field":"parent","op":"isnull"}.'}::text)
		), updated_at = now()
		WHERE name = 'data_crud'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	for (const { name } of TAG_OPS)
		await sql`DELETE FROM data_operations WHERE name = ${name} AND user_id IS NULL`.execute(db)
	// bundle/ops revert = re-running the previous seed (0104-era spec); predicates are additive + harmless.
}
