import type { Flow } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// board 0099 — seed the `todos` skill as an ACTOR HUB (not a linear pipeline) so the Skills explorer
// reflects the new architecture: 4 independent actors, `edges: []` (no chain), each = a tool + a vibe
// state, dispatched by intent and runnable sequentially OR in parallel. The actors execute through the
// chat's `data_crud` tool (see @avenos/skills/tools) — this flow is the hub's VISUALIZATION + config.

const TODOS_HUB: Flow = {
	id: 'todos',
	name: 'Todos',
	description:
		'The Todos skill as an actor hub — four independent actors (read / create / edit / delete), each a ' +
		'tool call + a vibe state, dispatched by intent. No edges: they run one after another or in parallel.',
	nodes: [
		{
			id: 'read',
			name: 'Read todos',
			actor: 'data_crud',
			inputs: ['intent'],
			outputs: ['todos'],
			vibe: 'todos',
			note: 'list — display all todos (the read actor).'
		},
		{
			id: 'create',
			name: 'Create todos',
			actor: 'data_crud',
			inputs: ['intent'],
			outputs: ['todos'],
			vibe: 'todos-created',
			note: 'create — show only the new tasks.'
		},
		{
			id: 'edit',
			name: 'Edit todos',
			actor: 'data_crud',
			inputs: ['intent', 'todos'],
			outputs: ['todos'],
			vibe: 'todos-edited',
			note: 'update — show updated tasks + a before→after diff (reads all to find ids).'
		},
		{
			id: 'delete',
			name: 'Delete todos',
			actor: 'data_crud',
			inputs: ['intent', 'todos'],
			outputs: ['todos'],
			vibe: 'todos-deleted',
			hitl: true,
			note: 'delete — show which todos were removed (reads all to find ids); HITL-confirmed.'
		}
	],
	edges: [],
	resourceLabels: { intent: 'Intent', todos: 'Todos' },
	triggers: [{ kind: 'manual' }]
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
		VALUES (
			${TODOS_HUB.id}, ${TODOS_HUB.name}, ${TODOS_HUB.description},
			${JSON.stringify(TODOS_HUB.nodes)}::jsonb, ${JSON.stringify(TODOS_HUB.edges)}::jsonb,
			${JSON.stringify(TODOS_HUB.triggers)}::jsonb, ${JSON.stringify(TODOS_HUB.resourceLabels)}::jsonb
		)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description,
			nodes = EXCLUDED.nodes, edges = EXCLUDED.edges,
			triggers = EXCLUDED.triggers, resource_labels = EXCLUDED.resource_labels, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM flow WHERE id = 'todos'`.execute(db)
}
