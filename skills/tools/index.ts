// board 0099 — chat tool-actors: config + behavior, co-located. The server injects runtime caps via ToolCtx.

export { CREATE_INSTRUCTIONS, type ExistingPredicate, findExistingPredicate } from './brain'
export { BUNDLE_TOOL, bundle } from './bundle'
export { DATA_CRUD_TOOL, dataCrud } from './data-crud'
export { MUTATE_TOOL, mutate, QUERY_TOOL, query } from './queries'
export { chatToolDefinitions, TOOL_ACTORS } from './registry'
export type {
	DataCrudArgs,
	PlaceDefJSON,
	PredicateDefJSON,
	ToolActor,
	ToolCtx,
	ToolDefinition,
	ToolResult
} from './types'
