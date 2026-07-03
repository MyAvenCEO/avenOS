// Todo predicate vocabulary — board 0087, completed to FULL gismu place structures (board 0097). Each
// predicate now carries EVERY place its canonical gismu defines (x1–x5 from .claude/skills/ontology);
// the places our domain doesn't fill are `required: false` (present + documented, never dropped):
//   owned_by    ≡ ponse  — x1 owner · x2 possession · x3 standard                 [universal ownership]
//   task        ≡ zukte  — x1 actor · x2 action · x3 goal
//   done        ≡ mulno  — x1 complete-thing · x2 property · x3 standard           [presence = done]
//   due         ≡ detri  — x1 date · x2 event · x3 location · x4 calendar
//   prioritized ≡ vajni  — x1 significant-thing · x2 audience · x3 aspect
// owned_by≡ponse is UNIVERSAL (board 0092): every entity binds to its account here, replacing a
// user_id column — ownership IS a predication. done≡mulno is a STATE (the predication present = done).
// Each compiles to a self-documenting Ajv data_schema named `<predicate>` (the bare data-type name —
// x1–x5 predications ARE the universal data-type model) seeded into the DYNAMIC data_schema store
// (Layer B). See [[two-layer-schema-split]].
import { compilePredicate, type PredicateDef, predSchemaName, ref, val } from './compile.js'

// zukte: x1 actor (a volitional entity), x2 the action/means, x3 the goal/purpose.
export const TASK: PredicateDef = {
	predicate: 'task',
	gismu: 'zukte',
	gloss: 'zukte: x1 (the actor) employs means / takes on action-task x2 toward goal x3',
	places: [
		ref('x1', 'agent', 'who holds this intention (a user) — zukte x1 (the actor)', {
			references: 'user',
			example: 'JhB95T3lSOe0ZYTKLzuKNXHzGeju9LIb'
		}),
		val('x2', 'what', 'the task — a short imperative phrase (zukte x2, the action/means)', 'string', {
			minLength: 1,
			example: 'Zwei Bananen kaufen'
		}),
		val('x3', 'goal', 'the goal/purpose the action serves — zukte x3 (often left open)', 'string', {
			required: false,
			example: 'Vorrat auffüllen'
		})
	]
}

// ponse: x1 owns x2 under standard x3. UNIVERSAL ownership (board 0092) — every entity carries ONE
// owned_by binding it to its account (x1=account, x2=the entity); x3 = the law/custom (open).
export const OWNED_BY: PredicateDef = {
	predicate: 'owned_by',
	gismu: 'ponse',
	gloss: 'ponse: x1 (the account) owns/possesses x2 (the entity) under standard x3 — universal ownership',
	places: [
		ref('x1', 'owner', 'the owning account — ponse x1 (owner/proprietor)', { references: 'user' }),
		ref('x2', 'possession', 'the entity owned — ponse x2 (what is owned)'),
		val('x3', 'standard', 'the law/custom the ownership holds under — ponse x3 (open)', 'string', {
			required: false
		})
	]
}

// mulno: x1 (event) is complete/done; x2 the property in which complete; x3 the standard. PRESENCE of
// this predication = the task is done; its absence = still open. A state, not a closed interval.
export const DONE: PredicateDef = {
	predicate: 'done',
	gismu: 'mulno',
	gloss: 'mulno: x1 (the task) is complete/finished in property x2 by standard x3 — the predication exists iff done',
	places: [
		ref('x1', 'complete thing', 'the task that is finished — mulno x1 (the completed event/object)'),
		val('x2', 'property', 'the property in which it is complete — mulno x2 (open)', 'string', {
			required: false
		}),
		val('x3', 'standard', 'the completeness standard — mulno x3 (open)', 'string', { required: false })
	]
}

// detri: x1 IS THE DATE of event x2 at location x3 by calendar x4 — date=x1, task=x2 (canonical).
export const DUE: PredicateDef = {
	predicate: 'due',
	gismu: 'detri',
	gloss: 'detri: x1 (the date) is the date of event x2 at location x3 by calendar x4 — task x2 due by date x1',
	places: [
		val('x1', 'date', 'the due date — detri x1 (the date itself)', 'date-time', { example: '2026-07-01' }),
		ref('x2', 'task', 'the task this is the deadline of — detri x2 (the event)'),
		ref('x3', 'location', 'the place the dating is reckoned at — detri x3 (open)', { required: false }),
		val('x4', 'calendar', 'the calendar/standard — detri x4 (open, e.g. Gregorian)', 'string', {
			required: false
		})
	]
}

