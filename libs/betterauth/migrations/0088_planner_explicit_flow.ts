import { type Kysely, sql } from 'kysely'

// board 0114 — the Planner becomes the LIVING explicit-flow example (the "derived + overridable" override
// path, exercised for real). The old hand-seeded todos flow carried richness the single data_crud actor
// row cannot express: FOUR mode nodes (read/create/edit/delete), each previewing its own vibe — richness
// the derived hub graph dropped ("Keine Vibe-Vorschau"). Restore it AS the override: keep those mode
// nodes (notes/context intact), add the goals node + a dispatch node, and add HONEST edges — the tier-1
// router genuinely fans one intent to exactly one mode. Rename to Planner (the row's stale "Todos" name
// was the drift that motivated 0114 in the first place).

type Node = { id: string; [k: string]: unknown }

const DISPATCH_NODE: Node = {
	id: 'dispatch',
	name: 'Dispatch',
	actor: 'dispatch',
	note: 'Tier-1 router: one user intent is fanned to exactly ONE mode (tool call) of this skill per turn.',
	inputs: ['intent'],
	outputs: ['intent']
}
const GOALS_NODE: Node = {
	id: 'goals',
	name: 'Goals',
	actor: 'goals',
	vibe: 'goals',
	note: 'the goals grid — reified goal entities with done/total progress; rename / merge / delete.',
	inputs: ['intent'],
	outputs: ['todos']
}
const MODE_IDS = ['read', 'create', 'edit', 'delete', 'goals']

export async function up(db: Kysely<unknown>): Promise<void> {
	const r = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'todos'`.execute(db)
	const existing: Node[] = r.rows[0]
		? ((typeof r.rows[0].nodes === 'string' ? JSON.parse(r.rows[0].nodes) : r.rows[0].nodes) as Node[])
		: []
	// keep the four mode nodes (their notes/context/vibes are the value); add dispatch + goals once.
	const nodes: Node[] = [...existing.filter((n) => n.id !== 'dispatch' && n.id !== 'goals')]
	nodes.unshift(DISPATCH_NODE)
	nodes.push(GOALS_NODE)
	const edges = MODE_IDS.filter((id) => nodes.some((n) => n.id === id)).map((to) => ({
		from: 'dispatch',
		to,
		kind: 'control'
	}))
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges, created_at, updated_at)
		VALUES ('todos', 'Planner',
			${'The Planner skill — one intent is dispatched to a mode of the data_crud actor (read / create / edit / delete, each with its own card) or the goals actor. The EXPLICIT flow (edges) overrides the derived hub graph — the living example of skill orchestration as config.'},
			${JSON.stringify(nodes)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description,
			nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// drop the edges → the derived hub graph wins again (non-destructive to the mode nodes).
	await sql`UPDATE flow SET edges = '[]'::jsonb, updated_at = now() WHERE id = 'todos'`.execute(db)
}
