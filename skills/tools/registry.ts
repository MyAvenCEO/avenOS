// board 0099 — the chat tool registry. A tool-actor (config + behavior) is registered here by name; the
// server's chat loop assembles the advertised tool list from `chatToolDefinitions()` and dispatches each
// tool_call to `TOOL_ACTORS[name].handle(ctx, args)`. New tool = add one module + one registry line; the
// loop never changes. The Composer website tools still carry their handlers inline in the server for now
// (their config already lives in this package via COMPOSER_TOOLS) — next to migrate to a tool-actor.

import { COMPOSER_TOOLS } from '../composer/tools'
import { bundle } from './bundle'
import { dataCrud } from './data-crud'
import { ontology } from './ontology'
import { mutate, query } from './queries'
import type { ToolActor, ToolDefinition } from './types'

/** name → tool-actor. Todos hub = `data_crud`; the dynamic Ontology skill = `ontology` (mint predicates, board
 *  0100) + `query`/`mutate` (GLM-authored specs over the x1–x5 store, board 0101) + `bundle` (GLM-authored
 *  composite types / kinds, board 0102). */
export const TOOL_ACTORS: Record<string, ToolActor> = {
	data_crud: dataCrud,
	ontology,
	query,
	mutate,
	bundle
}

/** Every tool the chat advertises: the registered actors + the Composer configs (handled inline server-side). */
export function chatToolDefinitions(): ToolDefinition[] {
	return [
		...Object.values(TOOL_ACTORS).map((a) => a.definition),
		...(COMPOSER_TOOLS as ToolDefinition[])
	]
}
