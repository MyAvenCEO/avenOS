import { describe, expect, test } from 'bun:test'
import {
	advertisedTools,
	assembleSystemContext,
	buildRouterRequest,
	chatToolDefinitions,
	chatToolDefinitionsFor,
	parseSkillId,
	routeSkill,
	skillWantsTodosHint
} from '@avenos/skills/tools'

// board 0106 — the DISPATCH skill: a gemma router (Tier 1) delegates each turn to ONE skill; only that
// skill's tools enter context (Tier 2); heavy context loads only on run (Tier 3). This proves the pure
// routing/advertise/gating logic + the per-turn token win. Live router ACCURACY is a HITL review check
// (non-deterministic), not asserted here.

describe('Tier 2 — a routed skill advertises exactly its own tools', () => {
	test('exact tool sets per skill', () => {
		expect(advertisedTools('todos')).toEqual(['data_crud'])
		expect(advertisedTools('ontology')).toEqual(['ontology', 'query', 'mutate', 'bundle'])
		expect(advertisedTools('website')).toEqual([
			'show_website',
			'edit_website',
			'deploy_website'
		])
	})

	test('chatToolDefinitionsFor returns only those tool definitions', () => {
		expect(chatToolDefinitionsFor('todos').map((d) => d.function.name)).toEqual(['data_crud'])
		expect(chatToolDefinitionsFor('ontology').map((d) => d.function.name)).toEqual([
			'ontology',
			'query',
			'mutate',
			'bundle'
		])
		expect(chatToolDefinitionsFor('website').map((d) => d.function.name)).toEqual([
			'show_website',
			'edit_website',
			'deploy_website'
		])
	})

	test('a todos turn advertises far fewer tool-schema chars than the flat list', () => {
		const todos = JSON.stringify(chatToolDefinitionsFor('todos')).length
		const all = JSON.stringify(chatToolDefinitions()).length
		console.log(`todos-turn advertised tool-schema chars: ${todos} (flat-8 baseline: ${all})`)
		expect(todos).toBeLessThanOrEqual(1600)
		expect(todos).toBeLessThan(all) // strictly leaner than advertising everything
	})
})

describe('Tier 1 — the router request is schema-free', () => {
	test('no tools array, no tool schema, no gismu lexicon; just a menu + the user message', () => {
		const req = buildRouterRequest('add milk to my todos', 'gemma4-31b')
		expect('tools' in req).toBe(false)
		expect(req.messages).toHaveLength(2)
		expect(req.messages[0].role).toBe('system')
		expect(req.messages[1]).toEqual({ role: 'user', content: 'add milk to my todos' })
		const body = JSON.stringify(req).toLowerCase()
		expect(body).not.toContain('data_crud') // no tool schema leaked in
		expect(body).not.toContain('gismu')
		expect(body).not.toContain('parameters') // no JSON-schema of any tool
		expect(body.length).toBeLessThan(1200) // stays tiny
	})
})

describe('router parsing + fallback', () => {
	test('parseSkillId: whole-word match, else default (todos)', () => {
		expect(parseSkillId('ontology')).toBe('ontology')
		expect(parseSkillId('The answer is website.')).toBe('website')
		expect(parseSkillId('todos')).toBe('todos')
		expect(parseSkillId('zzz not a skill')).toBe('todos')
		expect(parseSkillId('')).toBe('todos')
	})

	test('routeSkill: valid reply routes; garbage / error / empty → todos', async () => {
		expect(await routeSkill(async () => 'ontology', 'people can own companies', 'm')).toBe(
			'ontology'
		)
		expect(await routeSkill(async () => 'website', 'edit my site', 'm')).toBe('website')
		expect(await routeSkill(async () => 'nonsense', 'hello', 'm')).toBe('todos')
		expect(
			await routeSkill(
				async () => {
					throw new Error('router down')
				},
				'hi',
				'm'
			)
		).toBe('todos')
		expect(await routeSkill(async () => 'ontology', '   ', 'm')).toBe('todos') // empty input never calls the model
	})
})

describe('Tier 3 — the todos snapshot hint is gated to the todos route', () => {
	test('skillWantsTodosHint only for todos', () => {
		expect(skillWantsTodosHint('todos')).toBe(true)
		expect(skillWantsTodosHint('ontology')).toBe(false)
		expect(skillWantsTodosHint('website')).toBe(false)
	})

	test('assembled context includes the hint on the todos route, not elsewhere', () => {
		const HINT = 'CURRENT TODOS: [id=abc] buy milk'
		expect(assembleSystemContext('todos', 'SYSTEM', HINT)).toContain(HINT)
		expect(assembleSystemContext('ontology', 'SYSTEM', HINT)).not.toContain(HINT)
		expect(assembleSystemContext('website', 'SYSTEM', HINT)).not.toContain(HINT)
	})
})
