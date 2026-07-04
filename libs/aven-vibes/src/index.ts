// @avenos/aven-vibes — the standalone vibes engine + the Todos vibe, wired to the betterauth /api/data
// store with the generic data_crud tool for the LLM. board 0099 stripped every non-todos vibe; the
// document/finance verticals (invoice/bank-statement/contract/bookkeeping/doc-compare + contact/invoice
// helpers) are gone. Predication vocab is a subpath: '@avenos/aven-vibes/predicate'; SKR04 is './skr'.

export * from './engine/index.js'
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
