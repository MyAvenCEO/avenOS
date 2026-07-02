// board 0102 — the `bundle` actor on the Brain skill: mint a whole new KIND of thing (a composite type)
// from plain language. GLM authors a validated bundle spec (traits over predicates + a flat view); any
// predicate the bundle needs but the user lacks is minted first via the `brain` predicate path (0100).
// Persisting the bundle makes the new kind CRUD-able through the SAME engine todos uses, zero new code.
// This actor stays thin: author → ensure predicates → save → pick the vibe.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

/** Mint a new data KIND (composite type) from natural language — a specialist model authors the recipe. */
export const BUNDLE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'bundle',
		description:
			'Create a NEW KIND of thing the user can then track — a composite data type ("a book with an author ' +
			'and a rating", "a habit with a streak", "a contact with email + phone"). A specialist model authors ' +
			'the recipe (which relationship types cluster into this kind + how they read back as fields) and mints ' +
			'any missing relationship types automatically; afterwards the user can list/add/update/delete that kind ' +
			'via data_crud immediately. Use this to define a new TYPE/kind; use brain for a single relationship, ' +
			'data_crud for individual rows, and query/mutate for questions/changes over existing data.',
		parameters: {
			type: 'object',
			properties: {
				request: {
					type: 'string',
					description:
						'The kind to define, in plain language (e.g. "track books I read with a rating").'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['request']
		}
	}
}

export const bundle: ToolActor = {
	definition: BUNDLE_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as { request?: string }
		if (!ctx.bundle)
			return { content: { ok: false, error: 'bundle capabilities not available on this server' } }
		const request = String(args.request ?? '').trim()
		if (!request) return { content: { ok: false, error: 'bundle needs a `request`' } }

		const { spec, predicates, error } = await ctx.bundle.mint(request)
		if (error || !spec)
			return { content: { ok: false, error: error ?? 'could not author a bundle' } }

		// Ensure every predicate the bundle references exists — mint the missing ones via the brain (0100),
		// so the new kind is CRUD-able immediately (the engine resolves each predicate's schema at write time).
		const mintedPredicates: string[] = []
		if (ctx.brain && predicates?.length) {
			const have = new Set(await ctx.bundle.existingPredicates())
			const missing = predicates.filter((p) => !have.has(p))
			if (missing.length) {
				const res = await ctx.brain.mint(
					`Define these relationship predicates for a "${(spec as { type?: string }).type ?? 'kind'}": ` +
						`${missing.join(', ')}. Context: ${request}`,
					await ctx.brain.list()
				)
				for (const r of res.results ?? []) {
					if (r.def && missing.includes(r.def.predicate)) {
						await ctx.brain.save(r.def)
						mintedPredicates.push(r.def.predicate)
					}
				}
			}
		}

		const saved = await ctx.bundle.save(spec)
		return {
			detail: `bundle ${saved.type}`,
			content: { ok: true, type: saved.type, predicates: saved.predicates, mintedPredicates },
			vibe: { schema: 'bundle-created', data: { request, spec, mintedPredicates } }
		}
	}
}
