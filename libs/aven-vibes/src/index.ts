// @avenos/aven-vibes — the standalone vibes engine + the Todos vibe, wired to the betterauth /api/data
// store with the generic data_crud tool for the LLM. board 0099 stripped every non-todos vibe; the
// document/finance verticals (invoice/bank-statement/contract/bookkeeping/doc-compare + contact/invoice
// helpers) are gone. Predication vocab is a subpath: '@avenos/aven-vibes/predicate'; SKR04 is './skr'.

export * from './engine/index.js'
export { brandBaseSelectors, brandTokens, mergeDeep, withBrand } from './brand-style.js'
export { contentHash, type FileRef, filePath, fileRef } from './file-ref.js'
export * from './sandbox.js'
// Shared read-only card style (todos created/edited/deleted, ontology, query/mutation, bundle). board 0111.
export { cardStyle } from './vibes/cards/style.js'
// The Planner's goals grid card. board 0112.
export { goalsStyle } from './vibes/goals/style.js'
// The Inventory vibes — a bespoke "stock ledger" list + a "storage bins" locations grid. board 0112.
export { inventoryStyle } from './vibes/inventory/style.js'
export { inventoryView } from './vibes/inventory/view.js'
export { inventoryLogic } from './vibes/inventory/logic.js'
export { locationsStyle } from './vibes/inventory-locations/style.js'
export { locationsView } from './vibes/inventory-locations/view.js'
export { locationsLogic } from './vibes/inventory-locations/logic.js'
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

// ── dev-line (board 0064/0084) doc/invoice/banking exports — merged union ──
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
export {
	assignInvoiceNumber,
	type InvoiceState,
	invoiceNumber,
	nextSeq,
	parseInvoiceNumber,
	STATE_PREFIX
} from './invoice-number.js'
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
