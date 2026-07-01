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
	/** Execute a schema-validated CRUD op against the signed-in user's store (betterauth executeDataTool). */
	data(args: DataCrudArgs): Promise<unknown>
	/** board 0100 — the brain actor's server caps (GLM-5.2 mint + data_schema registry). Injected only
	 *  when the brain tool is dispatched; other actors ignore it. */
	brain?: {
		/** The predicates already in the data_schema registry (name + gloss). */
		list(): Promise<{ name: string; gloss?: string }[]>
		/** Ask GLM-5.2 (with the full gismu dictionary) to define the relationship(s) in the request — a
		 *  BATCH: one entry PER relationship ("eating and drinking" → two), each either reusing an existing
		 *  predicate or minting a new x1–x5 PredicateDef with its gismu's FULL place structure. */
		mint(request: string, existing: { name: string; gloss?: string }[]): Promise<{
			results?: { reuse?: string; def?: PredicateDefJSON }[]
			error?: string
		}>
		/** compilePredicate → AJV self-validate → persist to data_schema. Returns the stored name + place count. */
		save(def: PredicateDefJSON): Promise<{ name: string; places: number }>
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
