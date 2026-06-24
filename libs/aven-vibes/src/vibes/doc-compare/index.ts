import type { UiFixtureShell } from '../../engine/types.js'
import { makeDocShell } from '../_doc/index.js'
import type { DocView } from '../_doc/types.js'
import { mapBankStatementToView } from '../bank-statement/mapper.js'
import { mapContractToView } from '../contract/mapper.js'
import { mapInvoiceToView } from '../invoice/mapper.js'

// doc-compare: the side-by-side document compare vibe. The chat loop (classify → extract) hands the
// raw extracted JSON + its type here; we pick the per-type mapper, flatten to a DocView, and build a
// generic structured-document shell for the right-hand panel. board 0064.

export type DocType = 'invoice' | 'bank_statement' | 'contract'

const MAPPERS: Record<DocType, (raw: unknown) => DocView> = {
	invoice: mapInvoiceToView,
	bank_statement: mapBankStatementToView,
	contract: mapContractToView
}

export function isDocType(t: unknown): t is DocType {
	return t === 'invoice' || t === 'bank_statement' || t === 'contract'
}

/** Flatten raw extracted JSON for a doctype into the generic DocView. */
export function mapDocView(type: DocType, extracted: unknown): DocView {
	return (MAPPERS[type] ?? MAPPERS.invoice)(extracted)
}

/** Build a ready vibe shell for the right-hand compare panel from raw extracted JSON. */
export function createDocCompareShell(type: DocType, extracted: unknown): UiFixtureShell {
	return makeDocShell(mapDocView(type, extracted) as unknown as Record<string, unknown>)
}
