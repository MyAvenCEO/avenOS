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
 * Run a SKILL on the attached document (board 0089). When the user attaches a file/photo and asks to
 * ingest / process / file it, the server runs the skill's flow: stores the raw artifact
 * content-addressed, classifies it via vision, and saves a `document` with provenance (krasi) back to
 * the source. Default skill is `doc-ingest`.
 */
export const RUN_SKILL_TOOL = {
	type: 'function',
	function: {
		name: 'run_skill',
		description:
			'Run a skill on the attached document — the ONLY way to ingest/process a file or photo in chat. ' +
			'Use when the user attaches a file/photo and asks to ingest / process / file / read / book it. ' +
			'Pick `skill` by what the document IS (use vision): "invoice" for an invoice/bill/receipt (stores, ' +
			'classifies, extracts the invoice fields + parties + line items, enriches the vendor + buyer companies); ' +
			'"kontoauszug" for a bank / account / credit-card STATEMENT (Kontoauszug — an account holder + a list of ' +
			'posted transactions/bookings; stores, classifies, extracts every transaction line, enriches the ' +
			'account-holder + counterparty contacts and imports the transactions); else "doc-ingest" for any other ' +
			'general document (store + classify only). The server saves the result as ontology data with provenance ' +
			'back to the source. Respond ONLY with the short sentence in `response`.',
		parameters: {
			type: 'object',
			properties: {
				skill: {
					type: 'string',
					description:
						'The skill id: "invoice" for invoices/bills/receipts, "kontoauszug" for a bank/account/credit-card statement (Kontoauszug), else "doc-ingest".'
				},
				response: { type: 'string', description: 'A single-sentence human-facing reply.' }
			},
			required: ['response']
		}
	}
} as const

export const SKILL_TOOLS = [RUN_SKILL_TOOL]

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

// board 0082 — outgoing invoicing + addressbook. Contacts/invoices are JSON in /api/data; the source
// docs + rendered PDFs live in the mainnet PRIVATE file store. The model fills everything from the
// prompt; the SERVER mints contact ids, assigns fortlaufende numbers, and computes VAT.
const ADDRESS_FIELDS = {
	type: { type: 'string', enum: ['person', 'company'] },
	name: { type: 'string', description: 'Display / company name (without legal form).' },
	legal_form: { type: ['string', 'null'], description: 'GmbH / KG / UG / e.V. …' },
	street: { type: ['string', 'null'] },
	zip: { type: ['string', 'null'] },
	city: { type: ['string', 'null'] },
	country: { type: ['string', 'null'] },
	vat_id: { type: ['string', 'null'], description: 'USt-IdNr.' },
	tax_number: { type: ['string', 'null'] },
	email: { type: ['string', 'null'] },
	phone: { type: ['string', 'null'] },
	iban: { type: ['string', 'null'] },
	bic: { type: ['string', 'null'] },
	bank_name: { type: ['string', 'null'] },
	contact_person: { type: ['string', 'null'] },
	register_court: {
		type: ['string', 'null'],
		description: 'Registergericht, z. B. "Amtsgericht München".'
	},
	register_number: {
		type: ['string', 'null'],
		description: 'Handelsregisternummer, z. B. "HRB 292608".'
	},
	managing_director: { type: ['string', 'null'], description: 'Geschäftsführer.' }
} as const

const INVOICE_LINE = {
	type: 'object',
	properties: {
		description: { type: 'string' },
		quantity: { type: 'number' },
		unit_price: { type: 'number', description: 'NET unit price (ohne USt).' },
		vat_rate: { type: 'number', enum: [19, 7, 0] }
	},
	required: ['description', 'quantity', 'unit_price', 'vat_rate']
} as const