// vajni: x1 is important TO x2 in aspect x3 — task in x1, the user in x2, the priority level in x3.
export const PRIORITIZED: PredicateDef = {
	predicate: 'prioritized',
	gismu: 'vajni',
	gloss: 'vajni: x1 (the task) is important to x2 (the user) in aspect/degree x3 — the priority level',
	places: [
		ref('x1', 'task', 'the important thing — the task (vajni x1, the significant thing)'),
		ref('x2', 'beneficiary', 'to whom it is important — the user (vajni x2, the audience)', {
			references: 'user'
		}),
		val('x3', 'level', 'the priority level / degree of importance — vajni x3 (aspect)', 'string', {
			example: 'high'
		})
	]
}

// cmima: x1 is a member/element of set x2. GOAL CLUSTERING (board 0112 battle test): a task belongs to a
// named goal/group — member_of(x1=the task, x2=the goal name). The goal stays an atomic label (the 0103
// rule: reify only when it gains structure of its own).
export const MEMBER_OF: PredicateDef = {
	predicate: 'member_of',
	gismu: 'cmima',
	gloss: 'cmima: x1 (the task/entity) is a member of set/group x2 — clusters tasks under a named goal',
	places: [
		ref('x1', 'member', 'the entity that belongs — the task (cmima x1, the member)'),
		val('x2', 'set', 'the goal/group it belongs to — cmima x2 (the set), a name label', 'string', {
			minLength: 1,
			example: 'Fitness'
		})
	]
}

// pagbu: x1 is a part/component of x2. SUB-TASKS: part_of(x1=the sub-task, x2=the parent task) — both
// real task rows, so hierarchy queries are joins/chains over the same predicate.
export const PART_OF: PredicateDef = {
	predicate: 'part_of',
	gismu: 'pagbu',
	gloss: 'pagbu: x1 (the sub-task) is a part/component of whole x2 (the parent task)',
	places: [
		ref('x1', 'part', 'the sub-task — pagbu x1 (the piece)'),
		ref('x2', 'whole', 'the parent task it belongs to — pagbu x2 (the whole)')
	]
}

// tcita: x1 is a label/tag of x2. TAGS (many-to-many — several tag rows per task): tagged(x1=the tag
// text, x2=the entity). Same inverted shape as `due` (value first, entity second) — Lojban-faithful.
export const TAGGED: PredicateDef = {
	predicate: 'tagged',
	gismu: 'tcita',
	gloss: 'tcita: x1 (the tag/label text) labels entity x2 — attach any number of tags to a task',
	places: [
		val('x1', 'tag', 'the tag text — tcita x1 (the label)', 'string', {
			minLength: 1,
			example: 'shopping'
		}),
		ref('x2', 'labelled', 'the entity carrying the tag — tcita x2 (the labelled thing)')
	]
}

/** The full todo predicate bundle (Layer B vocab to seed into data_schema). owned_by is universal but
 *  seeded with the first vertical; document/invoice reuse the same OWNED_BY def. board 0092.
 *  board 0112 — the Planner battle test adds member_of (goals), part_of (sub-tasks), tagged (tags). */
export const TODO_PREDICATES: PredicateDef[] = [
	TASK,
	OWNED_BY,
	DONE,
	DUE,
	PRIORITIZED,
	MEMBER_OF,
	PART_OF,
	TAGGED
]

/** Compiled `{ name, jsonSchema }` rows ready to seed as data_schema entries. */
export function todoPredicateSchemas(): { name: string; jsonSchema: Record<string, unknown> }[] {
	return TODO_PREDICATES.map((def) => ({
		name: predSchemaName(def),
		jsonSchema: compilePredicate(def)
	}))
}

export type { PredicateDef } from './compile.js'
export { compilePredicate, predSchemaName }
