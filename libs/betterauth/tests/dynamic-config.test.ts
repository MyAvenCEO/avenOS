import { buildRouterRequest } from '@avenos/skills/tools'
import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import {
	actorConfig,
	advertisedTools,
	chatToolDefinitionsFor,
	engineFor,
	skillMenu
} from '../src/config'
import { db } from '../src/db'

// board 0110 — the skill + actor (config-as-data) registries LOAD from the DB `skill`/`actor` tables,
// seeded to parity with the old TS. Proves: parity · mailboxes built from the DB · prompt/llm served from
// the actor row (mutate the row → the runtime reads the change) · DB-only-row dynamism (a row with NO code
// is routable + advertised, engine resolved by name) · the router stays schema-free.

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
const DB = await hasDb()
const d = DB ? describe : describe.skip

const TSKILL = 'zzz-dyn-test-skill'
const TACTOR = 'zzz-dyn-test-actor'

d('board 0110 — config-as-data: skills + actors load from the DB', () => {
	test('Tier-2 parity: advertised lists come from the DB seed', async () => {
		// board 0112 — the Planner carries data_crud + the goals grid actor.
		expect(await advertisedTools('todos')).toEqual(['data_crud', 'goals'])
		expect(await advertisedTools('ontology')).toEqual(['ontology', 'query', 'mutate', 'bundle'])
		expect(await advertisedTools('website')).toEqual([
			'show_website',
			'edit_website',
			'deploy_website'
		])
	})

	test('chatToolDefinitionsFor builds mailboxes from the DB', async () => {
		const defs = await chatToolDefinitionsFor('todos')
		expect(defs.map((x) => x.function.name)).toEqual(['data_crud', 'goals'])
		expect(defs[0]?.function.parameters).toBeTruthy() // the mailbox (params schema) came from the row
	})

	test('prompt + llm served from the actor row (mutate → runtime reads the change)', async () => {
		const a = await actorConfig('ontology')
		expect(a?.prompt).toBeTruthy()
		expect(a?.prompt).toContain('mint') // the CREATE_INSTRUCTIONS mint prompt
		expect(a?.llm?.model).toBe('glm-5-2')
		const orig = a?.prompt ?? ''
		await sql`UPDATE actor SET prompt = ${'ZZZ-CHANGED'} WHERE name = ${'ontology'}`.execute(db())
		expect((await actorConfig('ontology'))?.prompt).toBe('ZZZ-CHANGED')
		await sql`UPDATE actor SET prompt = ${orig} WHERE name = ${'ontology'}`.execute(db())
	})

	test('DB-only dynamism: a new skill+actor row (no TS) is routable + advertised, engine by name', async () => {
		await sql`INSERT INTO skill (id, label, description, position) VALUES (${TSKILL}, 'ZZZ', 'a throwaway test skill', 999) ON CONFLICT (id) DO NOTHING`.execute(
			db()
		)
		await sql`INSERT INTO actor (id, skill_id, name, engine, mailbox, position) VALUES (${TACTOR}, ${TSKILL}, ${TACTOR}, ${'data_crud'}, ${JSON.stringify({ description: 'x', parameters: { type: 'object' } })}::jsonb, 0) ON CONFLICT (id) DO NOTHING`.execute(
			db()
		)
		expect(await advertisedTools(TSKILL)).toEqual([TACTOR])
		expect((await skillMenu()).some((s) => s.id === TSKILL)).toBe(true)
		expect(engineFor('data_crud')).toBeTruthy() // behavior resolved by name
		expect((await chatToolDefinitionsFor(TSKILL)).map((x) => x.function.name)).toEqual([TACTOR])
	})

	test('router request stays schema-free (no tools / no params schema)', () => {
		const req = buildRouterRequest('add milk', 'gemma4-31b')
		expect('tools' in req).toBe(false)
		expect(JSON.stringify(req).toLowerCase()).not.toContain('parameters')
	})

	afterAll(async () => {
		if (!DB) return
		await sql`DELETE FROM actor WHERE id = ${TACTOR}`.execute(db())
		await sql`DELETE FROM skill WHERE id = ${TSKILL}`.execute(db())
	})
})
