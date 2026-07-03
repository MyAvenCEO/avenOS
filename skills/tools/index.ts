// board 0099 — chat tool-actors: config + behavior, co-located. The server injects runtime caps via ToolCtx.

export { BUNDLE_TOOL, bundle } from './bundle'
export { DATA_CRUD_TOOL, dataCrud } from './data-crud'
export { CREATE_INSTRUCTIONS, type ExistingPredicate, findExistingPredicate } from './ontology'
export { MUTATE_TOOL, mutate, QUERY_TOOL, query } from './queries'
export {
	advertisedTools,
	chatToolDefinitions,
	chatToolDefinitionsFor,
	DEFAULT_SKILL,
	SKILL_REGISTRY,
	type SkillId,
	TOOL_ACTORS
} from './registry'
export {
	assembleSystemContext,
	buildRouterRequest,
	parseSkillId,
	type RouterRequest,
	routeSkill,
	type SkillMenuItem,
	skillWantsTodosHint
} from './dispatch'
export type {
	DataCrudArgs,
	PlaceDefJSON,
	PredicateDefJSON,
	ToolActor,
	ToolCtx,
	ToolDefinition,
	ToolResult
} from './types'
