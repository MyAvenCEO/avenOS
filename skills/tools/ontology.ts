// board 0100 — the ontology "schema" actor's pure, deterministic core (no GLM, no DB, no deps): the
// dedup gate that reuses an existing predicate instead of minting a duplicate, and the create-prompt
// pre-instructions that force the mint to carry the chosen gismu's FULL x1–x5 place structure. The GLM
// wiring + persistence live in the server adapter; keeping this pure makes it unit-testable.

export type ExistingPredicate = { name: string; gloss?: string; keywords?: string[] }

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
	'You mint a NEW x1–x5 Lojban predicate for a relationship the user describes, grounded in the gismu',
	'dictionary provided below.',
	'',
	'RULE 1 — REUSE FIRST: search the EXISTING predicates listed below. If one already means the same',
	'relation, REUSE it (return its name) instead of minting a near-duplicate.',
	'',
	'RULE 2 — FULL PLACE STRUCTURE: when you do mint, define EVERY place the chosen gismu declares in the',
	'dictionary — its complete canonical place structure x1…xN — never a request-trimmed subset. For EACH',
	'place give its role, gloss, and a correct validation config: kind "ref" for an entity/id place, or',
	'kind "value" with a JSON type ("string" | "number" | "integer" | "boolean" | "date") for a literal.',
	'Define ALL places EVEN IF the user’s request only fills some of them — the stored predicate is the',
	'whole gismu, so it stays a faithful, reusable relation. Mark places the request does not fill as',
	'optional (required:false); never drop them.'
].join('\n')