export const INVOICING_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'upsert_contact',
			description:
				'Create or update an addressbook contact (person or company). Omit contact_value_id to ' +
				'create (the server mints a stable short id); pass it to update. Fill every field you know.',
			parameters: {
				type: 'object',
				properties: {
					contact_value_id: {
						type: ['string', 'null'],
						description: 'Existing contact id to update.'
					},
					...ADDRESS_FIELDS
				},
				required: ['type', 'name']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_my_company',
			description:
				"Mark a contact as the user's OWN company (Stammdaten / invoice seller). Used after the " +
				'first ingest HITL ("is this your company?") and for the user confirming their own details.',
			parameters: {
				type: 'object',
				properties: { contact_value_id: { type: 'string' } },
				required: ['contact_value_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'query_contacts',
			description:
				'Show the addressbook / contacts. Call when the user asks to see contacts / addressbook / ' +
				'an Adressbuch. Respond ONLY with the short sentence in `response`.',
			parameters: {
				type: 'object',
				properties: {
					filter: { type: ['string', 'null'], enum: ['person', 'company', 'all', null] },
					response: { type: 'string', description: 'One short human sentence.' }
				},
				required: ['response']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_invoice',
			description:
				'Create an OUTGOING invoice draft (Entwurf) from the prompt. Resolve the customer (by ' +
				'contact_value_id, or by name to create one), list the positions (NET unit prices + vat_rate). ' +
				'The server assigns the fortlaufende number (E-<contactId>-<seq>) and computes the VAT.',
			parameters: {
				type: 'object',
				properties: {
					contact_value_id: {
						type: ['string', 'null'],
						description: 'Existing customer contact id.'
					},
					customer: {
						type: ['object', 'null'],
						description: 'New customer to create if no contact_value_id.',
						properties: ADDRESS_FIELDS
					},
					issue_date: { type: ['string', 'null'], description: 'YYYY-MM-DD.' },
					service_period: {
						type: ['string', 'null'],
						description:
							'Liefer-/Leistungszeitraum (Pflichtangabe §14 UStG) — a date or range, e.g. "12.–14.05.2025" or "Mai 2025". Leave null only if it equals the invoice date.'
					},
					note: { type: ['string', 'null'] },
					lines: { type: 'array', items: INVOICE_LINE, minItems: 1 },
					response: { type: 'string', description: 'One short human sentence.' }
				},
				required: ['lines', 'response']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'update_invoice',
			description:
				'Edit an existing invoice (by number) — patches lines/fields and saves the NEXT version. The ' +
				'server recomputes the VAT and bumps the version.',
			parameters: {
				type: 'object',
				properties: {
					number: { type: 'string', description: 'The invoice number to edit.' },
					issue_date: { type: ['string', 'null'] },
					service_period: { type: ['string', 'null'], description: 'Liefer-/Leistungszeitraum.' },
					note: { type: ['string', 'null'] },
					lines: { type: ['array', 'null'], items: INVOICE_LINE },
					response: { type: 'string' }
				},
				required: ['number', 'response']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_invoice_state',
			description:
				'Promote/demote an invoice between states: entwurf → angebot → rechnung (or back). The server ' +
				're-prefixes + assigns the next number for the new state (E-/A-/R-).',
			parameters: {
				type: 'object',
				properties: {
					number: { type: 'string' },
					state: { type: 'string', enum: ['entwurf', 'angebot', 'rechnung'] },
					response: { type: 'string' }
				},
				required: ['number', 'state', 'response']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'save_invoice_pdf',
			description:
				'Render the current invoice to PDF and store it in the private file store. The client renders ' +
				'the HTML template → PDF; the hash is recorded on the invoice.',
			parameters: {
				type: 'object',
				properties: {
					number: { type: 'string' },
					response: { type: 'string' }
				},
				required: ['number', 'response']
			}
		}
	}
] as const

/** Every tool the chat advertises: data CRUD + Composer + bookkeeping + doc extract + BWA + invoicing. */
// board 0089/0090 — the legacy in-chat document path (`classify_document` + `extract_document`,
// boards 0064/0065) is DEPRECATED in favour of `run_skill` → the generic flow runner. Filter them
// out so the model can ONLY drive document/invoice ingestion through the new flows.
const DEPRECATED_TOOLS = new Set(['classify_document', 'extract_document'])
export const CHAT_TOOLS = [
	...DATA_TOOLS,
	...COMPOSER_TOOLS,
	...BOOKKEEPING_TOOLS,
	...EXTRACT_TOOLS,
	...SKILL_TOOLS,
	...FINANCE_TOOLS,
	...INVOICING_TOOLS
].filter((t) => !DEPRECATED_TOOLS.has(t.function.name))
