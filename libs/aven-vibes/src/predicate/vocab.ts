// Todo predicate vocabulary — board 0087. A todo decomposes into a BUNDLE of predications, each
// carrying a canonical Lojban gismu from .claude/skills/ontology (the place order is adapted to the
// "task as x1" reification pattern where noted):
//   owned_by    ≡ ponse  — x1 (account) owns/possesses x2 (the entity)          [universal ownership]
//   task        ≡ zukte  — x1 (agent) employs means/takes action x2             [faithful]
//   done        ≡ mulno  — x1 (the task) is complete; predication exists iff done [presence = done]
//   due         ≡ detri  — x1 (the date) is the date of event x2                [faithful: date=x1, task=x2]
//   prioritized ≡ vajni  — x1 (task) important to x2 (user) in aspect/degree x3 [faithful: level=x3]
// owned_by≡ponse is UNIVERSAL (board 0092): every entity binds to its account here, replacing a
// user_id column — ownership IS a predication. done≡mulno replaces the old valid≡ranji interval:
// completion is a STATE (the mulno predication present), not a closed time interval.
// Each compiles to a self-documenting Ajv data_schema named `<predicate>` (the bare data-type name —
// x1–x5 predications ARE the universal data-type model, no namespace prefix leaks to the DB/UI) and
// is seeded into the DYNAMIC data_schema store (Layer B). See [[two-layer-schema-split]].
import { compilePredicate, type PredicateDef, predSchemaName } from './compile.js'

export const TASK: PredicateDef = {
	predicate: 'task',
	gismu: 'zukte',
	gloss: 'x1 (agent) employs means / takes on action-task x2 (zukte)',
	places: [
		{
			pos: 'x1',
			role: 'agent',
			gloss: 'who holds this intention (a user)',
			kind: 'ref',
			references: 'user',
			example: 'JhB95T3lSOe0ZYTKLzuKNXHzGeju9LIb'
		},
		{
			pos: 'x2',
			role: 'what',
			gloss: 'the task — a short imperative phrase',
			kind: 'value',
			type: 'string',
			minLength: 1,
			example: 'Zwei Bananen kaufen'
		}
	]
}

// ponse: x1 owns x2. UNIVERSAL ownership (board 0092) — every entity carries ONE owned_by binding it
// to its account (x1=account, x2=the entity). Replaces a user_id column: ownership IS a predication.
export const OWNED_BY: PredicateDef = {
	predicate: 'owned_by',
	gismu: 'ponse',
	gloss: 'ponse: x1 (the account) owns/possesses x2 (the entity) — universal ownership of any data item',
	places: [
		{
			pos: 'x1',
			role: 'owner',
			gloss: 'the owning account — ponse x1 (owner/proprietor)',
			kind: 'ref',
			references: 'user'
		},
		{
			pos: 'x2',
			role: 'possession',
			gloss: 'the entity owned — ponse x2 (what is owned)',
			kind: 'ref',
			references: '*'
		}
	]
}

// mulno: x1 (event) is complete/done. PRESENCE of this predication = the task is done; its absence =
// still open. A state, not a closed interval (replaces the old valid≡ranji). Only x1 is modelled.
export const DONE: PredicateDef = {
	predicate: 'done',
	gismu: 'mulno',
	gloss: 'mulno: x1 (the task) is complete/finished — the predication exists iff the task is done',
	places: [
		{
			pos: 'x1',
			role: 'complete thing',
			gloss: 'the task that is finished — mulno x1 (the completed event/object)',
			kind: 'ref',
			references: '*'
		}
	]
}

// detri: x1 IS THE DATE of event x2 — so the date is x1 and the task is x2 (canonical, not reversed).
export const DUE: PredicateDef = {
	predicate: 'due',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of event x2 — i.e. task x2 is due by date x1',
	places: [
		{
			pos: 'x1',
			role: 'date',
			gloss: 'the due date — detri x1 (the date itself)',
			kind: 'value',
			type: 'date-time',
			example: '2026-07-01'
		},
		{
			pos: 'x2',
			role: 'task',
			gloss: 'the task this is the deadline of — detri x2 (the event)',
			kind: 'ref',
			references: '*'
		}
	]
}

// vajni: x1 is important TO x2 in aspect x3 — task in x1, the user in x2, the priority level in x3.
export const PRIORITIZED: PredicateDef = {
	predicate: 'prioritized',
	gismu: 'vajni',
	gloss: 'vajni: x1 (the task) is important to x2 (the user) in aspect/degree x3 — the priority level',
	places: [
		{
			pos: 'x1',
			role: 'task',
			gloss: 'the important thing — the task (vajni x1)',
			kind: 'ref',
			references: '*'
		},
		{
			pos: 'x2',
			role: 'beneficiary',
			gloss: 'to whom it is important — the user (vajni x2)',
			kind: 'ref',
			references: 'user'
		},
		{
			pos: 'x3',
			role: 'level',
			gloss: 'the priority level / degree of importance — vajni x3 (aspect)',
			kind: 'value',
			type: 'string',
			example: 'high'
		}
	]
}

/** The full todo predicate bundle (Layer B vocab to seed into data_schema). owned_by is universal but
 *  seeded with the first vertical; document/invoice reuse the same OWNED_BY def. board 0092. */
export const TODO_PREDICATES: PredicateDef[] = [TASK, OWNED_BY, DONE, DUE, PRIORITIZED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function todoPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return TODO_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}

export type { PredicateDef } from './compile.js'
export { compilePredicate, predSchemaName }
