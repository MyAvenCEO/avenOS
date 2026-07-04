// board 0099 — a chat tool is ONE actor: address (name) · mailbox (args schema) · behavior (handler) ·
// vibe (output). Config and function are co-located here in the skills package; the server (betterauth)
// supplies the runtime capabilities via an injected `ToolCtx`, so these modules stay pure and portable
// (no DB / HTTP imports). This is the same dependency-injection shape as the flow-runner's actors.

/** An OpenAI-compatible tool definition (the config the chat advertises to the model). */
export type ToolDefinition = {
	type: 'function'
	function: {
		name: string
		description?: string
		parameters?: Record<string, unknown>
	}
}

/** The generic data-store CRUD call — the one tool the Todos actor hub drives. */
export type DataCrudArgs = {
	schema: string
	action: 'list' | 'create' | 'update' | 'delete'
	/** list: a UNIVERSAL filter over any projected field of the list — { field, value, op? }. e.g.
	 *  { field: 'priority', value: 'medium' } or { field: 'due', op: 'lte', value: '2026-07-13' }. Omit for all. */
	filter?: { field: string; value?: unknown; op?: string }
	/** create: the value objects; update: objects that include their `id` (a BATCH edits many at once). */
	items?: Record<string, unknown>[]
	/** delete: a single value id. */
	id?: string
	/** delete: a BATCH of value ids — one call removes many (board 0099). */
	ids?: string[]
	response?: string
}

/** One positional place of a minted predicate (board 0100) — the JSON shape GLM returns + we compile/AJV. */
export type PlaceDefJSON = {
	pos: string
	role: string
	gloss: string
	kind: 'ref' | 'value'
	type?: string
	references?: string
	required?: boolean
}
/** A minted x1–x5 predicate definition (the gismu's FULL place structure). */
export type PredicateDefJSON = {
	predicate: string
	gismu?: string | null
	gloss?: string
	places: PlaceDefJSON[]
}

