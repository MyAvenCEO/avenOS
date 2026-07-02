// board 0100 — the ontology "schema" actor's pure, deterministic core (no GLM, no DB, no deps): the
// dedup gate that reuses an existing predicate instead of minting a duplicate, and the create-prompt
// pre-instructions that force the mint to carry the chosen gismu's FULL x1–x5 place structure. The GLM
// wiring + persistence live in the server adapter; keeping this pure makes it unit-testable.

import type { PredicateDefJSON, ToolActor, ToolDefinition, ToolResult } from './types'

export type ExistingPredicate = { name: string; gloss?: string; keywords?: string[] }

/** The chat tool that drives the ontology actor: read the predicate registry, or create (mint/reuse) a
 *  new x1–x5 relationship from natural language. The actual minting runs on GLM-5.2 server-side. board 0100. */
export const ONTOLOGY_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'ontology',
		description:
			'Read the ontology (the x1–x5 Lojban predicate/relationship types the user already has) or CREATE ' +
			'a new relationship type from a plain-language description. Use `create` when the user wants a NEW ' +
			'kind of relationship/connection between things (e.g. "people can own companies", "a project has ' +
			'members") — a specialist model mints the gismu-based x1–x5 predicate, reusing an existing one if it ' +
			'already fits. Use `read` to show the existing relationship types. This is about SCHEMA (relationship ' +
			'kinds), not individual data rows — for todos and data use data_crud.',
		parameters: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['read', 'create'] },
				request: {
					type: 'string',
					description:
						'For create: the relationship to define, in plain language (e.g. "people can own companies").'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['action']
		}
	}
}

export const ontology: ToolActor = {
	definition: ONTOLOGY_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as { action?: string; request?: string }
		if (!ctx.ontology) {
			return { content: { ok: false, error: 'ontology capabilities not available on this server' } }
		}
		// READ — the predicate registry.
		if (args.action === 'read') {
			const predicates = await ctx.ontology.list()
			return {
				detail: 'read ontology',
				content: { ok: true, count: predicates.length, predicates },
				vibe: { schema: 'ontology', data: { predicates } }
			}
		}
		// CREATE — a BATCH: GLM returns one entry PER relationship in the request ("eating and drinking" →
		// two). For each: reuse if it already exists (GLM's `reuse` OR a name-dedup against the registry),
		// else compile+AJV+persist. board 0100.
		const request = String(args.request ?? '').trim()
		if (!request) return { content: { ok: false, error: 'create needs a `request`' } }
		const existing = await ctx.ontology.list()
		const minted = await ctx.ontology.mint(request, existing)
		if (minted.error || !minted.results?.length) {
			return { content: { ok: false, error: minted.error ?? 'could not mint any predicate' } }
		}
		const known = new Set(existing.map((e) => e.name))
		const created: PredicateDefJSON[] = []
		const reused: string[] = []
		for (const r of minted.results) {
			if (r.reuse && known.has(r.reuse)) {
				reused.push(r.reuse)
				continue
			}
			if (!r.def) continue
			// dedup: a predicate with this name already exists (or was just minted in THIS batch) → reuse.
			if (known.has(r.def.predicate)) {
				reused.push(r.def.predicate)
				continue
			}
			await ctx.ontology.save(r.def)
			created.push(r.def)
			known.add(r.def.predicate) // so a later batch entry dedups against it
		}
		return {
			detail: created.length
				? `create ${created.length} predicate${created.length === 1 ? '' : 's'}`
				: 'reuse predicate',
			content: { ok: true, created: created.map((d) => d.predicate), reused },
			vibe: { schema: 'ontology-created', data: { created, reused } }
		}
	}
}

const norm = (s: string): string => s.toLowerCase().trim()

/**
 * Deterministic dedup: reuse an existing predicate when the requested relation clearly matches one, so
 * the GLM mint path only fires for a genuinely NEW relation (no near-duplicate x1–x5 predicates). Match
 * on exact name, then name↔keyword/gloss overlap. Returns the existing predicate to REUSE, or null.
 */
export function findExistingPredicate(
	request: { name: string; keywords?: string[] },
	existing: ExistingPredicate[]
): ExistingPredicate | null {
	const rname = norm(request.name)
	const rkw = (request.keywords ?? []).map(norm)
	const exact = existing.find((e) => norm(e.name) === rname)
	if (exact) return exact
	for (const e of existing) {
		const ename = norm(e.name)
		const ekw = [...(e.keywords ?? []), ...(e.gloss ? [e.gloss] : [])].map(norm)
		if (ename === rname || ekw.includes(rname)) return e
		if (rkw.some((k) => k === ename || ekw.includes(k))) return e
	}
	return null
}

/**
 * Pre-instructions prepended to the CREATE mint prompt (board 0100). Enforces two rules: (1) FULL place
 * structure — always define EVERY place the chosen gismu declares in the dictionary, each with a correct
 * per-place validation config, even when the request fills only a subset; (2) dedup — search the existing
 * predicates first and REUSE a match instead of minting a near-duplicate.
 */
export const CREATE_INSTRUCTIONS = [
	'You mint NEW x1–x5 Lojban predicates for the relationship(s) the user describes, grounded in the',
	'gismu dictionary provided below.',
	'',
	'RULE 0 — ONE PER RELATIONSHIP: if the user describes SEVERAL relationships in one request (e.g.',
	'"eating and drinking", "owning and renting"), define EACH one separately — one output entry per',
	'relationship (eating → citka, drinking → pinxe). Never collapse distinct relations into one predicate.',
	'',
	'RULE 1 — REUSE FIRST: for each relation, search the EXISTING predicates listed below. If one already',
	'means the same relation, REUSE it (return its name) instead of minting a near-duplicate.',
	'',
	'RULE 2 — FULL PLACE STRUCTURE: when you do mint, define EVERY place the chosen gismu declares in the',
	'dictionary — its complete canonical place structure x1…xN — never a request-trimmed subset. For EACH',
	'place give its role, gloss, and a correct validation config: kind "ref" for an entity/id place, or',
	'kind "value" with a JSON type ("string" | "number" | "integer" | "boolean" | "date") for a literal.',
	'Define ALL places EVEN IF the user’s request only fills some of them — the stored predicate is the',
	'whole gismu, so it stays a faithful, reusable relation. Mark places the request does not fill as',
	'optional (required:false); never drop them.'
].join('\n')
