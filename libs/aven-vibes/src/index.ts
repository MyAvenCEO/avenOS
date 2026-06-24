// @avenos/aven-vibes — standalone vibes engine + todos vibe (copied from @avenos/aven-ui),
// wired to the betterauth /api/data store with generic CRUD tools for the LLM. board 0054.

export * from './engine/index.js'
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
