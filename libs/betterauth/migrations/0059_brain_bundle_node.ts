import { type Kysely, sql } from 'kysely'

// board 0102 — add the `bundle` actor to the Brain skill hub: GLM authors a validated composite type (a
// KIND: traits over predicates + a flat view) and persists it to data_bundles, minting any missing
// predicates first. It declares its attached context generically (RecipeNode.context) so the Skills/Runs
// aside shows the ACTUAL grounding: the live predicate registry + the existing bundles it can reuse.

const BUNDLE_NODE = {
	id: 'bundle',
	name: 'Create type',
	actor: 'brain',
	inputs: ['intent'],
	outputs: ['bundle'],
	vibe: 'bundle-created',
	note: 'bundle — GLM authors a composite type (traits + view) → mints missing predicates → data_bundles; the kind is CRUD-able immediately.',
	context: [
		{
			label: 'Existing predicates',
			provider: 'predicates',
			note: 'The live data_schema place-structures — GLM builds traits over these (missing ones get minted).'
		},
		{
			label: 'Existing bundles',
			provider: 'types',
			note: 'The data_bundles registry — reuse a kind if it already fits.'
		}
	]
}

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown; resource_labels: unknown }>`
		SELECT nodes, resource_labels FROM flow WHERE id = 'brain'
	`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	if (!nodes.some((n) => n.id === 'bundle')) nodes.push(BUNDLE_NODE)
	const labels = { ...(asJson(row.resource_labels) as Record<string, string>), bundle: 'Bundle' }
	await sql`
		UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, resource_labels = ${JSON.stringify(labels)}::jsonb, updated_at = now()
		WHERE id = 'brain'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'brain'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = (asJson(row.nodes) as Array<Record<string, unknown>>).filter(
		(n) => n.id !== 'bundle'
	)
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'brain'`.execute(db)
}
