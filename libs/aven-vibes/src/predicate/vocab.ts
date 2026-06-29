// Todo predicate vocabulary — board 0087. A todo decomposes into a BUNDLE of predications, each
// carrying a canonical Lojban gismu from .claude/skills/ontology (the place order is adapted to the
// "task as x1" reification pattern where noted):
//   task        ≡ zukte  — x1 (agent) employs means/takes action x2            [faithful]
//   valid       ≡ ranji  — x1 (event/state) persists over the interval x2→x3   [x1 = the fact]
//   due         ≡ detri  — the date x2 of the task x1 (x1 is due by x2)         [adapted: task in x1]
//   prioritized ≡ vajni  — x1 (task) is important in aspect/degree x2 (level)   [x2 = priority level]
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

export const DUE: PredicateDef = {
	predicate: 'due',
	gismu: 'detri',
	gloss: 'x2 is the date (detri) by which the task x1 is due',
	places: [
		{ pos: 'x1', role: 'task', gloss: 'the task that is due', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'date',
			gloss: 'the due date',
			kind: 'value',
			type: 'date-time',
			example: '2026-07-01'
		}
	]
}

export const PRIORITIZED: PredicateDef = {
	predicate: 'prioritized',
	gismu: 'vajni',
	gloss: 'x1 (task) is important (vajni) in aspect/degree x2 — the priority level',
	places: [
		{ pos: 'x1', role: 'task', gloss: 'the task being prioritized', kind: 'ref', references: '*' },
		{
			pos: 'x2',
			role: 'level',
			gloss: 'priority level',
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
