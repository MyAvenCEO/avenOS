// Generic CRUD tool for the LLM, co-located with the vibes package (board 0054). Pure —
// no DOM/engine imports — so the server can import it ('@avenos/aven-vibes/tools') without
// pulling in the renderer. The server executes it against the betterauth /api/data store
// (schema-validated), scoped to the signed-in user. Same data the vibes + cards read.

import { COMPOSER_TOOLS } from '@avenos/skills/composer'
import bookkeepingToolDefs from './vibes/bookkeeping/tools.json'

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

export const BOOKKEEPING_TOOLS = bookkeepingToolDefs as typeof bookkeepingToolDefs

/**
 * After `classify_document` returns a known type, the model calls this to trigger the full
 * type-specific extraction. The server loads that doctype's schema + system prompt, runs a second
 * vision pass, validates + persists the structured value, and renders the doc-compare vibe. The
 * model passes only the type; the server does the heavy extraction. board 0064.
 */
export const EXTRACT_DOCUMENT_TOOL = {
	type: 'function',
	function: {
		name: 'extract_document',
		description:
			'Run full structured extraction on the attached document AFTER classify_document. Call ' +
			'this once the type is known (invoice / bank_statement / contract). The server performs the ' +
			'extraction, validates it against the doctype schema, stores it, and shows a side-by-side ' +
			'compare card — respond ONLY with the short sentence in `response`.',
		parameters: {
			type: 'object',
			properties: {
				type: {
					type: 'string',
					enum: ['invoice', 'bank_statement', 'contract'],
					description: 'The classified document type to extract.'
				},
				response: {
					type: 'string',
					description:
						'A single-sentence human-facing reply, e.g. "Ich habe die Felder extrahiert."'
				}
			},
			required: ['type', 'response']
		}
	}
} as const

export const EXTRACT_TOOLS = [EXTRACT_DOCUMENT_TOOL]

/**
 * Open the BWA / finance snapshot vibe — a realtime overview of revenue, expenses, result and cash
 * flow computed from the user's stored bookings + transactions. No args; the view is computed
 * client-side from /api/data. board 0072.
 */
export const SHOW_FINANCES_TOOL = {
	type: 'function',
	function: {
		name: 'show_finances',
		description:
			'Show the finance / BWA / Jahresabschluss snapshot — a realtime overview of Erlöse, ' +
			'Aufwendungen, Ergebnis and cash flow from the booked invoices + transactions. Call this when ' +
			'the user asks how the finances / business are doing, for a BWA, P&L, or year-end overview. ' +
			'Respond ONLY with the short sentence in `response`.',
		parameters: {
			type: 'object',
			properties: {
				response: {
					type: 'string',
					description: 'A single-sentence human-facing reply, e.g. "Hier ist deine aktuelle BWA."'
				}
			},
			required: ['response']
		}
	}
} as const

export const FINANCE_TOOLS = [SHOW_FINANCES_TOOL]

/** Every tool the chat advertises: data CRUD + Composer + bookkeeping classify + doc extract + BWA. */
export const CHAT_TOOLS = [
	...DATA_TOOLS,
	...COMPOSER_TOOLS,
	...BOOKKEEPING_TOOLS,
	...EXTRACT_TOOLS,
	...FINANCE_TOOLS
]
