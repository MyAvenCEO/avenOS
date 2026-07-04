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
			'with item counts. Use when they ask to see their locations/storage/where things are. Pass ' +
			'rename:{from,to} to RENAME a location or MERGE it into an existing one (all its items move to ' +
			'`to`). Pass remove:{name} to DELETE a location — its items stay, just without a place. For the ' +
			'items IN one location use data_crud list with {"field":"location","value":<name>}.',
		parameters: {
			type: 'object',
			properties: {
				rename: {
					type: 'object',
					description:
						'rename/merge: every item in location `from` moves to `to` (merging when `to` already exists).',
					properties: { from: { type: 'string' }, to: { type: 'string' } },
					required: ['from', 'to']
				},
				remove: {
					type: 'object',
					description: 'delete a location by name — its items stay, they just lose their place.',
					properties: { name: { type: 'string' } },
					required: ['name']
				},
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
		const listLocs = async (): Promise<Loc[]> =>
			((await ops('location.list', {})) as { rows?: Loc[] }).rows ?? []
		const byName = (ls: Loc[], n: string): Loc | undefined =>
			ls.find((l) => String(l.name ?? '').toLowerCase() === n.toLowerCase())

		// RENAME / MERGE (board 0112, mirrors the goals actor): onto a NEW name = relabel the SAME entity
		// (one edit — every located edge follows by id); onto an EXISTING location = MERGE (repoint the
		// located edges via the configured op, then drop the emptied entity).
		const rn = (raw as { rename?: { from?: string; to?: string } }).rename
		let renamed: { from: string; to: string; moved: number; mode: 'rename' | 'merge' } | undefined
		if (rn?.from && rn?.to) {
			const ls = await listLocs()
			const from = byName(ls, rn.from)
			const to = byName(ls, rn.to)
			if (from?.id && !to) {
				await ctx.data({ schema: 'location', action: 'update', items: [{ id: from.id, name: rn.to }] })
				renamed = { from: rn.from, to: rn.to, moved: 0, mode: 'rename' }
			} else if (from?.id && to?.id) {
				const res = (await ops('inventory.location-rename', { from: from.id, to: to.id })) as {
					ops?: { affected?: number }[]
				}
				await ctx.data({ schema: 'location', action: 'delete', id: from.id })
				renamed = { from: rn.from, to: rn.to, moved: res.ops?.[0]?.affected ?? 0, mode: 'merge' }
			} else {
				return {
					detail: 'locations',
					content: { ok: false, error: `no location named "${rn.from}"`, available: ls.map((l) => l.name) }
				}
			}
		}
		// DELETE a location: dissolve its located edges (the items stay, place-less) + drop the entity.
		const rm = (raw as { remove?: { name?: string } }).remove
		let removed: { name: string; freed: number } | undefined
		if (rm?.name) {
			const l = byName(await listLocs(), rm.name)
			if (!l?.id)
				return { detail: 'locations', content: { ok: false, error: `no location named "${rm.name}"` } }
			const res = (await ops('inventory.location-clear', { location: l.id })) as {
				ops?: { affected?: number }[]
			}
			await ctx.data({ schema: 'location', action: 'delete', id: l.id })
			removed = { name: rm.name, freed: res.ops?.[0]?.affected ?? 0 }
		}

		const [entities, agg] = await Promise.all([
			listLocs(),
			ops('inventory.locations', {}) as Promise<{ rows?: { key?: string; n?: number }[] }>
		])
		const countBy = new Map((agg.rows ?? []).map((r) => [String(r.key), Number(r.n ?? 0)]))
		const rows = entities
			.filter((l) => l.name)
			.map((l) => ({ key: String(l.name), count: countBy.get(String(l.id)) ?? 0 }))
		const said =
			typeof (raw as { response?: string }).response === 'string'
				? String((raw as { response?: string }).response).trim()
				: ''
		return {
			detail: renamed
				? `${renamed.mode} location ${renamed.from} → ${renamed.to}`
				: removed
					? `delete location ${removed.name}`
					: 'locations',
			content: {
				ok: true,
				count: rows.length,
				locations: rows,
				...(renamed ? { renamed } : {}),
				...(removed ? { removed } : {})
			},
			reply:
				said ||
				(renamed
					? renamed.mode === 'rename'
						? `Renamed the location "${renamed.from}" to "${renamed.to}".`
						: `Merged "${renamed.from}" into "${renamed.to}" — moved ${renamed.moved} item(s).`
					: removed
						? `Removed the location "${removed.name}" — its ${removed.freed} item(s) stay, just without a place.`
						: `Showing your ${rows.length} location(s).`),
			vibe: { schema: 'inventory-locations', data: { locations: rows } }
		}
	}
}
