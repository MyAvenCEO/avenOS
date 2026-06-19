// Generic CRUD tool for the LLM, co-located with the vibes package (board 0054). Pure —
// no DOM/engine imports — so the server can import it ('@avenos/aven-vibes/tools') without
// pulling in the renderer. The server executes it against the betterauth /api/data store
// (schema-validated), scoped to the signed-in user. Same data the vibes + cards read.

export type DataCrudAction = 'list' | 'create' | 'update' | 'delete'

export type DataCrudArgs = {
	schema: string
	action: DataCrudAction
	/** create: the value objects; update: objects that include their `id`. */
	items?: Record<string, unknown>[]
	/** delete: the value id. */
	id?: string
	/** A short human-facing reply. */
	response?: string
}

/** OpenAI-compatible tool definition the Tinfoil chat advertises. */
export const DATA_CRUD_TOOL = {
	type: 'function',
	function: {
		name: 'data_crud',
		description:
			'Read or modify the signed-in user\'s data for a named schema (e.g. "todos"). ' +
			'Always `list` first to get item ids before `update` or `delete`. Each value is ' +
			'validated server-side against its schema.',
		parameters: {
			type: 'object',
			properties: {
				schema: { type: 'string', description: 'Schema name, e.g. "todos".' },
				action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
				items: {
					type: 'array',
					description:
						'For create: value objects (e.g. {"title":"Buy milk","done":false}). For update: objects including their "id".',
					items: { type: 'object', additionalProperties: true }
				},
				id: { type: 'string', description: 'For delete: the value id to remove.' },
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['schema', 'action']
		}
	}
} as const

export const DATA_TOOLS = [DATA_CRUD_TOOL]
