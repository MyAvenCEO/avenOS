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
			'with task counts. Use when they ask to see their goals/projects/groups (any wording). For the ' +
			'tasks INSIDE one goal use data_crud list with {"field":"goal","value":<name>}.',
		parameters: {
			type: 'object',
			properties: {
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
}

export const goals: ToolActor = {
	definition: GOALS_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.ops) return { content: { ok: false, error: 'ops capability not available' } }
		const res = (await ctx.ops('todos.goals', {})) as { rows?: { key?: string; n?: number }[] }
		const rows = (res.rows ?? []).filter((r) => r.key)
		const said = typeof (raw as { response?: string }).response === 'string' ? String((raw as { response?: string }).response).trim() : ''
		return {
			detail: 'goals',
			content: { ok: true, count: rows.length, goals: rows },
			reply: said || `Showing your goals (${rows.length}).`,
			vibe: { schema: 'goals', data: { goals: rows } }
		}
	}
}
