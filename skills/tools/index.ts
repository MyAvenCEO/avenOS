// board 0099 — chat tool-actors: config + behavior, co-located. The server injects runtime caps via ToolCtx.
export type { DataCrudArgs, ToolActor, ToolCtx, ToolDefinition, ToolResult } from './types'
export { DATA_CRUD_TOOL, dataCrud } from './data-crud'
export { chatToolDefinitions, TOOL_ACTORS } from './registry'
