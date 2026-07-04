import type { Context } from 'hono'
import { sql } from 'kysely'
import { registerContextProvider } from './context'
import { db } from './db'

// The `vibe.*` registry (board 0095): vibe definitions as admin-owned config-as-data (Layer A). A vibe
// bundle = a `view` (ViewDef) + `style` (StyleDef) + `logic` (sandbox-quickjs JS), each its own row in
// vibe_view / vibe_style / vibe_logic. The app LOADS the bundle from here and renders it through the
// existing engine — no per-view Svelte copy, no rebuild to change a card.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

// board 0102 — surface the vibe registry in the DB viewer via the universal context system, alongside the
// data_ registries. Each vibe table (view/style/logic) is one provider listing its rows (name + body).
async function listVibeRows(
	table: 'vibe_view' | 'vibe_style' | 'vibe_logic'
): Promise<{ name: string; gloss: string }[]> {
	const r = await sql<{
		name: string
		body: unknown
	}>`SELECT name, body FROM ${sql.raw(table)} ORDER BY name`.execute(db())
	return r.rows.map((row) => ({
		name: row.name,
		gloss: typeof row.body === 'string' ? row.body : JSON.stringify(asJson(row.body))
	}))
}
registerContextProvider('vibe_view', async () => ({
	kind: 'list',
	label: 'Vibe views',
	items: await listVibeRows('vibe_view')
}))
registerContextProvider('vibe_style', async () => ({
	kind: 'list',
	label: 'Vibe styles',
	items: await listVibeRows('vibe_style')
}))
registerContextProvider('vibe_logic', async () => ({
	kind: 'list',
	label: 'Vibe logic',
	items: await listVibeRows('vibe_logic')
}))

export type VibeBundle = { view: unknown; style: unknown; logic: string; source: unknown }

/** The view/style/logic(+example source) bundle for `name`, or null if no part exists. */
export async function loadVibe(name: string): Promise<VibeBundle | null> {
	const one = async (table: string): Promise<unknown> => {
		const r = await sql<{
			body: unknown
		}>`SELECT body FROM ${sql.raw(table)} WHERE name = ${name}`.execute(db())
		return r.rows[0]?.body
	}
	const [view, style, logic, source] = await Promise.all([
		one('vibe_view'),
		one('vibe_style'),
		one('vibe_logic'),
		// board 0114 — the vibe's EXAMPLE source (vibe_source registry) rides along for previews.
		one('vibe_source').catch(() => null)
	])
	if (view == null && style == null && logic == null) return null
	return {
		view: view == null ? null : asJson(view),
		style: style == null ? null : asJson(style),
		logic: typeof logic === 'string' ? logic : '',
		source: source == null ? null : asJson(source)
	}
}

/** GET /api/vibe/:name — the view/style/logic bundle from the `vibe.*` registry. board 0095. */
export async function getVibe(c: Context): Promise<Response> {
	const name = c.req.param('name')
	if (!name) return c.json({ error: 'name required' }, 400)
	const bundle = await loadVibe(name)
	if (!bundle) return c.json({ error: `no vibe "${name}"` }, 404)
	return c.json(bundle)
}