/** Runtime capabilities injected by the server; a tool-actor closes over these instead of importing them. */
export type ToolCtx = {
	userId: string
	/** Execute a schema-validated CRUD op against the signed-in user's store (betterauth crud — the ONE ops engine). */
	data(args: DataCrudArgs): Promise<unknown>
	/** board 0112 — run a NAMED data_operations row (query or mutation spec) with params: the same generic
	 *  `ops` capability sandboxed code actors get, exposed to tool-actors (e.g. the goals aggregate). */
	ops?(name: string, params?: Record<string, unknown>): Promise<unknown>
	/** board 0115 — the skillify part-1 caps: GLM designs/refines a vibe MOCKUP (view+style+example source,
	 *  walled into the mock- namespace + validator-gated server-side); list/load for the no-LLM viewer. */
	mockup?: {
		mint(
			request: string,
			opts?: { name?: string; promptActor?: string }
		): Promise<{ name?: string; error?: string }>
		list(): Promise<{ name: string; label: string }[]>
		/** deterministic canonicalizing resolver (the save-time mockName rule) — walled name, app name,
		 *  or label all resolve to the stored row; null on a genuine miss. */
		resolve(name: string): Promise<string | null>
		load(name: string): Promise<unknown>
	}
	/** board 0113 — the stepwise mockup→skill PROMOTION caps (plan/mint/wire/seed/promote — each step
	 *  stateless, keyed by the mockup name; GLM seams live server-side behind validation gates). */
	promote?: {
		skeletonOf(name: string): Promise<{
			skeleton: {
				app: string
				entities: { key: string; type: string; fields: string[] }[]
				aggregates: string[]
			}
			source: Record<string, unknown>
		} | null>
		mintData(
			skeleton: unknown,
			source: Record<string, unknown>
		): Promise<{
			types?: { type: string; predicates: string[] }[]
			minted?: PredicateDefJSON[]
			reused?: string[]
			error?: string
		}>
		wire(
			skeleton: unknown,
			source: Record<string, unknown>
		): Promise<{ skillId?: string; error?: string; code?: string }>
		seed(skeleton: unknown, source: Record<string, unknown>): Promise<{ seeded: Record<string, number> }>
		promoteVibe(app: string): Promise<{ name: string }>
		available(): Promise<string[]>
	}
	/** board 0100 — the ontology actor's server caps (GLM-5.2 mint + data_schema registry). Injected only
	 *  when the ontology tool is dispatched; other actors ignore it. */
	ontology?: {
		/** The predicates already in the data_schema registry (name + gloss). */
		list(): Promise<{ name: string; gloss?: string }[]>
		/** Ask GLM-5.2 (with the full gismu dictionary) to define the relationship(s) in the request — a
		 *  BATCH: one entry PER relationship ("eating and drinking" → two), each either reusing an existing
		 *  predicate or minting a new x1–x5 PredicateDef with its gismu's FULL place structure. */
		mint(
			request: string,
			existing: { name: string; gloss?: string }[]
		): Promise<{
			results?: { reuse?: string; def?: PredicateDefJSON }[]
			error?: string
		}>
		/** compilePredicate → AJV self-validate → persist to data_schema. Returns the stored name + place count. */
		save(def: PredicateDefJSON): Promise<{ name: string; places: number }>
	}
	/** board 0101 — the query actor's caps: GLM-5.2 authors a VALIDATED query spec (grounded in the user's
	 *  predicate place-structures + the spec meta-language), the engine persists + RUNS it (read-only, safe). */
	query?: {
		/** Author a query spec from plain language, validate, persist to data_queries, and run it. */
		author(request: string): Promise<{
			spec?: unknown
			rows?: Record<string, unknown>[]
			name?: string
			error?: string
		}>
	}
	/** board 0101 — the mutation actor's caps: GLM authors a VALIDATED mutation spec; `plan` persists it
	 *  WITHOUT running (destructive ops are HITL-gated at the loop), `apply` runs a validated spec. */
	mutate?: {
		/** Author a mutation spec from plain language, validate, persist to data_mutations — but do NOT run. */
		plan(request: string): Promise<{
			spec?: unknown
			destructive?: boolean
			name?: string
			error?: string
		}>
		/** Run a validated mutation spec as ONE transaction (after HITL confirm for destructive specs). */
		apply(spec: unknown, params?: Record<string, unknown>): Promise<{ ops: unknown[] }>
	}
	/** board 0102 — the bundle actor's caps: GLM authors a VALIDATED bundle (composite-type) spec — a named
	 *  set of traits over predicates + a flat view. Persisting it makes a NEW data kind CRUD-able through the
	 *  same engine todos uses, zero new code. Missing predicates are minted via `ontology` first. */
	bundle?: {
		/** Author a bundle spec from plain language (grounded in live predicates + existing bundles), AJV-validate. */
		mint(request: string): Promise<{ spec?: unknown; predicates?: string[]; error?: string }>
		/** The predicate names the user already has — the actor diffs a bundle's needs against these. */
		existingPredicates(): Promise<string[]>
		/** Persist a validated bundle spec to data_bundles (idempotent by type name). */
		save(spec: unknown): Promise<{ type: string; predicates: string[] }>
	}
}

/** What a tool-actor hands back to the chat loop. The loop does the plumbing (SSE emit, persistence). */
export type ToolResult = {
	/** The JSON fed back to the model as the tool message. */
	content: unknown
	/** A short human-facing reply to stream (optional; most card tools stay terse). */
	reply?: string
	/** A live vibe card to flow into the stream (schema = the vibe id, e.g. 'todos' | 'todos-created'). */
	vibe?: { schema: string; data?: unknown }
	/** A human-in-the-loop confirm request: the loop shows a confirm/decline card and does NOT execute. */
	hitl?: { label: string; action: unknown }
	/** A short label for the tool-activity chip (e.g. 'create todos'). */
	detail?: string
}

/** A self-contained chat tool: its config + its behavior, together. */
export type ToolActor = {
	definition: ToolDefinition
	handle(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult>
}
