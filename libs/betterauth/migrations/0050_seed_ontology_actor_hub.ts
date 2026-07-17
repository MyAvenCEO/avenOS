import type { Flow } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// board 0100 — seed the `ontology` skill as an ACTOR HUB (like the todos hub, 0047): two independent
// actors — read (list the x1–x5 predicate registry) + create (GLM-5.2 mints/reuses a predicate) — with
// `edges: []`. They execute through the chat `ontology` tool; this flow is the hub's config + Skills view.

const ONTOLOGY_HUB: Flow = {
	id: 'ontology',
	name: 'Ontology',
	description:
		'The dynamic ontology skill — read the x1–x5 predicate registry, or CREATE a new relationship type ' +
		'from natural language (GLM-5.2 mints a gismu-based predicate, reusing an existing one when it fits).',
	nodes: [
		{
			id: 'read',
			name: 'Read ontology',
			actor: 'ontology',
			inputs: ['intent'],
			outputs: ['predicate'],
			vibe: 'ontology',
			note: 'read — list the existing x1–x5 predicate/relationship types.'
		},
		{
			id: 'create',
			name: 'Create predicate',
			actor: 'ontology',
			inputs: ['intent', 'predicate'],
			outputs: ['predicate'],
			vibe: 'ontology-created',
			note: 'create — dedup existing → GLM-5.2 mints a gismu x1–x5 predicate (full place structure) → AJV-validate → persist.'
		}
	],
	edges: [],
	resourceLabels: { intent: 'Intent', predicate: 'Predicate' },
	triggers: [{ kind: 'manual' }]
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
		VALUES (
			${ONTOLOGY_HUB.id}, ${ONTOLOGY_HUB.name}, ${ONTOLOGY_HUB.description},
			${JSON.stringify(ONTOLOGY_HUB.nodes)}::jsonb, ${JSON.stringify(ONTOLOGY_HUB.edges)}::jsonb,
			${JSON.stringify(ONTOLOGY_HUB.triggers)}::jsonb, ${JSON.stringify(ONTOLOGY_HUB.resourceLabels)}::jsonb
		)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description,
			nodes = EXCLUDED.nodes, edges = EXCLUDED.edges,
			triggers = EXCLUDED.triggers, resource_labels = EXCLUDED.resource_labels, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM flow WHERE id = 'ontology'`.execute(db)
}
