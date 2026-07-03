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
			'For the tasks INSIDE one goal use data_crud list with {"field":"goal","value":<name>}.',
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
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
}

export const goals: ToolActor = {
	definition: GOALS_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.ops) return { content: { ok: false, error: 'ops capability not available' } }
		// rename/MERGE first (board 0112): one configured mutation moves every membership from→to; the
		// fresh grid below then reflects it (a merge = renaming onto an existing goal name).
		const rn = (raw as { rename?: { from?: string; to?: string } }).rename
		let renamed: { from: string; to: string; moved: number } | undefined
		if (rn?.from && rn?.to) {
			const res = (await ctx.ops('todos.goal-rename', { from: rn.from, to: rn.to })) as {
				ops?: { affected?: number }[]
			}
			renamed = { from: rn.from, to: rn.to, moved: res.ops?.[0]?.affected ?? 0 }
		}
		// two configured universal aggregates: total memberships per goal + DONE memberships per goal
		// (the done op inner-joins the done satellite) — merged into {key, total, done} for the grid's
		// progress bar. board 0112.
		type Agg = { rows?: { key?: string; n?: number }[] }
		const [total, done] = await Promise.all([
			ctx.ops('todos.goals', {}) as Promise<Agg>,
			ctx.ops('todos.goals-done', {}).catch(() => ({ rows: [] })) as Promise<Agg>
		])
		const doneBy = new Map((done.rows ?? []).map((r) => [String(r.key), Number(r.n ?? 0)]))
		const rows = (total.rows ?? [])
			.filter((r) => r.key)
			.map((r) => ({
				key: String(r.key),
				total: Number(r.n ?? 0),
				done: doneBy.get(String(r.key)) ?? 0
			}))
		const said =
			typeof (raw as { response?: string }).response === 'string'
				? String((raw as { response?: string }).response).trim()
				: ''
		return {
			detail: renamed ? `merge goals ${renamed.from} → ${renamed.to}` : 'goals',
			content: { ok: true, count: rows.length, goals: rows, ...(renamed ? { renamed } : {}) },
			reply:
				said ||
				(renamed
					? `Moved ${renamed.moved} task(s) from "${renamed.from}" to "${renamed.to}".`
					: `Showing your goals (${rows.length}).`),
			vibe: { schema: 'goals', data: { goals: rows } }
		}
	}
}
