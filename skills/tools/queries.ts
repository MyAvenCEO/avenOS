// board 0101 — the two dynamic-data actors on the Ontology skill: `query` answers a question that fixed
// list/create/update/delete can't (filter + join + count over the x1–x5 store), and `mutate` applies a
// structural change (transfer, batch move). Both let GLM-5.2 author a VALIDATED spec (never raw SQL) grounded
// in the user's live predicates; the server caps (query-caps.ts) do the authoring/validation/run. These
// actors stay thin: dispatch to the caps, HITL-gate destructive mutations, and pick the result vibe.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

/** Ask a question of the data that plain CRUD can't answer — GLM authors a validated query spec + runs it. */
export const QUERY_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'query',
		description:
			"Answer a READ question about the user's data that list/create/update/delete can't — needs a filter, " +
			'a join across two relationship types, or a count/aggregate (e.g. "who owns >3 companies?", "how many ' +
			'todos are done?"). A specialist authors + runs a validated query; you get the rows. Simple single-type ' +
			'lists → data_crud; changes → mutate.',
		parameters: {
			type: 'object',
			properties: {
				request: {
					type: 'string',
					description:
						'The question in plain language, e.g. "people who own more than 3 companies".'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['request']
		}
	}
}

export const query: ToolActor = {
	definition: QUERY_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as { request?: string }
		if (!ctx.query)
			return { content: { ok: false, error: 'query capabilities not available on this server' } }
		const request = String(args.request ?? '').trim()
		if (!request) return { content: { ok: false, error: 'query needs a `request`' } }
		const { spec, rows, error } = await ctx.query.author(request)
		if (error) return { content: { ok: false, error, spec } }
		return {
			detail: 'query',
			content: { ok: true, count: rows?.length ?? 0, rows, spec },
			vibe: { schema: 'query-result', data: { request, spec, rows: rows ?? [] } }
		}
	}
}

/** Apply a structural change plain CRUD can't — GLM authors a validated mutation spec; deletes are HITL-gated. */
export const MUTATE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'mutate',
		description:
			'Apply a STRUCTURAL change one create/update/delete cannot express — e.g. "transfer ownership of Acme ' +
			'from Alice to Bob", "move every task from project A to B". A specialist authors a validated transaction ' +
			'over the x1–x5 store; deletes are confirmed first. Simple single-row changes → data_crud.',
		parameters: {
			type: 'object',
			properties: {
				request: {
					type: 'string',
					description:
						'The change in plain language, e.g. "transfer ownership of Acme from Alice to Bob".'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['request']
		}
	}
}

export const mutate: ToolActor = {
	definition: MUTATE_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as { request?: string }
		if (!ctx.mutate)
			return { content: { ok: false, error: 'mutation capabilities not available on this server' } }
		const request = String(args.request ?? '').trim()
		if (!request) return { content: { ok: false, error: 'mutate needs a `request`' } }
		const { spec, destructive, error } = await ctx.mutate.plan(request)
		if (error) return { content: { ok: false, error, spec } }
		// A destructive (delete) mutation is NOT run here — the loop shows a confirm card; aiConfirmAction applies it.
		if (destructive) {
			return {
				detail: 'confirm mutation',
				content: { ok: true, pending: true, note: 'awaiting user confirmation', spec },
				hitl: {
					label: `Apply this change? — ${request}`,
					action: { tool: 'mutate', spec, request }
				}
			}
		}
		// Non-destructive → apply immediately.
		const result = await ctx.mutate.apply(spec)
		return {
			detail: 'mutate',
			content: { ok: true, applied: true, ...result },
			vibe: { schema: 'mutation-result', data: { request, spec, ops: result.ops } }
		}
	}
}
