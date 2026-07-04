// board 0099 — the chat tool registry. A tool-actor (config + behavior) is registered here by name; the
// server's chat loop assembles the advertised tool list from `chatToolDefinitions()` and dispatches each
// tool_call to `TOOL_ACTORS[name].handle(ctx, args)`. New tool = add one module + one registry line; the
// loop never changes. The Composer website tools still carry their handlers inline in the server for now
// (their config already lives in this package via COMPOSER_TOOLS) — next to migrate to a tool-actor.

import { COMPOSER_TOOLS } from '../composer/tools'
import { bundle } from './bundle'
import { dataCrud } from './data-crud'
import { goals } from './goals'
import { locations } from './locations'
import { createMockup, editMockup } from './mockup'
import { mockups } from './mockups'
import { ontology } from './ontology'
import { improveSkillActor, mintData, planApp, promoteApp, seedDataActor, wireActors } from './promote'
import { mutate, query } from './queries'
import type { ToolActor, ToolDefinition } from './types'

/** name → tool-actor. Todos hub = `data_crud`; the dynamic Ontology skill = `ontology` (mint predicates, board
 *  0100) + `query`/`mutate` (GLM-authored specs over the x1–x5 store, board 0101) + `bundle` (GLM-authored
 *  composite types / kinds, board 0102). */
export const TOOL_ACTORS: Record<string, ToolActor> = {
	data_crud: dataCrud,
	goals,
	locations,
	create_mockup: createMockup,
	edit_mockup: editMockup,
	mockups,
	plan_app: planApp,
	mint_data: mintData,
	wire_actors: wireActors,
	seed_data: seedDataActor,
	promote: promoteApp,
	improve_skill: improveSkillActor,
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

// board 0106 — the dispatch skill registry. A SKILL is a named bucket of tools; the dispatch router
// (Tier 1) picks ONE skill per turn, and only that skill's tool definitions enter the model's context
// (Tier 2, `chatToolDefinitionsFor`). Heavy per-actor context (the gismu lexicon; the todos snapshot
// hint) loads only when relevant (Tier 3, gated in the server). This map is hardcoded TS for now — a
// clean seam to the DB `skill` table in board 0108 (config-as-data), mirroring TOOL_ACTORS above.
export type SkillId = 'todos' | 'ontology' | 'website' | 'inventory' | 'skillify'

export const SKILL_REGISTRY: Record<SkillId, { label: string; description: string; tools: string[] }> = {
	todos: {
		// board 0112 — renamed to the general "Planner" (goals, tags, sub-tasks — not just a flat list).
		// The skill ID stays `todos` (wire-stable, the 0040 lesson); only the label/description changed.
		label: 'Planner',
		description:
			"the user's planner — todos/tasks with goals, tags, sub-tasks, priorities and due dates: " +
			'list, add, complete, edit, delete, or group them',
		tools: ['data_crud', 'goals']
	},
	ontology: {
		label: 'Ontology',
		description:
			'define a new relationship type or composite kind, and ask/change things across the data ' +
			'(e.g. "people can own companies", "track books with a rating", "who owns >3 companies?", ' +
			'"transfer ownership from Alice to Bob")',
		tools: ['ontology', 'query', 'mutate', 'bundle']
	},
	website: {
		label: 'Website',
		description: 'view, edit, or publish the personal website / composer',
		tools: ['show_website', 'edit_website', 'deploy_website']
	},
	// board 0114 — the DB rows are the SSOT; this fail-safe must still know every skill (audit drift fix).
	inventory: {
		label: 'Inventory',
		description:
			"the user's inventory/stock — items with a location and an amount: list what's stored where, " +
			'add, move, restock/consume, or remove items',
		tools: ['data_crud', 'locations']
	},
	// board 0115 — skillify part 1: design/refine/show SCREEN MOCKUPS for new skill features.
	skillify: {
		label: 'Skillify',
		description:
			'design, refine, or show SCREEN MOCKUPS for new skill features ("design me a banking screen", ' +
			'"make the total bigger", "show me my mockups") — look only, no real data yet',
		tools: ['create_mockup', 'edit_mockup', 'mockups', 'plan_app', 'mint_data', 'wire_actors', 'seed_data', 'promote', 'improve_skill']
	}
}

/** When the router is unsure (unknown/empty reply, or no message), route to the most common skill. */
export const DEFAULT_SKILL: SkillId = 'todos'

/** Tier 2 — the exact tool ids a routed skill advertises (in the registry's declared order). */
export function advertisedTools(skillId: SkillId): string[] {
	return (SKILL_REGISTRY[skillId] ?? SKILL_REGISTRY[DEFAULT_SKILL]).tools
}

/** Tier 2 — only the routed skill's tool DEFINITIONS, filtered from the full actor + Composer set. */
export function chatToolDefinitionsFor(skillId: SkillId): ToolDefinition[] {
	const want = new Set(advertisedTools(skillId))
	return chatToolDefinitions().filter((d) => want.has(d.function.name))
}
