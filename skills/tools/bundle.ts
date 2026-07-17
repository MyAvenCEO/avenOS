// board 0102 — the `bundle` actor on the Ontology skill: mint a whole new KIND of thing (a composite type)
// from plain language. GLM authors a validated bundle spec (traits over predicates + a flat view); any
// predicate the bundle needs but the user lacks is minted first via the `ontology` predicate path (0100).
// Persisting the bundle makes the new kind CRUD-able through the SAME engine todos uses, zero new code.
// This actor stays thin: author → ensure predicates → save → pick the vibe.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

/** Mint a new data KIND (composite type) from natural language — a specialist model authors the recipe. */
export const BUNDLE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'bundle',
		description:
			'Define a NEW KIND of thing to track — a composite type ("a book with an author and a rating", "a habit ' +
			'with a streak"). A specialist authors the recipe + mints any missing relationship types; then it is ' +
			'usable via data_crud. Defining a TYPE only — single relationship → ontology, rows → data_crud, ' +
			'questions/changes → query/mutate.',
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

		// Ensure every predicate the bundle references exists — mint the missing ones via the ontology (0100),
		// so the new kind is CRUD-able immediately (the engine resolves each predicate's schema at write time).
		const mintedPredicates: string[] = []
		if (ctx.ontology && predicates?.length) {
			const have = new Set(await ctx.bundle.existingPredicates())
			const missing = predicates.filter((p) => !have.has(p))
			if (missing.length) {
				const res = await ctx.ontology.mint(
					`Define these relationship predicates for a "${(spec as { type?: string }).type ?? 'kind'}": ` +
						`${missing.join(', ')}. Context: ${request}`,
					await ctx.ontology.list()
				)
				for (const r of res.results ?? []) {
					if (r.def && missing.includes(r.def.predicate)) {
						await ctx.ontology.save(r.def)
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
