// @avenos/aven-vibes — the standalone vibes engine + the Todos vibe, wired to the betterauth /api/data
// store with the generic data_crud tool for the LLM. board 0099 stripped every non-todos vibe; the
// document/finance verticals (invoice/bank-statement/contract/bookkeeping/doc-compare + contact/invoice
// helpers) are gone. Predication vocab is a subpath: '@avenos/aven-vibes/predicate'; SKR04 is './skr'.

export * from './engine/index.js'
export { contentHash, type FileRef, filePath, fileRef } from './file-ref.js'
export * from './sandbox.js'
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
