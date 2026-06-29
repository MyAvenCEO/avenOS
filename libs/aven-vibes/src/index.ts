// @avenos/aven-vibes — standalone vibes engine + todos vibe (copied from @avenos/aven-ui),
// wired to the betterauth /api/data store with generic CRUD tools for the LLM. board 0054.

// board 0082 — outgoing invoicing + addressbook.
export {
	CONTACT_SCHEMA,
	type Contact,
	type ContactType,
	contactDisplayName,
	mapContactToView,
	mintContactId
} from './contact.js'
export {
	enrichFields,
	matchContact,
	normalizeName,
	type PartyInput,
	partiesFromDoc,
	partyToContactFields
} from './contact-match.js'
export * from './engine/index.js'
export { contentHash, type FileRef, filePath, fileRef } from './file-ref.js'
// board 0084 — the flow/recipe model moved to @avenos/aven-skills (the actor engine). Import flow
// symbols from there; aven-vibes is vibe rendering only.
export {
	assignInvoiceNumber,
	type InvoiceState,
	invoiceNumber,
	nextSeq,
	parseInvoiceNumber,
	STATE_PREFIX
} from './invoice-number.js'
export * from './sandbox.js'
// Document extract + side-by-side compare vibe (invoice / bank-statement / contract). board 0064.
export type { DocView } from './vibes/_doc/types.js'
export {
	createBankStatementShell,
	mapBankStatementToView
} from './vibes/bank-statement/index.js'
export {
	bookkeepingLogic,
	bookkeepingShell,
	bookkeepingSource,
	bookkeepingStyle,
	bookkeepingTools,
	bookkeepingView,
	createBookkeepingShell
} from './vibes/bookkeeping/index.js'
export { createContractShell, mapContractToView } from './vibes/contract/index.js'
export {
	createDocCompareShell,
	type DocType,
	isDocType,
	mapDocView
} from './vibes/doc-compare/index.js'
export {
	type BookingRecord,
	mapBookingToView
} from './vibes/invoice/booking.js'
export { createInvoiceShell, mapInvoiceToView } from './vibes/invoice/index.js'
export {
	computeInvoiceTotals,
	INVOICE_DOC_SCHEMA,
	type InvoiceDoc,
	type InvoiceLine,
	invoiceDocToDoctype,
	mapInvoiceDocToView,
	requiredFieldsMissing
} from './vibes/invoice/invoice-doc.js'
export {
	bestInvoiceMatch,
	type InvoiceMatch,
	type MatchConfidence,
	mapMatchToView
} from './vibes/invoice/match.js'
export {
	createTodosShell,
	todoLogic,
	todoSource,
	todoStyle,
	todosShell,
	todoTools,
	todoView
} from './vibes/todos/index.js'
// AvenVibeView (Svelte) is exposed via the package subpath
// "@avenos/aven-vibes/AvenVibeView.svelte" (tsc can't resolve .svelte here).
