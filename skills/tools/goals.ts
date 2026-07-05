// board 0112 — the Planner's GOALS actor: show every goal the user's todos cluster under, as a grid of
// goal cards (name + task count). Pure read: ONE configured universal aggregate (`todos.goals` — a
// group_by+count QuerySpec in data_operations) run through the generic `ops` capability; the result
// renders via the `goals` vibe rows. No bespoke query code — the op IS config.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

export const GOALS_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'goals',
		description:
			"Show the user's GOALS — the named groups their todos cluster under — as a grid of goal cards " +
			'with done/total progress. Use when they ask to see their goals/projects/groups. Pass ' +
			'rename:{from,to} to RENAME a goal or MERGE it into an existing one (all its tasks move to `to`). ' +
			'Pass remove:{name} to DELETE a goal — its tasks stay, they just leave the group. For the tasks ' +
			'INSIDE one goal use data_crud list with {"field":"goal","value":<name>}.',
		parameters: {
			type: 'object',
			properties: {
				rename: {
					type: 'object',
					description:
						'rename/merge: every task in goal `from` moves to goal `to` (merging when `to` already exists).',
					properties: { from: { type: 'string' }, to: { type: 'string' } },
					required: ['from', 'to']
				},
				remove: {
					type: 'object',
					description: 'delete a goal by name — dissolves the grouping; the tasks themselves stay.',
					properties: { name: { type: 'string' } },
					required: ['name']
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
}

export const goals: ToolActor = {
	definition: GOALS_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.ops) return { content: { ok: false, error: 'ops capability not available' } }
		const ops = ctx.ops
		// board 0112 REIFICATION — goals are ENTITIES now (girzu), not name strings. The grid is driven by
		// goal.list (so EMPTY goals appear), with per-goal counts from the id-keyed aggregates; rename/merge/
		// delete resolve the user's NAMES to entity ids and manage the entity lifecycle.
		type Goal = { id?: string; name?: string }
		const listGoals = async (): Promise<Goal[]> =>
			((await ops('goal.list', {})) as { rows?: Goal[] }).rows ?? []
		const byName = (gs: Goal[], n: string): Goal | undefined =>
			gs.find((g) => String(g.name ?? '').toLowerCase() === n.toLowerCase())

		// RENAME / MERGE: renaming onto a NEW name relabels the entity (one edit, keeps its id + members);
		// onto an EXISTING goal it MERGES — repoint memberships from→to (todos.goal-rename by id) then drop
		// the emptied `from` entity.
		const rn = (raw as { rename?: { from?: string; to?: string } }).rename
		let renamed: { from: string; to: string; moved: number; mode: 'rename' | 'merge' } | undefined
		if (rn?.from && rn?.to) {
			const gs = await listGoals()
			const from = byName(gs, rn.from)
			const to = byName(gs, rn.to)
			if (from?.id && !to) {
				await ctx.data({ schema: 'goal', action: 'update', items: [{ id: from.id, name: rn.to }] })
				renamed = { from: rn.from, to: rn.to, moved: 0, mode: 'rename' }
			} else if (from?.id && to?.id) {
				const res = (await ops('todos.goal-rename', { from: from.id, to: to.id })) as {
					ops?: { affected?: number }[]
				}
				await ctx.data({ schema: 'goal', action: 'delete', id: from.id })
				renamed = { from: rn.from, to: rn.to, moved: res.ops?.[0]?.affected ?? 0, mode: 'merge' }
			}
		}
		// DELETE a goal: dissolve its memberships (tasks stay) then remove the entity itself.
		const rm = (raw as { remove?: { name?: string } }).remove
		let removed: { name: string; ungrouped: number } | undefined
		if (rm?.name) {
			const g = byName(await listGoals(), rm.name)
			if (g?.id) {
				const res = (await ops('todos.goal-delete', { goal: g.id })) as {
					ops?: { affected?: number }[]
				}
				await ctx.data({ schema: 'goal', action: 'delete', id: g.id })
				removed = { name: rm.name, ungrouped: res.ops?.[0]?.affected ?? 0 }
			}
		}
		// GRID: every goal ENTITY (incl. empty ones) + its total/done counts from the id-keyed aggregates.
		type Agg = { rows?: { key?: string; n?: number }[] }
		const [entities, total, done] = await Promise.all([
			listGoals(),
			ops('todos.goals', {}) as Promise<Agg>,
			ops('todos.goals-done', {}).catch(() => ({ rows: [] })) as Promise<Agg>
		])
		const totalBy = new Map((total.rows ?? []).map((r) => [String(r.key), Number(r.n ?? 0)]))
		const doneBy = new Map((done.rows ?? []).map((r) => [String(r.key), Number(r.n ?? 0)]))
		const rows = entities
			.filter((g) => g.name)
			.map((g) => ({
				key: String(g.name),
				total: totalBy.get(String(g.id)) ?? 0,
				done: doneBy.get(String(g.id)) ?? 0
			}))
		const said =
			typeof (raw as { response?: string }).response === 'string'
				? String((raw as { response?: string }).response).trim()
				: ''
		return {
			detail: renamed
				? `merge goals ${renamed.from} → ${renamed.to}`
				: removed
					? `delete goal ${removed.name}`
					: 'goals',
			content: {
				ok: true,
				count: rows.length,
				goals: rows,
				...(renamed ? { renamed } : {}),
				...(removed ? { removed } : {})
			},
			reply:
				said ||
				(renamed
					? renamed.mode === 'rename'
						? `Renamed the goal "${renamed.from}" to "${renamed.to}".`
						: `Merged "${renamed.from}" into "${renamed.to}" — moved ${renamed.moved} task(s).`
					: removed
						? `Removed the goal "${removed.name}" — its ${removed.ungrouped} task(s) stay, just ungrouped.`
						: `Showing your goals (${rows.length}).`),
			vibe: { schema: 'goals', data: { goals: rows } }
		}
	}
}
