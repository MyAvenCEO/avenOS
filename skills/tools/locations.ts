// board 0112 — the Inventory's LOCATIONS actor: show every storage place the user's stock sits in, as a
// grid of bin tiles (name + item count). Pure read, entity-driven: location.list gives the ENTITIES (incl.
// empty ones), the inventory.locations aggregate gives per-location counts keyed by the location id; the
// actor maps id→name and renders the `inventory-locations` vibe. Mirrors the Planner's `goals` actor.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

export const LOCATIONS_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'locations',
		description:
			"Show the user's storage LOCATIONS — the places their inventory is stored — as a grid of bins " +
			'with item counts. Use when they ask to see their locations/storage/where things are. For the ' +
			'items IN one location use data_crud list with {"field":"location","value":<name>}.',
		parameters: {
			type: 'object',
			properties: {
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
}

export const locations: ToolActor = {
	definition: LOCATIONS_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.ops) return { content: { ok: false, error: 'ops capability not available' } }
		const ops = ctx.ops
		type Loc = { id?: string; name?: string }
		const [entities, agg] = await Promise.all([
			ops('location.list', {}) as Promise<{ rows?: Loc[] }>,
			ops('inventory.locations', {}) as Promise<{ rows?: { key?: string; n?: number }[] }>
		])
		const countBy = new Map((agg.rows ?? []).map((r) => [String(r.key), Number(r.n ?? 0)]))
		const rows = (entities.rows ?? [])
			.filter((l) => l.name)
			.map((l) => ({ key: String(l.name), count: countBy.get(String(l.id)) ?? 0 }))
		const said =
			typeof (raw as { response?: string }).response === 'string'
				? String((raw as { response?: string }).response).trim()
				: ''
		return {
			detail: 'locations',
			content: { ok: true, count: rows.length, locations: rows },
			reply: said || `Showing your ${rows.length} location(s).`,
			vibe: { schema: 'inventory-locations', data: { locations: rows } }
		}
	}
}
