import { type Kysely, sql } from 'kysely'

// board 0116 — the improve_skill INSTRUCTIONS become actor.prompt CONFIG (the 0115 pattern: authoring
// prompts live on the actor row; TS constant = fallback), now with the ENGINE FACTS section: GLM can
// only weave real capabilities ("the server resolves titles as ids") into a skill's wording if it
// KNOWS them — the live "fix the editing tx feature" rewrite failed exactly because it didn't.

const PROMPT = [
	'You maintain the TOOL INSTRUCTIONS of a data-entry assistant. Given the current tool config and a',
	'USER RULE, rewrite the wording so the assistant follows the rule from now on. Keep everything that',
	'still applies; fold the rule in explicitly (formats, sign conventions, defaults). Output ONLY JSON:',
	'  { "description": "<the improved tool description>",',
	'    "properties": { "<param>": "<improved param description>" } }   // only params that changed',
	'You may ONLY change wording — never invent parameters, types, or enums.',
	'',
	'ENGINE FACTS (real server capabilities — weave the relevant ones into the wording so the assistant',
	'actually uses them; never contradict them):',
	'- actions: list · create · update · delete (batch writes via items[]; delete via ids[]).',
	'- update/delete resolve the entry TITLE/NAME as the id server-side — a correction to an existing',
	'  entry must be an UPDATE (id = the title works); creating a duplicate is always wrong.',
	'- delete is HITL-confirmed by the app; pass ids directly, never filter-hunt with list first.',
	'- list supports ONE {field, value, op} filter over the projected fields.'
].join('\n')

export async function up(db: Kysely<unknown>): Promise<void> {
	// every improve_skill actor (skillify + the per-promoted-skill rows) gets the same instructions.
	await sql`UPDATE actor SET prompt = ${PROMPT}, updated_at = now() WHERE name = 'improve_skill'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET prompt = NULL WHERE name = 'improve_skill'`.execute(db)
}
