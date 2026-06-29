import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
	compilePredicate,
	predSchemaName,
	TASK,
	TODO_PREDICATES,
	todoPredicateSchemas,
	VALID
} from '../src/predicate/index.js'

// board 0087 — the predicate compiler turns a gismu-sourced definition into a self-documenting
// Ajv schema that validates predications through the same Ajv the /api/data store uses.

const ajv = new Ajv({ allErrors: true, strict: false })

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

	test('valid: open interval (x3 null) and closed interval both validate', () => {
		const validate = ajv.compile(compilePredicate(VALID))
		const fact = '01b97648-db14-4e48-b519-3b0e938de50b'
		expect(validate({ predicate: 'valid', x1: fact, x2: '2026-06-29T08:00:00Z', x3: null })).toBe(true)
		expect(validate({ predicate: 'valid', x1: fact, x2: '2026-06-29' })).toBe(true) // x3 optional
		expect(validate({ predicate: 'valid', x1: fact, x2: '2026-06-21T09:00:00Z' })).toBe(true)
		expect(validate({ predicate: 'valid', x1: fact, x2: 'not-a-date' })).toBe(false)
	})

	test('the todo bundle seeds 4 bare data-type schemas, each gismu-sourced', () => {
		expect(TODO_PREDICATES.map((p) => p.predicate)).toEqual(['task', 'valid', 'due', 'prioritized'])
		expect(TODO_PREDICATES.every((p) => typeof p.gismu === 'string' && p.gismu.length === 5)).toBe(true)
		const rows = todoPredicateSchemas()
		// x1–x5 predications ARE the universal data types — schema names carry no namespace prefix
		expect(rows.map((r) => r.name)).toEqual(['task', 'valid', 'due', 'prioritized'])
		expect(predSchemaName(TASK)).toBe('task')
		// every compiled schema is itself a valid Ajv schema
		for (const r of rows) expect(() => ajv.compile(r.jsonSchema)).not.toThrow()
	})
})
