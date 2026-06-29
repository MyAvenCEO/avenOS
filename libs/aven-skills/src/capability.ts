// board 0084 — the actor CAPABILITY layer: how a flow node (actor) calls tools + runs an LLM,
// defined abstractly so a real runtime can wire them later. A `ToolSpec` is a typed tool-call
// contract (name + input/output JSON Schema); `LlmConfig` is a wire-ready model config. Pure +
// domain-agnostic (no bookkeeping vocabulary): the registry below is example data, extend freely.

/** A JSON Schema fragment (kept loose; validated by the host, not here). */
export type JsonSchema = Record<string, unknown>

/** A typed tool-call contract an actor can invoke: name + (optional) input/output schemas. */
export type ToolSpec = {
	/** Stable tool id an actor references via `RecipeNode.tools`. */
	name: string
	description?: string
	/** JSON Schema of the tool's arguments (the call payload). */
	input?: JsonSchema
	/** JSON Schema of the tool's result. */
	output?: JsonSchema
}

/** A model the actor is driven by, when it's an LLM step. Wire-ready for a real provider call. */
export type LlmConfig = {
	model: string
	provider?: string
	temperature?: number
	maxTokens?: number
	vision?: boolean
	/** how the model is driven: a forced tool call, free chat, or a vision pass. */
	mode?: 'tool' | 'chat' | 'vision'
	/** tool-call steering for `mode: 'tool'`. */
	toolChoice?: 'auto' | 'required' | 'none'
}

/** Example tool-call contracts (extend as actors are wired). Generic registry — not domain-locked. */
export const TOOL_SPECS: Record<string, ToolSpec> = {
	classify_document: {
		name: 'classify_document',
		description: 'Classify a document into a type with title, tags and a short summary.',
		input: { type: 'object', properties: { fileUrl: { type: 'string' } } },
		output: {
			type: 'object',
			properties: {
				docType: { type: 'string' },
				title: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } }
			}
		}
	},
	extract_document: {
		name: 'extract_document',
		description: 'Extract structured fields from a document as JSON for a named schema.',
		input: { type: 'object', properties: { schema: { type: 'string' } } },
		output: { type: 'object', additionalProperties: true }
	},
	emit_fields: {
		name: 'emit_fields',
		description: 'Emit the extracted fields object (the tool the model is forced to call).',
		input: { type: 'object', additionalProperties: true }
	},
	pick_match: {
		name: 'pick_match',
		description: 'Pick the transaction that settles a document, or none.',
		input: { type: 'object', properties: { candidates: { type: 'array' } } },
		output: { type: 'object', properties: { txId: { type: ['string', 'null'] } } }
	},
	data_crud: {
		name: 'data_crud',
		description: 'Create/update/list rows of a named data schema in the generic store.',
		input: { type: 'object', properties: { op: { type: 'string' }, schema: { type: 'string' } } }
	}
}

/** The spec for a tool id, if known. */
export function toolSpec(name: string): ToolSpec | undefined {
	return TOOL_SPECS[name]
}
