import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
	compilePredicate,
	DOCUMENT_PREDICATES,
	DONE,
	INVOICE_PREDICATES,
	LINE_PREDICATES,
	OWNED_BY,
	PAYMENT_PREDICATES,
	predSchemaName,
	TASK,
	TODO_PREDICATES,
	todoPredicateSchemas
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

	test('the todo bundle seeds 5 bare data-type schemas (incl. universal owned_by), each gismu-sourced', () => {
		expect(TODO_PREDICATES.map((p) => p.predicate)).toEqual(['task', 'owned_by', 'done', 'due', 'prioritized'])
		expect(TODO_PREDICATES.every((p) => typeof p.gismu === 'string' && p.gismu.length === 5)).toBe(true)
		const rows = todoPredicateSchemas()
		// x1–x5 predications ARE the universal data types — schema names carry no namespace prefix
		expect(rows.map((r) => r.name)).toEqual(['task', 'owned_by', 'done', 'due', 'prioritized'])
		expect(predSchemaName(TASK)).toBe('task')
		// every compiled schema is itself a valid Ajv schema
		for (const r of rows) expect(() => ajv.compile(r.jsonSchema)).not.toThrow()
	})

	// board 0092 — the fidelity gate: every place a predicate declares must be a REAL place of its
	// canonical gismu, at the same position, with the same KIND (ref vs value). This catches a
	// convenient relabel (e.g. putting a value in a position the seed says is a ref, or inventing a
	// place the gismu doesn't have). Role names stay pragmatic English; structure must match the seed.
	test('every predicate place == a canonical gismu position + matching kind (places == seed)', () => {
		// the corrected vocab — todo (step 1) + the faithful invoice headline (step 2a). Two known
		// follow-ons (the gate PROVED both, then they're scoped out until their step):
		//   - DOCUMENT (classified≡klesi puts a value where klesi.x2 is a ref; owner-in-x1) → document step
		//   - invoice `vendor` (a transitional name; becomes the biller as a janta.x4 contact ref) → step 3
		void DOCUMENT_PREDICATES
		const gated = [
			...TODO_PREDICATES,
			...INVOICE_PREDICATES.filter((p) => p.predicate !== 'vendor'),
			...LINE_PREDICATES,
			...PAYMENT_PREDICATES
		]
		for (const def of gated) {
			const seed = def.gismu ? GISMU[def.gismu] : undefined
			expect(seed, `gismu "${def.gismu}" exists in the lexicon`).toBeDefined()
			for (const place of def.places) {
				const sp = seed?.places[place.pos]
				expect(sp, `${def.predicate}.${place.pos} is a real ${def.gismu} place`).toBeDefined()
				expect(sp?.kind, `${def.predicate}.${place.pos} kind matches ${def.gismu}.${place.pos}`).toBe(place.kind)
			}
		}
	})
})
