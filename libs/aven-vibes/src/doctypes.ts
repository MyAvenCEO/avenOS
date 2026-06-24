// Pure server-safe doctype registry: extraction schema + system_prompt per document type. Imports
// ONLY JSON (no DOM / vibe engine), so the betterauth server can load these for the extraction call
// + AvenDB schema registration without pulling in the renderer. board 0064.

import bankStatementDoctype from './vibes/bank-statement/doctype.json'
import contractDoctype from './vibes/contract/doctype.json'
import invoiceDoctype from './vibes/invoice/doctype.json'

export type DocType = 'invoice' | 'bank_statement' | 'contract'

export type Doctype = {
	id: string
	name: string
	description?: string
	system_prompt: string
	schema: Record<string, unknown>
}

const DOCTYPES: Record<DocType, Doctype> = {
	invoice: invoiceDoctype as unknown as Doctype,
	bank_statement: bankStatementDoctype as unknown as Doctype,
	contract: contractDoctype as unknown as Doctype
}

export const DOC_TYPES: DocType[] = ['invoice', 'bank_statement', 'contract']

export function isDocType(t: unknown): t is DocType {
	return t === 'invoice' || t === 'bank_statement' || t === 'contract'
}

/** The doctype (schema + system_prompt) for a type, or undefined. */
export function getDoctype(type: string): Doctype | undefined {
	return isDocType(type) ? DOCTYPES[type] : undefined
}
