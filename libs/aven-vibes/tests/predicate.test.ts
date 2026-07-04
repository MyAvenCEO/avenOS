import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
	COMPANY_PREDICATES,
	compilePredicate,
	DOCUMENT_PREDICATES,
	DONE,
	INVOICE_PREDICATES,
	LINE_PREDICATES,
	OWNED_BY,
	PAYMENT_PREDICATES,
	PERSON_PREDICATES,
	predSchemaName,
	STUZI,
	TASK,
	TODO_PREDICATES,
	todoPredicateSchemas,
	TRANSACTION_PREDICATES
} from '../src/predicate/index.js'

// board 0087 — the predicate compiler turns a gismu-sourced definition into a self-documenting
// Ajv schema that validates predications through the same Ajv the /api/data store uses.

const ajv = new Ajv({ allErrors: true, strict: false })

// The canonical Lojban gismu lexicon — the SSOT for place structures (board 0092 fidelity audit).
const GISMU = (
	JSON.parse(readFileSync(join(import.meta.dir, '../../../.claude/skills/ontology/gismu.json'), 'utf8')) as {
		gismu: Record<string, { arity: number; places: Record<string, { role: string; kind: string }> }>
	}
).gismu

describe('predicate compiler (board 0087)', () => {
	test('compiles a self-documenting schema (title/description/places)', () => {
		const s = compilePredicate(TASK) as {
			title: string
			description: string
			required: string[]
			additionalProperties: boolean
			properties: Record<string, { title?: string; description?: string; const?: string }>
		}
		expect(s.title).toBe('task')
		expect(s.description.length).toBeGreaterThan(0)
		expect(s.additionalProperties).toBe(false)
		expect(s.properties.predicate.const).toBe('task')
		// every place carries a human role + definition
		expect(s.properties.x1.title).toBe('agent')
		expect(s.properties.x2.title).toBe('what')
		expect(s.properties.x1.description?.length).toBeGreaterThan(0)
		expect(s.required).toContain('predicate')
		expect(s.required).toContain('x1')
		expect(s.required).toContain('x2')
	})

	test('ref places get x-ref + uuid pattern; value places get type', () => {
		const s = compilePredicate(TASK) as {
			properties: Record<string, { type?: unknown; pattern?: string; 'x-ref'?: string }>
		}
		expect(s.properties.x1['x-ref']).toBe('user')
		expect(s.properties.x1.type).toBe('string')
		expect(s.properties.x1.pattern).toBeDefined()
		expect(s.properties.x2.type).toBe('string') // value, no x-ref
		expect(s.properties.x2['x-ref']).toBeUndefined()
	})

	test('a well-formed task validates; malformed is rejected', () => {
		const validate = ajv.compile(compilePredicate(TASK))
		expect(
			validate({ predicate: 'task', x1: '01b97648-db14-4e48-b519-3b0e938de50b', x2: 'Zwei Bananen kaufen' })
		).toBe(true)
		expect(validate({ predicate: 'task', x1: 'u', x2: '' })).toBe(false) // bad uuid + empty title
		expect(validate({ predicate: 'task', x1: '01b97648-db14-4e48-b519-3b0e938de50b' })).toBe(false) // missing x2
		expect(
			validate({ predicate: 'task', x1: '01b97648-db14-4e48-b519-3b0e938de50b', x2: 'x', foo: 1 })
		).toBe(false) // additionalProperties
	})

	test('done≡mulno is a presence predication (just x1=task); owned_by≡ponse binds account→entity', () => {
		const task = '01b97648-db14-4e48-b519-3b0e938de50b'
		const doneV = ajv.compile(compilePredicate(DONE))
		expect(doneV({ predicate: 'done', x1: task })).toBe(true) // present = done
		expect(doneV({ predicate: 'done', x1: 'u' })).toBe(false) // bad ref
		const ownV = ajv.compile(compilePredicate(OWNED_BY))
		expect(ownV({ predicate: 'owned_by', x1: 'JhB95T3lSOe0ZYTKLzuKNXHzGeju9LIb', x2: task })).toBe(true)
		expect(ownV({ predicate: 'owned_by', x1: 'JhB95T3lSOe0ZYTKLzuKNXHzGeju9LIb' })).toBe(false) // missing x2
	})

	test('the todo bundle seeds 10 bare data-type schemas (incl. universal owned_by), each gismu-sourced', () => {
		// board 0112 — the Planner battle test added member_of (goals), part_of (sub-tasks), tagged (tags);
		// goal REIFICATION added girzu (the goal entity) + named (the universal label).
		expect(TODO_PREDICATES.map((p) => p.predicate)).toEqual([
			'task',
			'owned_by',
			'done',
			'due',
			'prioritized',
			'member_of',
			'part_of',
			'tagged',
			'girzu',
			'named'
		])
		expect(TODO_PREDICATES.every((p) => typeof p.gismu === 'string' && p.gismu.length === 5)).toBe(true)
		const rows = todoPredicateSchemas()
		// x1–x5 predications ARE the universal data types — schema names carry no namespace prefix
		expect(rows.map((r) => r.name)).toEqual([
			'task',
			'owned_by',
			'done',
			'due',
			'prioritized',
			'member_of',
			'part_of',
			'tagged',
			'girzu',
			'named'
		])
		expect(predSchemaName(TASK)).toBe('task')
		// every compiled schema is itself a valid Ajv schema
		for (const r of rows) expect(() => ajv.compile(r.jsonSchema)).not.toThrow()
	})

	// board 0092/0097 — the fidelity gate. EVERY wired predicate (no exclusions) must be both
	// CORRECT and COMPLETE against its canonical gismu (.claude/skills/ontology/gismu.json):
	//   (a) CORRECTNESS — every place it declares is a REAL place of that gismu, at the same position,
	//       with the same KIND (ref vs value). Catches a value smuggled into a ref slot, or an invented
	//       place. (b) COMPLETENESS (board 0097) — every place the gismu DEFINES is declared, even the
	//       ones our domain leaves empty (those are `required: false`). A predicate that drops any of
	//       its gismu's places FAILS. Role names stay pragmatic English; the place STRUCTURE is the seed.
	const ALL_WIRED = [
		...TODO_PREDICATES,
		STUZI, // inventory location entity (seeded via migration, not in TODO_PREDICATES) — gate it too
		...DOCUMENT_PREDICATES,
		...INVOICE_PREDICATES,
		...LINE_PREDICATES,
		...PAYMENT_PREDICATES,
		...PERSON_PREDICATES,
		...COMPANY_PREDICATES,
		...TRANSACTION_PREDICATES
	]

	test('every predicate is CORRECT + COMPLETE against its gismu (places == seed, all of them)', () => {
		for (const def of ALL_WIRED) {
			const seed = def.gismu ? GISMU[def.gismu] : undefined
			expect(seed, `gismu "${def.gismu}" exists in the lexicon`).toBeDefined()
			// (a) correctness: each declared place is a real gismu place at the same position + kind.
			for (const place of def.places) {
				const sp = seed?.places[place.pos]
				expect(sp, `${def.predicate}.${place.pos} is a real ${def.gismu} place`).toBeDefined()
				expect(sp?.kind, `${def.predicate}.${place.pos} kind matches ${def.gismu}.${place.pos}`).toBe(place.kind)
			}
			// (b) completeness: every place the gismu defines is declared (same positions, no drops).
			const declared = new Set(def.places.map((p) => p.pos))
			for (const pos of Object.keys(seed?.places ?? {})) {
				expect(declared.has(pos), `${def.predicate} declares ${def.gismu}.${pos} (completeness)`).toBe(true)
			}
		}
	})

	test('the consolidation holds: address≡judri + identifier≡tcita + kind≡tcita; no per-channel/klesi predicates', () => {
		const byName = new Map(ALL_WIRED.map((p) => [p.predicate, p]))
		// the dropped per-channel / per-identifier / klesi predicates no longer exist
		for (const gone of ['email', 'phone', 'iban', 'postal', 'vat_id', 'tax_number', 'classified', 'number', 'vendor']) {
			expect(byName.has(gone), `dropped predicate "${gone}" is gone`).toBe(false)
		}
		// one address≡judri (x3=system ref), one identifier≡tcita (x1=kind ref, x3=value), one kind≡tcita
		expect(byName.get('address')?.gismu).toBe('judri')
		expect(byName.get('address')?.places.find((p) => p.pos === 'x3')?.kind).toBe('ref')
		expect(byName.get('identifier')?.gismu).toBe('tcita')
		expect(byName.get('identifier')?.places.find((p) => p.pos === 'x1')?.kind).toBe('ref')
		expect(byName.get('identifier')?.places.find((p) => p.pos === 'x3')?.kind).toBe('value')
		expect(byName.get('kind')?.gismu).toBe('tcita')
		expect(byName.get('name')?.gismu).toBe('cmene')
	})
})
