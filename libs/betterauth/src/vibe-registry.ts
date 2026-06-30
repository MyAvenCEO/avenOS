import type { Context } from 'hono'
import { sql } from 'kysely'
import { db } from './db'

// The `vibe.*` registry (board 0095): vibe definitions as admin-owned config-as-data (Layer A). A vibe
// bundle = a `view` (ViewDef) + `style` (StyleDef) + `logic` (sandbox-quickjs JS), each its own row in
// vibe_view / vibe_style / vibe_logic. The app LOADS the bundle from here and renders it through the
// existing engine — no per-view Svelte copy, no rebuild to change a card.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export type VibeBundle = { view: unknown; style: unknown; logic: string }

/** The view/style/logic bundle for `name` from the registry, or null if no part exists. */
export async function loadVibe(name: string): Promise<VibeBundle | null> {
	const one = async (table: string): Promise<unknown> => {
		const r = await sql<{ body: unknown }>`SELECT body FROM ${sql.raw(table)} WHERE name = ${name}`.execute(db())
		return r.rows[0]?.body
	}
	const [view, style, logic] = await Promise.all([one('vibe_view'), one('vibe_style'), one('vibe_logic')])
	if (view == null && style == null && logic == null) return null
	return {
		view: view == null ? null : asJson(view),
		style: style == null ? null : asJson(style),
		logic: typeof logic === 'string' ? logic : ''
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
