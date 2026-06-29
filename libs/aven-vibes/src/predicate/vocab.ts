// Todo predicate vocabulary — board 0087. A todo decomposes into a BUNDLE of predications, each
// carrying a canonical Lojban gismu from .claude/skills/ontology (the place order is adapted to the
// "task as x1" reification pattern where noted):
//   task        ≡ zukte  — x1 (agent) employs means/takes action x2             [faithful]
//   valid       ≡ ranji  — x1 (event/state) persists over interval x2→x3        [x1 = the task/fact]
//   due         ≡ detri  — x1 (the date) is the date of event x2                [faithful: date=x1, task=x2]
//   prioritized ≡ vajni  — x1 (task) important to x2 (user) in aspect/degree x3 [faithful: level=x3]
// Each compiles to a self-documenting Ajv data_schema named `pred:<predicate>` and is seeded
// into the DYNAMIC data_schema store (Layer B). See [[two-layer-schema-split]].
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

export const VALID: PredicateDef = {
	predicate: 'valid',
	gismu: 'ranji',
	gloss: 'x1 (the fact) persists/is valid over the interval x2→x3 (ranji: x1 continues over an interval); x3 null = still open, set x3 to close/done',
	places: [
		{
			pos: 'x1',
			role: 'fact',
			gloss: 'the fact this validity applies to',
			kind: 'ref',
			references: '*'
		},
		{
			pos: 'x2',
			role: 'from',
			gloss: 'start of the interval (inclusive)',
			kind: 'value',
			type: 'date-time',
			example: '2026-06-29T08:00:00Z'
		},
		{
			pos: 'x3',
			role: 'to',
			gloss: 'end of the interval, or null while open',
			kind: 'value',
			type: 'date-time',
			required: false,
			nullable: true
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

/** The full todo predicate bundle (Layer B vocab to seed into data_schema). */
export const TODO_PREDICATES: PredicateDef[] = [TASK, VALID, DUE, PRIORITIZED]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function todoPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return TODO_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}

export type { PredicateDef } from './compile.js'
export { compilePredicate, predSchemaName }
